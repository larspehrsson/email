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
    tokio::task::spawn_blocking(move || installing.0.install(&installing.1))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            tracing::warn!("installing the update: {e:#}");
            format!("The update couldn't be installed: {e}")
        })?;
    app.restart();
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}
