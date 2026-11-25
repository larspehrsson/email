//! Updating itself: a build from the GitHub releases asks the repository's "latest" release
//! for a newer version (`latest.json`, which CI writes next to the files), downloads it in the
//! background, checks its signature against the public key built in, and installs it when the
//! user says so (Restart). Built on Tauri's updater plugin.
//!
//! Only builds made by CI with the signing key have the updater's configuration (see
//! .github/workflows/build.yml): a build made on this computer has none, and never replaces
//! itself (`enabled`).
//!
//! The frontend decides when to look (at start and every few hours, unless turned off in
//! Settings) and calls `check_for_update`; the download is kept in memory until `install_update`.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

/// This build has the updater's configuration (made by CI with the signing key).
pub fn enabled(config: &tauri::Config) -> bool {
    config.plugins.0.get("updater").is_some_and(|c| !c.is_null())
}

#[derive(Default)]
pub struct UpdateState {
    inner: Mutex<Inner>,
    /// Held while checking and downloading: one at a time.
    busy: Mutex<()>,
}

#[derive(Default)]
struct Inner {
    /// Downloaded and verified, waiting for a restart.
    ready: Option<Arc<(Update, Vec<u8>)>>,
    /// When it last asked successfully (Unix seconds).
    checked: Option<i64>,
    error: Option<String>,
    checking: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// This build updates itself.
    supported: bool,
    checking: bool,
    /// The version downloaded and ready: installed on restart.
    ready: Option<String>,
    /// When it last asked (Unix seconds), whatever the answer.
    checked: Option<i64>,
    /// Why the last check or download failed.
    error: Option<String>,
}

async fn status(app: &AppHandle) -> UpdateStatus {
    let Some(state) = app.try_state::<Arc<UpdateState>>() else {
        return UpdateStatus { supported: false, checking: false, ready: None, checked: None, error: None };
    };
    let i = state.inner.lock().await;
    UpdateStatus {
        supported: true,
        checking: i.checking,
        ready: i.ready.as_ref().map(|r| r.0.version.clone()),
        checked: i.checked,
        error: i.error.clone(),
    }
}

#[tauri::command]
pub async fn update_status(app: AppHandle) -> Result<UpdateStatus, String> {
    Ok(status(&app).await)
}

/// Ask for a newer version and download it (verified against the signature); the status after.
/// While another check runs, its status at once.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateStatus, String> {
    let Some(state) = app.try_state::<Arc<UpdateState>>().map(|s| s.inner().clone()) else {
        return Ok(status(&app).await);
    };
    let Ok(_busy) = state.busy.try_lock() else {
        return Ok(status(&app).await);
    };
    state.inner.lock().await.checking = true;
    let result = fetch(&app, &state).await;
    {
        let mut i = state.inner.lock().await;
        i.checking = false;
        i.checked = Some(now());
        match result {
            Ok(Some(ready)) => {
                tracing::info!(version = ready.0.version, "update downloaded");
                i.ready = Some(Arc::new(ready));
                i.error = None;
            }
            Ok(None) => i.error = None,
            Err(e) => {
                tracing::warn!("update check: {e:#}");
                i.error = Some(format!("{e:#}"));
            }
        }
    }
    Ok(status(&app).await)
}

/// A newer version than this one and the one already downloaded, downloaded.
async fn fetch(app: &AppHandle, state: &UpdateState) -> anyhow::Result<Option<(Update, Vec<u8>)>> {
    let Some(update) = app.updater()?.check().await? else { return Ok(None) };
    let have = state.inner.lock().await.ready.as_ref().map(|r| r.0.version.clone());
    if have.as_deref() == Some(update.version.as_str()) {
        return Ok(None);
    }
    tracing::info!(from = update.current_version, to = update.version, "downloading an update");
    let bytes = update.download(|_, _| {}, || {}).await?;
    Ok(Some((update, bytes)))
}

/// Install the downloaded version and start it. On Windows the installer takes over (this
/// process ends at once); elsewhere the app is replaced in place, then restarted.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<Arc<UpdateState>>().map(|s| s.inner().clone()) else {
        return Err("This copy of Email doesn't update itself.".into());
    };
    let Some(ready) = state.inner.lock().await.ready.clone() else {
        return Err("No update has been downloaded.".into());
    };
    if app.try_state::<Arc<mail_core::Core>>().is_some_and(|c| c.export_status().is_some()) {
        return Err("An export is under way: restart when it's done.".into());
    }
    tracing::info!(version = ready.0.version, "installing the update");
    let installing = ready.clone();
    #[cfg(target_os = "linux")]
    if is_rpm(&installing.1) {
        tokio::task::spawn_blocking(move || install_rpm(&installing.1)).await.map_err(|e| e.to_string())??;
        app.restart();
    }
    tokio::task::spawn_blocking(move || installing.0.install(&installing.1))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            tracing::warn!("installing the update: {e:#}");
            format!("The update couldn't be installed: {e}")
        })?;
    app.restart();
}

/// A new folder only this user can open, for the package root installs: in the user's runtime
/// folder (or their cache), never a shared one like /tmp, where another user could make the
/// folder first and swap the package between the check and the install. Created fresh (it
/// fails if the name is taken), with a name no one can guess ahead.
#[cfg(target_os = "linux")]
fn private_dir() -> std::io::Result<std::path::PathBuf> {
    use std::os::unix::fs::DirBuilderExt;
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".cache")))
        .ok_or_else(|| std::io::Error::other("no private folder to use"))?;
    std::fs::create_dir_all(&base)?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = base.join(format!("email-update-{}-{nanos:x}", std::process::id()));
    std::fs::DirBuilder::new().mode(0o700).create(&dir)?;
    Ok(dir)
}

/// An .rpm package (its lead starts with these bytes).
#[cfg(target_os = "linux")]
fn is_rpm(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xED, 0xAB, 0xEE, 0xDB])
}

/// Install an .rpm update with one password prompt (the system's own, through pkexec).
///
/// Not with the updater plugin: it runs `rpm -U`, which RPM 6 (Fedora 43 and later) refuses
/// for a package without an RPM signature ("does not verify: no signature"), then asks for the
/// password again in a dialog of its own and fails the same way. `--nosignature` skips only
/// RPM's own check: the download was already checked against the update key built into the app
/// (`Update::download` verifies its signature), which is what says it's ours.
#[cfg(target_os = "linux")]
fn install_rpm(bytes: &[u8]) -> Result<(), String> {
    let dir = private_dir().map_err(|e| format!("The update couldn't be saved for installing: {e}"))?;
    let pkg = dir.join("email-update.rpm");
    let result = (|| {
        std::fs::write(&pkg, bytes).map_err(|e| format!("The update couldn't be saved for installing: {e}"))?;
        let out = std::process::Command::new("pkexec")
            .args(["rpm", "-U", "--nosignature"])
            .arg(&pkg)
            .output()
            .map_err(|e| format!("The update couldn't be installed: pkexec didn't start ({e})"))?;
        if out.status.success() {
            tracing::info!("update installed with rpm");
            return Ok(());
        }
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        tracing::warn!(code = ?out.status.code(), "installing the update with rpm: {err}");
        Err(match out.status.code() {
            // pkexec: the password dialog was dismissed, or not allowed
            Some(126) | Some(127) => "The update wasn't installed: no password was given.".to_string(),
            _ if err.is_empty() => "The update couldn't be installed.".to_string(),
            _ => format!("The update couldn't be installed: {err}"),
        })
    })();
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}
