//! Desktop notifications for new mail in an Inbox, shown while the window isn't the one in use,
//! and for snoozed mail whose time came.
//! Clicking one brings the window up on the message (or, for several, on the Inbox).
//!
//! On macOS through UNUserNotificationCenter (`mac`): what macOS shows, lists under System
//! Settings › Notifications, and asks permission for the first time. (notify-rust's macOS
//! path, the old NSUserNotification, is dropped by macOS without a word.) A build that isn't an
//! app bundle (`tauri dev`) has no bundle identifier for it, and falls back to notify-rust.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use mail_core::Core;
use mail_core::model::{FolderRole, NewMessage};
use serde::Serialize;
use tauri::{Emitter, Manager};

/// The UI's setting (Settings › Notifications), pushed at startup and on every change.
static ENABLED: AtomicBool = AtomicBool::new(true);

/// Notifications whose click is still awaited, each on a thread of its own. Unattended ones
/// pile up (GNOME keeps them until dismissed), so past this many new ones aren't clickable.
static WAITING: AtomicUsize = AtomicUsize::new(0);
const MAX_WAITING: usize = 32;

#[tauri::command]
pub fn set_notifications(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPayload {
    folder_id: i64,
    id: Option<i64>,
}

pub fn init(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    if !mac::init(app) {
        // Without this, macOS attributes the notifications (and their clicks) to another app.
        let _ = notify_rust::set_application("dev.mailclient.desktop");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

pub fn new_mail(app: &tauri::AppHandle, core: &Core, account_id: i64, folder_id: i64, messages: Vec<NewMessage>) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let is_inbox = core
        .folders(account_id)
        .ok()
        .and_then(|fs| fs.into_iter().find(|f| f.id == folder_id))
        .is_some_and(|f| f.role == Some(FolderRole::Inbox));
    if !is_inbox || in_use(app) {
        return;
    }
    let accounts = core.accounts().unwrap_or_default();
    let Some(account) = accounts.iter().find(|a| a.id == account_id) else { return };
    // Mail you sent yourself (to yourself, or Cc'd) isn't news.
    let messages: Vec<NewMessage> =
        messages.into_iter().filter(|m| !m.from_addr.eq_ignore_ascii_case(&account.email)).collect();
    let Some(first) = messages.first() else { return };

    let (summary, mut body, target) = if messages.len() == 1 {
        (sender(first).to_string(), subject(first).to_string(), Some(first.id))
    } else {
        (format!("{} new messages", messages.len()), senders(&messages), None)
    };
    if accounts.len() > 1 {
        body = format!("{body}\n{}", account.email);
    }
    tracing::info!(account = account.email, count = messages.len(), "new mail notification");
    show(app, summary, body, folder_id, target, "email.arrived");
}

/// Snoozed mail whose time came: a reminder you asked for, so shown even while the window is in
/// use.
pub fn snooze_due(app: &tauri::AppHandle, core: &Core, account_id: i64, folder_id: i64, messages: Vec<NewMessage>) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let Some(first) = messages.first() else { return };
    let accounts = core.accounts().unwrap_or_default();
    let Some(account) = accounts.iter().find(|a| a.id == account_id) else { return };
    let (summary, mut body, target) = if messages.len() == 1 {
        ("Snoozed message is back".to_string(), format!("{}\n{}", subject(first), sender(first)), Some(first.id))
    } else {
        (format!("{} snoozed messages are back", messages.len()), senders(&messages), None)
    };
    if accounts.len() > 1 {
        body = format!("{body}\n{}", account.email);
    }
    tracing::info!(account = account.email, count = messages.len(), "snooze notification");
    show(app, summary, body, folder_id, target, "email");
}

/// Show a notification on a thread of its own; a click opens `target` (or the folder).
fn show(app: &tauri::AppHandle, summary: String, body: String, folder_id: i64, target: Option<i64>, category: &'static str) {
    #[cfg(target_os = "macos")]
    if mac::show(&summary, &body, folder_id, target) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut n = notify_rust::Notification::new();
        n.appname("Email").summary(&summary).body(&body);
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            n.icon("mail-app")
                .hint(notify_rust::Hint::DesktopEntry("Email".into()))
                .hint(notify_rust::Hint::Category(category.into()));
        }
        #[cfg(not(all(unix, not(target_os = "macos"))))]
        let _ = category;
        // Windows names a toast by its app's AppUserModelID: the installer gives the Start menu
        // shortcut the bundle identifier, so this says "Email" (otherwise PowerShell's).
        #[cfg(target_os = "windows")]
        n.app_id("dev.mailclient.desktop");
        let clickable = WAITING.fetch_add(1, Ordering::SeqCst) < MAX_WAITING;
        if clickable {
            n.action("default", "Open");
        }
        match n.show() {
            Ok(handle) if clickable => handle.wait_for_action(|action| {
                if action == "default" {
                    open(&app, folder_id, target);
                }
            }),
            Ok(_) => {}
            Err(e) => tracing::warn!("showing a notification: {e}"),
        }
        WAITING.fetch_sub(1, Ordering::SeqCst);
    });
}

fn subject(m: &NewMessage) -> &str {
    let s = m.subject.trim();
    if s.is_empty() { "(no subject)" } else { s }
}

