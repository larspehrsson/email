//! An account's mail exported to a folder: one mbox file per mail folder (mboxrd, as Thunderbird
//! and Apple Mail import it), in subfolders like the account's, and a README.txt saying what's
//! there. Messages this computer has whole are written from here; the others (stored without
//! their attachments, or not yet downloaded) are fetched from the server for the export only,
//! never stored. The folder is named "… (incomplete)" until it's done.
//!
//! Gmail is one mailbox with labels, its All Mail holding every message (but Spam and Trash): as
//! Google Takeout does, each message is written once, to `All Mail.mbox`, with its labels in an
//! `X-Gmail-Labels` header; Spam and Trash get files of their own. (An account hiding All Mail
//! from IMAP is exported folder by folder.)

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};

use super::Shared;
use crate::imap::Connection;

/// Messages fetched per command.
const FETCH_BATCH: usize = 25;
/// One batch may take this long before the export gives up on it.
const FETCH_TIMEOUT: Duration = Duration::from_secs(180);

/// How an export went.
#[derive(Debug, Clone)]
pub struct ExportSummary {
    pub path: PathBuf,
    /// Messages written (a Gmail message under several labels counts once per label).
    pub written: u32,
    /// Of those, written without their attachments (couldn't be fetched whole).
    pub partial: u32,
    /// Not written at all (not here and couldn't be fetched).
    pub failed: u32,
    pub cancelled: bool,
}

/// Exports an account's mail; got from its running sync (`AccountSync::exporter`).
pub struct Exporter(pub(super) Arc<Shared>);

/// A folder segment as a file name: no path separators or characters some systems refuse.
fn file_name(seg: &str) -> String {
    let s: String = seg.chars().map(|c| if "/\\:*?\"<>|".contains(c) || c.is_control() { '_' } else { c }).collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() { "_".into() } else { s }
}

/// The separator line before each message: `From - Mon Nov 17 02:44:54 2026` (its date, UTC).
pub fn from_line(date: i64) -> String {
    let d = chrono::DateTime::from_timestamp(date, 0).unwrap_or_default();
    format!("From - {}\n", d.format("%a %b %e %H:%M:%S %Y"))
}

/// A message in mboxrd form: LF line ends, `>` before any line that is (or already quotes) a
/// "From " line, a blank line after.
pub fn mboxrd(raw: &[u8], out: &mut impl Write) -> std::io::Result<()> {
    for line in raw.split(|&b| b == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let quotes = line.iter().take_while(|&&b| b == b'>').count();
        if line[quotes..].starts_with(b"From ") {
            out.write_all(b">")?;
        }
        out.write_all(line)?;
        out.write_all(b"\n")?;
    }
    out.write_all(b"\n")
}

/// The message with an `X-Gmail-Labels: Inbox, Work` header in front (none: as it is).
pub fn with_labels(raw: &[u8], labels: &[String]) -> Vec<u8> {
    if labels.is_empty() {
        return raw.to_vec();
    }
    // One line, no line breaks or commas inside a label (a comma separates them).
    let list: Vec<String> = labels.iter().map(|l| l.replace(['\r', '\n'], " ").replace(',', " ")).collect();
    let mut out = format!("X-Gmail-Labels: {}\r\n", list.join(",")).into_bytes();
    out.extend_from_slice(raw);
    out
}

/// A new folder `base` (or `base (2)` …) in `dir`.
fn unused(dir: &Path, base: &str) -> PathBuf {
    let mut n = 1;
    loop {
        let name = if n == 1 { base.to_string() } else { format!("{base} ({n})") };
        let p = dir.join(&name);
        let taken = |p: &Path| p.exists() || p.with_file_name(format!("{name} (incomplete)")).exists();
        if !taken(&p) {
            return p;
        }
        n += 1;
    }
}

