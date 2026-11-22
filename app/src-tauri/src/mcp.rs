//! AI apps (MCP clients) reaching the mail through the running app (see `mail_core::mcp`).
//!
//! The app listens on a local socket only this user can open: a Unix socket beside the
//! database (mode 0600) on macOS and Linux, a named pipe on Windows. An MCP client starts the
//! app's own program with `--mcp` (`bridge`), which relays its stdin and stdout to that socket,
//! starting the app first if it isn't running. Nothing listens on the network.
//!
//! What's allowed lives in `mcp.json` in the app's config folder (Settings › AI apps); deleting
//! and sending ask the user in the main window (`mcp-confirm`, answered by `mcp_answer`); what
//! AI apps did is kept for Settings (`mcp_log`) and shown as it happens (`mcp-activity`).

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mail_core::Core;
use mail_core::mcp::{Activity, Confirm, Host, Session, Settings};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const IDENTIFIER: &str = "dev.mailclient.desktop";
/// How long a question waits for the user before it counts as "no".
const ASK_FOR: Duration = Duration::from_secs(180);
const LOG_MAX: usize = 200;

/// Where the app listens (and the bridge connects).
#[cfg(unix)]
pub fn socket_path() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let data = if cfg!(target_os = "macos") {
        home.join("Library/Application Support")
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| home.join(".local/share"))
    };
    let p = data.join(IDENTIFIER).join("mcp.sock");
    // A Unix socket's path has room for about 100 bytes.
    if p.as_os_str().len() < 100 { p } else { std::env::temp_dir().join(format!("{IDENTIFIER}-mcp.sock")) }
}

#[cfg(windows)]
pub fn pipe_name() -> String {
    let user = std::env::var("USERNAME").unwrap_or_default();
    format!(r"\\.\pipe\{IDENTIFIER}-mcp-{user}")
}

/// A line of the activity list in Settings.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Milliseconds since 1970.
    pub at: i64,
    pub client: String,
    pub tool: String,
    pub summary: String,
    pub ok: bool,
}

pub struct McpState {
    path: Option<PathBuf>,
    settings: Mutex<Settings>,
    log: Mutex<VecDeque<LogEntry>>,
    pending: Mutex<HashMap<u64, tokio::sync::oneshot::Sender<bool>>>,
    seq: AtomicU64,
}

impl McpState {
    pub fn load(app: &AppHandle) -> McpState {
        let path = app.path().app_config_dir().ok().map(|d| d.join("mcp.json"));
        let settings = path
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        McpState { path, settings: Mutex::new(settings), log: Mutex::new(VecDeque::new()), pending: Mutex::new(HashMap::new()), seq: AtomicU64::new(1) }
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn set_settings(&self, s: Settings) -> Result<(), String> {
        if let Some(p) = &self.path {
            if let Some(d) = p.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            std::fs::write(p, serde_json::to_vec_pretty(&s).map_err(|e| e.to_string())?).map_err(|e| format!("saving {}: {e}", p.display()))?;
        }
        *self.settings.lock().unwrap() = s;
        Ok(())
    }

    pub fn log(&self) -> Vec<LogEntry> {
        self.log.lock().unwrap().iter().rev().cloned().collect()
    }

    pub fn answer(&self, id: u64, allow: bool) {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(allow);
        }
    }
}

/// A question as the window gets it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Ask {
    id: u64,
    #[serde(flatten)]
    confirm: Confirm,
}

struct AppHost {
    app: AppHandle,
    state: Arc<McpState>,
}

impl Host for AppHost {
    fn settings(&self) -> Settings {
        self.state.settings()
    }

    async fn confirm(&self, confirm: Confirm) -> bool {
        let id = self.state.seq.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.state.pending.lock().unwrap().insert(id, tx);
        if let Some(w) = self.app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        let _ = self.app.emit("mcp-confirm", Ask { id, confirm });
        let allowed = matches!(tokio::time::timeout(ASK_FOR, rx).await, Ok(Ok(true)));
        self.state.pending.lock().unwrap().remove(&id);
        // The window drops a question nobody answered.
        let _ = self.app.emit("mcp-confirm-done", id);
        allowed
    }

    fn activity(&self, a: Activity) {
        tracing::info!(client = a.client, tool = a.tool, ok = a.ok, "ai app: {}", a.summary);
        let entry = LogEntry {
            at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0),
            client: a.client.clone(),
            tool: a.tool.clone(),
            summary: a.summary.clone(),
            ok: a.ok,
        };
        {
            let mut log = self.state.log.lock().unwrap();
            log.push_back(entry);
            while log.len() > LOG_MAX {
                log.pop_front();
            }
        }
        let _ = self.app.emit("mcp-activity", a);
    }
}