/// The window is up and in use: the new mail shows in the list, no need to interrupt.
fn in_use(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main").is_some_and(|w| {
        w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.is_focused().unwrap_or(false)
    })
}

fn sender(m: &NewMessage) -> &str {
    let name = m.from_name.trim();
    if name.is_empty() { m.from_addr.trim() } else { name }
}

/// "From Ann, Bob and 3 others": distinct senders in arrival order.
fn senders(messages: &[NewMessage]) -> String {
    let mut names: Vec<&str> = Vec::new();
    for m in messages {
        let s = sender(m);
        if !names.contains(&s) {
            names.push(s);
        }
    }
    match names.as_slice() {
        [] => String::new(),
        [a] => format!("From {a}"),
        [a, b] => format!("From {a} and {b}"),
        [a, b, c] => format!("From {a}, {b} and {c}"),
        [a, b, rest @ ..] => format!("From {a}, {b} and {} others", rest.len()),
    }
}

fn open(app: &tauri::AppHandle, folder_id: i64, id: Option<i64>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit("open-message", OpenPayload { folder_id, id });
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicU64, Ordering};

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{AnyThread, define_class, msg_send};
    use objc2_foundation::{NSBundle, NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
        UNNotificationRequest, UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter,
        UNUserNotificationCenterDelegate,
    };

    /// Set when the notification center is in use (an app bundle); clicks go to this app.
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; no Drop.
        #[unsafe(super(NSObject))]
        #[name = "EmailNotificationDelegate"]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            // Shown even while Email is the active app (a snooze coming back).
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                handler.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound,));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                handler: &block2::DynBlock<dyn Fn()>,
            ) {
                let id = response.notification().request().identifier().to_string();
                if let (Some(app), Some((folder_id, target))) = (APP.get(), parse_id(&id)) {
                    super::open(app, folder_id, target);
                }
                handler.call(());
            }
        }
    );

    /// Use the notification center, and ask for permission (macOS asks the user once). False:
    /// not an app bundle, use notify-rust.
    pub fn init(app: &tauri::AppHandle) -> bool {
        if NSBundle::mainBundle().bundleIdentifier().is_none() {
            return false;
        }
        let _ = APP.set(app.clone());
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let delegate: Retained<Delegate> = unsafe { msg_send![super(Delegate::alloc().set_ivars(())), init] };
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        // The center holds its delegate weakly: keep it for the app's life.
        std::mem::forget(delegate);
        let answered = RcBlock::new(|granted: Bool, error: *mut NSError| {
            if let Some(e) = unsafe { error.as_ref() } {
                tracing::warn!("notification permission: {}", e.localizedDescription());
            } else if !granted.as_bool() {
                tracing::info!("notifications are turned off for Email in System Settings");
            }
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &answered,
        );
        true
    }

    /// Post one; false when the center isn't in use (then notify-rust shows it).
    pub fn show(summary: &str, body: &str, folder_id: i64, target: Option<i64>) -> bool {
        if APP.get().is_none() {
            return false;
        }
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(summary));
        content.setBody(&NSString::from_str(body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        let id = make_id(folder_id, target, SEQ.fetch_add(1, Ordering::Relaxed));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&id), &content, None);
        let done = RcBlock::new(|error: *mut NSError| {
            if let Some(e) = unsafe { error.as_ref() } {
                tracing::warn!("showing a notification: {}", e.localizedDescription());
            }
        });
        UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, Some(&done));
        true
    }

    /// A notification's identifier says what a click opens: "mail.<folder>.<message or ->.<n>".
    pub(super) fn make_id(folder_id: i64, target: Option<i64>, n: u64) -> String {
        format!("mail.{folder_id}.{}.{n}", target.map_or("-".to_string(), |t| t.to_string()))
    }

    pub(super) fn parse_id(id: &str) -> Option<(i64, Option<i64>)> {
        let mut parts = id.strip_prefix("mail.")?.split('.');
        let folder_id = parts.next()?.parse().ok()?;
        let target = match parts.next()? {
            "-" => None,
            t => Some(t.parse().ok()?),
        };
        Some((folder_id, target))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(name: &str) -> NewMessage {
        NewMessage { id: 1, from_name: name.into(), from_addr: format!("{name}@example.com"), subject: String::new() }
    }

    #[test]
    fn sender_lists() {
        assert_eq!(senders(&[msg("Ann"), msg("Ann")]), "From Ann");
        assert_eq!(senders(&[msg("Ann"), msg("Bob")]), "From Ann and Bob");
        assert_eq!(senders(&[msg("Ann"), msg("Bob"), msg("Cy")]), "From Ann, Bob and Cy");
        assert_eq!(senders(&[msg("Ann"), msg("Bob"), msg("Cy"), msg("Di")]), "From Ann, Bob and 2 others");
        assert_eq!(sender(&msg("")), "@example.com");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_click_finds_its_message() {
        use super::mac::{make_id, parse_id};
        assert_eq!(parse_id(&make_id(7, Some(1234), 3)), Some((7, Some(1234))));
        assert_eq!(parse_id(&make_id(7, None, 4)), Some((7, None)));
        assert_eq!(parse_id("something else"), None);
    }
}