impl Exporter {
    /// Export into a new folder in `dir`. `progress(done, total)` after each message; `cancel`
    /// stops between messages (the folder keeps its "(incomplete)" name).
    pub async fn run(&self, dir: &Path, cancel: &AtomicBool, progress: impl Fn(u32, u32)) -> Result<ExportSummary> {
        let shared = &self.0;
        let store = &shared.store;
        let account = &shared.account;
        let date = chrono::Local::now().format("%Y-%m-%d");
        let target = unused(dir, &format!("{} mail {date}", file_name(&account.email)));
        let base = target.file_name().and_then(|n| n.to_str()).unwrap_or("export").to_string();
        let work = target.with_file_name(format!("{base} (incomplete)"));
        std::fs::create_dir_all(&work).with_context(|| format!("creating {}", work.display()))?;
        let tmp = work.join(".fetched");

        let folders: HashMap<i64, crate::model::Folder> = store.folders(account.id)?.into_iter().map(|f| (f.id, f)).collect();
        // Gmail with All Mail: All Mail (labels in a header), Spam and Trash only.
        use crate::model::FolderRole;
        let takeout = account.provider == crate::model::Provider::Gmail
            && folders.values().any(|f| f.role == Some(FolderRole::All) && f.selectable);
        let mut entries = store.export_entries(account.id)?;
        if takeout {
            entries.retain(|(id, _)| {
                folders.get(id).is_some_and(|f| matches!(f.role, Some(FolderRole::All | FolderRole::Junk | FolderRole::Trash)))
            });
        }
        let label_of = |f: &crate::model::Folder| if f.path.len() == 1 { f.display_name.clone() } else { f.path.join("/") };
        let total: u32 = entries.iter().map(|(_, l)| l.len() as u32).sum();
        let mut summary = ExportSummary { path: work.clone(), written: 0, partial: 0, failed: 0, cancelled: false };
        let mut fetched: HashMap<i64, PathBuf> = HashMap::new();
        let mut unfetchable: std::collections::HashSet<i64> = Default::default();
        let mut conn: Option<Connection> = None;
        let mut report: Vec<String> = Vec::new();
        let mut done = 0u32;

        'folders: for (folder_id, list) in &entries {
            let Some(folder) = folders.get(folder_id) else { continue };
            // Fetch what this folder needs that isn't here whole (and wasn't fetched for another).
            let mut need: Vec<(i64, u32)> = Vec::new();
            for &(id, uid, _) in list {
                if !fetched.contains_key(&id) && !unfetchable.contains(&id) && !store.stored_whole(id)? {
                    need.push((id, uid));
                }
            }
            for batch in need.chunks(FETCH_BATCH) {
                if cancel.load(Ordering::Relaxed) {
                    summary.cancelled = true;
                    break 'folders;
                }
                let uids: Vec<u32> = batch.iter().map(|b| b.1).filter(|&u| u != 0).collect();
                let got = if uids.is_empty() {
                    Ok(Vec::new())
                } else {
                    self.fetch(&mut conn, &folder.raw_name, &uids).await
                };
                match got {
                    Ok(bodies) => {
                        let by_uid: HashMap<u32, Vec<u8>> = bodies.into_iter().collect();
                        std::fs::create_dir_all(&tmp)?;
                        for &(id, uid) in batch {
                            match by_uid.get(&uid) {
                                Some(raw) if uid != 0 => {
                                    let p = tmp.join(format!("{id}.eml"));
                                    std::fs::write(&p, raw)?;
                                    fetched.insert(id, p);
                                }
                                _ => {
                                    unfetchable.insert(id);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(folder = folder.raw_name, "export: fetching {} messages: {e:#}", uids.len());
                        conn = None; // a fresh connection for the next batch
                        unfetchable.extend(batch.iter().map(|b| b.0));
                    }
                }
            }

            // Write the folder's mbox, oldest first.
            let mut path = work.clone();
            // Named as shown ("Inbox", not "INBOX"); nested ones by their path.
            let mut segs: Vec<String> = folder.path.iter().map(|s| file_name(s)).collect();
            if segs.len() == 1 {
                segs[0] = file_name(&folder.display_name);
            }
            for s in &segs[..segs.len().saturating_sub(1)] {
                path.push(s);
            }
            std::fs::create_dir_all(&path)?;
            path.push(format!("{}.mbox", segs.last().cloned().unwrap_or_else(|| "_".into())));
            let mut out = std::io::BufWriter::new(std::fs::File::create(&path).with_context(|| format!("creating {}", path.display()))?);
            let (mut here, mut partial, mut failed) = (0u32, 0u32, 0u32);
            for &(id, _, date) in list {
                if cancel.load(Ordering::Relaxed) {
                    summary.cancelled = true;
                    out.flush()?;
                    break 'folders;
                }
                let raw = match fetched.get(&id) {
                    Some(p) => Some(std::fs::read(p)?),
                    None => store.body(id)?,
                };
                match raw {
                    Some(raw) => {
                        out.write_all(from_line(date).as_bytes())?;
                        if takeout {
                            // Its labels: every other folder it's in (All Mail itself isn't one).
                            let mut labels: Vec<String> = store
                                .message_folder_ids(id)?
                                .into_iter()
                                .filter_map(|fid| folders.get(&fid))
                                .filter(|f| f.role != Some(FolderRole::All))
                                .map(label_of)
                                .collect();
                            labels.sort();
                            labels.dedup();
                            mboxrd(&with_labels(&raw, &labels), &mut out)?;
                        } else {
                            mboxrd(&raw, &mut out)?;
                        }
                        here += 1;
                        if unfetchable.contains(&id) {
                            partial += 1;
                        }
                    }
                    None => failed += 1,
                }
                done += 1;
                progress(done, total);
            }
            out.flush()?;
            summary.written += here;
            summary.partial += partial;
            summary.failed += failed;
            let shown = if folder.path.len() == 1 { folder.display_name.clone() } else { folder.path.join("/") };
            let mut line = format!("{shown}: {} message{}", here, if here == 1 { "" } else { "s" });
            if partial > 0 {
                line.push_str(&format!(", {partial} without attachments (couldn't be downloaded)"));
            }
            if failed > 0 {
                line.push_str(&format!(", {failed} missing (not on this computer and couldn't be downloaded)"));
            }
            report.push(line);
        }
        if let Some(c) = conn.take() {
            c.logout().await;
        }
        let _ = std::fs::remove_dir_all(&tmp);

        let readme = format!(
            "Mail of {} exported by Email on {}{}.\n\n\
             One .mbox file per folder (mboxrd), in folders like the account's. Apple Mail \
             (File › Import Mailboxes) and Thunderbird (ImportExportTools NG) import them; \
             any text editor opens them.{}\n\n{}\n",
            account.email,
            chrono::Local::now().format("%Y-%m-%d %H:%M"),
            if summary.cancelled { " (stopped before the end: incomplete)" } else { "" },
            if takeout {
                " Gmail: every message is in All Mail.mbox once, its labels in an X-Gmail-Labels header \
                 (as Google Takeout writes them); Spam and Trash have files of their own."
            } else if account.provider == crate::model::Provider::Gmail {
                " Gmail's labels are folders here, so a message with several labels is in several files."
            } else {
                ""
            },
            report.join("\n"),
        );
        std::fs::write(work.join("README.txt"), readme)?;
        if !summary.cancelled {
            std::fs::rename(&work, &target).with_context(|| format!("naming {}", target.display()))?;
            summary.path = target;
        }
        Ok(summary)
    }

    /// Fetch whole messages by UID from a folder, on a connection of the export's own.
    async fn fetch(&self, conn: &mut Option<Connection>, folder: &str, uids: &[u32]) -> Result<Vec<(u32, Vec<u8>)>> {
        if conn.is_none() {
            *conn = Some(self.0.connect().await?);
        }
        let c = conn.as_mut().ok_or_else(|| anyhow!("no connection"))?;
        tokio::time::timeout(FETCH_TIMEOUT, async {
            c.ensure_selected(folder).await?;
            c.fetch_bodies(uids).await
        })
        .await
        .map_err(|_| anyhow!("the server took too long"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mbox_lines() {
        let mut out = Vec::new();
        mboxrd(b"Subject: x\r\n\r\nFrom here on\r\n>From quoted\r\nnot From\r\n", &mut out).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "Subject: x\n\n>From here on\n>>From quoted\nnot From\n\n\n");
        assert_eq!(from_line(1_794_236_400), "From - Mon Nov  9 15:00:00 2026\n");
    }

    #[test]
    fn gmail_labels_go_in_a_header() {
        let raw = b"Subject: x\r\n\r\nHi\r\n";
        assert_eq!(with_labels(raw, &[]), raw.to_vec());
        let out = String::from_utf8(with_labels(raw, &["Inbox".into(), "Work/Clients".into(), "a,b".into()])).unwrap();
        assert_eq!(out, "X-Gmail-Labels: Inbox,Work/Clients,a b\r\nSubject: x\r\n\r\nHi\r\n");
    }

    #[test]
    fn folder_names_are_safe_file_names() {
        assert_eq!(file_name("Sent Items"), "Sent Items");
        assert_eq!(file_name("a/b:c?"), "a_b_c_");
        assert_eq!(file_name(".."), "_");
    }
}
