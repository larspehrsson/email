//! The system's clock, 24-hour or 12-hour, for the frontend's times of day. The webview's
//! `Intl` goes by the language and region alone ("en-AU": 2:05 pm) and doesn't follow macOS's
//! own setting (System Settings › General › Date & Time › 24-hour time); this asks the system
//! and hands the answer to every window before its scripts run (`window.__MAIL_HOUR_CYCLE__`,
//! read by `lib/format.ts`). Elsewhere it's left to the language (None).

/// The hour cycle as `Intl` names it: "h23" (0–23) or "h12" (1–12 with am/pm).
pub fn hour_cycle() -> Option<&'static str> {
    imp::hour_pattern().as_deref().and_then(cycle_of)
}

/// The hour cycle a date pattern's hour field says: `H`/`k` 24-hour, `h`/`K` 12-hour (text in
/// quotes isn't a field).
fn cycle_of(pattern: &str) -> Option<&'static str> {
    let mut quoted = false;
    for c in pattern.chars() {
        match c {
            '\'' => quoted = !quoted,
            'H' | 'k' if !quoted => return Some("h23"),
            'h' | 'K' if !quoted => return Some("h12"),
            _ => {}
        }
    }
    None
}

/// The script every window runs first.
pub fn init_script() -> String {
    match hour_cycle() {
        Some(c) => format!("window.__MAIL_HOUR_CYCLE__ = '{c}';"),
        None => String::new(),
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use std::ffi::c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFLocaleCopyCurrent() -> *const c_void;
        fn CFDateFormatterCreateDateFormatFromTemplate(alloc: *const c_void, template: CFStringRef, options: usize, locale: *const c_void) -> CFStringRef;
        fn CFRelease(cf: *const c_void);
    }

    /// The user's own pattern for an hour ("j": the locale's preferred hour field, with the
    /// 24-hour setting applied): "HH" or "h a" and the like.
    pub fn hour_pattern() -> Option<String> {
        let template = CFString::new("j");
        // SAFETY: CFLocaleCopyCurrent's locale is ours to release (copy rule); the template is a
        // valid CFString borrowed for the call; the result, if any, is ours (create rule).
        unsafe {
            let locale = CFLocaleCopyCurrent();
            if locale.is_null() {
                return None;
            }
            let pattern = CFDateFormatterCreateDateFormatFromTemplate(std::ptr::null(), template.as_concrete_TypeRef(), 0, locale);
            CFRelease(locale);
            (!pattern.is_null()).then(|| CFString::wrap_under_create_rule(pattern).to_string())
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn hour_pattern() -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patterns() {
        assert_eq!(cycle_of("HH"), Some("h23"));
        assert_eq!(cycle_of("h a"), Some("h12"));
        assert_eq!(cycle_of("a h"), Some("h12"));
        assert_eq!(cycle_of("'h'H"), Some("h23"), "quoted text isn't the field");
        assert_eq!(cycle_of("K a"), Some("h12"));
        assert_eq!(cycle_of(""), None);
    }

    /// What this machine says: `cargo test -p mail-app clock -- --nocapture`.
    #[test]
    fn this_machine() {
        println!("hour pattern {:?} → {:?}", imp::hour_pattern(), hour_cycle());
        #[cfg(target_os = "macos")]
        assert!(hour_cycle().is_some());
    }
}