/// Serve one client: a line in, a line out.
async fn serve<S: tokio::io::AsyncRead + tokio::io::AsyncWrite>(stream: S, core: Arc<Core>, host: Arc<AppHost>) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let (read, mut write) = tokio::io::split(stream);
    let mut lines = BufReader::new(read).lines();
    let mut session = Session::default();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        if let Some(reply) = mail_core::mcp::handle(&core, host.as_ref(), &mut session, &line).await
            && (write.write_all(reply.as_bytes()).await.is_err() || write.write_all(b"\n").await.is_err() || write.flush().await.is_err())
        {
            break;
        }
    }
}

/// Listen for AI apps, on a thread of its own (connections are served one task each).
pub fn start(app: AppHandle, core: Arc<Core>, state: Arc<McpState>) {
    let host = Arc::new(AppHost { app, state });
    std::thread::Builder::new()
        .name("mcp".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(rt) => rt,
                Err(e) => return tracing::warn!("ai apps: no runtime: {e}"),
            };
            let local = tokio::task::LocalSet::new();
            local.block_on(&rt, async move {
                if let Err(e) = listen(core, host).await {
                    tracing::warn!("ai apps: not listening: {e:#}");
                }
            });
        })
        .ok();
}

#[cfg(unix)]
async fn listen(core: Arc<Core>, host: Arc<AppHost>) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let path = socket_path();
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    // A socket left behind by a crash: gone. One another copy of the app serves: left alone.
    if path.exists() {
        if tokio::net::UnixStream::connect(&path).await.is_ok() {
            anyhow::bail!("another copy of the app is serving {}", path.display());
        }
        let _ = std::fs::remove_file(&path);
    }
    let listener = tokio::net::UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    tracing::info!("ai apps: listening on {}", path.display());
    loop {
        let (stream, _) = listener.accept().await?;
        tokio::task::spawn_local(serve(stream, core.clone(), host.clone()));
    }
}

#[cfg(windows)]
async fn listen(core: Arc<Core>, host: Arc<AppHost>) -> anyhow::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let name = pipe_name();
    // Refused if another copy of the app has the pipe already.
    let mut server = ServerOptions::new().first_pipe_instance(true).reject_remote_clients(true).create(&name)?;
    tracing::info!("ai apps: listening on {name}");
    loop {
        server.connect().await?;
        let connected = server;
        server = ServerOptions::new().reject_remote_clients(true).create(&name)?;
        tokio::task::spawn_local(serve(connected, core.clone(), host.clone()));
    }
}

#[cfg(not(any(unix, windows)))]
async fn listen(_core: Arc<Core>, _host: Arc<AppHost>) -> anyhow::Result<()> {
    anyhow::bail!("not on this system")
}

// ------------------------------------------------------------- the bridge (`--mcp`)

/// The program run as `Email --mcp` by an MCP client: its stdin and stdout, relayed to the
/// running app (started if it isn't). Returns the exit code.
pub fn bridge() -> i32 {
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("email --mcp: {e}");
            return 1;
        }
    };
    rt.block_on(async {
        match relay().await {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("email --mcp: {e:#}");
                1
            }
        }
    })
}

async fn relay() -> anyhow::Result<()> {
    let stream = connect_or_start().await?;
    let (mut from_app, mut to_app) = tokio::io::split(stream);
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    tokio::select! {
        r = tokio::io::copy(&mut stdin, &mut to_app) => { r?; }
        r = tokio::io::copy(&mut from_app, &mut stdout) => { r?; }
    }
    Ok(())
}

#[cfg(unix)]
type Stream = tokio::net::UnixStream;
#[cfg(windows)]
type Stream = tokio::net::windows::named_pipe::NamedPipeClient;

async fn connect() -> std::io::Result<Stream> {
    #[cfg(unix)]
    return tokio::net::UnixStream::connect(socket_path()).await;
    #[cfg(windows)]
    return tokio::net::windows::named_pipe::ClientOptions::new().open(pipe_name());
}

/// The running app's socket; the app started (as usual, its window shown) if nothing answers.
async fn connect_or_start() -> anyhow::Result<Stream> {
    if let Ok(s) = connect().await {
        return Ok(s);
    }
    let exe = std::env::current_exe()?;
    std::process::Command::new(&exe)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| anyhow::anyhow!("starting Email ({}): {e}", exe.display()))?;
    for _ in 0..80 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if let Ok(s) = connect().await {
            return Ok(s);
        }
    }
    anyhow::bail!("Email didn't start (or AI apps can't reach it): open it and try again")
}
