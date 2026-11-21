//! How a folder's list is ordered: by date received (newest first), or by sender or recipient
//! (A to Z, newest first within each). The list is grouped by the same thing it's sorted by,
//! so one function gives both the order and the groups: `sender_key` / `recipient_key`,
//! registered as SQL functions on every connection (`register`), so queries order and group
//! by exactly what this module says. By size, largest first, grouped in size ranges.
//!
//! A [`ListFilter`] narrows the list (unread, starred, with attachments); every query that
//! places rows takes the same one, so positions and groups agree with the rows shown.

use rusqlite::Connection;
use rusqlite::functions::FunctionFlags;
use serde::{Deserialize, Serialize};

/// The order of a folder's list.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ListSort {
    /// Newest first (grouped by day / week / month on screen).
    #[default]
    Received,
    /// By the sender's name (or address), A to Z.
    From,
    /// By the first recipient's name (or address), A to Z.
    To,
    /// Largest first.
    Size,
}

impl ListSort {
    /// SQL for a message's sort key (`m` = its `messages` row); None: by date alone.
    pub fn key_sql(self) -> Option<&'static str> {
        match self {
            ListSort::Received => None,
            ListSort::From => Some("sender_key(m.from_name, m.from_addr)"),
            ListSort::To => Some("recipient_key(m.to_addrs)"),
            // Ascending like the others, so the same comparisons place a row.
            ListSort::Size => Some("-m.size"),
        }
    }
}

/// Size ranges the list is grouped in when sorted by size, largest first: (smallest size in
/// the range, in bytes; label). eM Client's.
pub const SIZE_RANGES: [(i64, &str); 6] = [
    (10 << 20, "Huge (over 10 MB)"),
    (5 << 20, "Very large (5–10 MB)"),
    (1 << 20, "Large (1–5 MB)"),
    (100 << 10, "Medium (100 KB–1 MB)"),
    (25 << 10, "Small (25–100 KB)"),
    (0, "Tiny (under 25 KB)"),
];

/// Which of [`SIZE_RANGES`] a size is in.
pub fn size_range(size: i64) -> usize {
    SIZE_RANGES.iter().position(|&(min, _)| size >= min).unwrap_or(SIZE_RANGES.len() - 1)
}

/// What the list shows: all of the folder, or only some of it. All set conditions must hold.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListFilter {
    /// Some(false): unread only; Some(true): read only.
    pub read: Option<bool>,
    /// Starred only.
    pub flagged: bool,
    /// With attachments only.
    pub attachments: bool,
    /// Shown whatever the filter says: the open message (or conversation), so reading it (which
    /// makes it read) doesn't take it out from under the reader.
    pub keep: Option<i64>,
}

impl ListFilter {
    pub fn is_all(&self) -> bool {
        self.read.is_none() && !self.flagged && !self.attachments
    }

    /// SQL condition on `m` (messages) and `e` (entries): "" for all, else " AND (…)". The
    /// kept item is a message id, or with `threaded` a conversation id.
    pub fn sql(&self, threaded: bool) -> String {
        if self.is_all() {
            return String::new();
        }
        let mut c: Vec<&str> = Vec::new();
        match self.read {
            Some(false) => c.push("(m.flags & 1) = 0"),
            Some(true) => c.push("(m.flags & 1) != 0"),
            None => {}
        }
        if self.flagged {
            c.push("(m.flags & 2) != 0");
        }
        if self.attachments {
            c.push("m.has_attachments != 0");
        }
        let cond = c.join(" AND ");
        match self.keep {
            Some(id) if threaded => format!(" AND (({cond}) OR e.thread_id = {id})"),
            Some(id) => format!(" AND (({cond}) OR e.message_id = {id})"),
            None => format!(" AND ({cond})"),
        }
    }
}

/// A run of rows in a sorted list that share a sender, recipient or (by date) period.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListGroup {
    /// The sender or recipient as shown; None when sorted by date (the UI names the periods).
    pub label: Option<String>,
    pub count: u32,
}

/// Sorts after every real key: nobody to show goes last.
pub const NOBODY: &str = "\u{10FFFF}";

/// What the list shows for a sender: the name, or the address without one.
pub fn sender_shown<'a>(name: &'a str, addr: &'a str) -> &'a str {
    let n = name.trim();
    if n.is_empty() { addr.trim() } else { n }
}

/// What the list shows for a recipient list ("Name <addr>, …", To then Cc): the first one's
/// name, or its address.
pub fn recipient_shown(to_addrs: &str) -> String {
    match crate::contacts::parse_list(to_addrs).into_iter().next() {
        Some(a) => a.name.filter(|n| !n.trim().is_empty()).unwrap_or(a.addr),
        None => String::new(),
    }
}

/// The key a shown name sorts and groups by: case-folded (all of Unicode, so "Åsa" and "åsa"
/// are one), quotes around it and repeated spaces dropped. Empty: [`NOBODY`].
pub fn key(shown: &str) -> String {
    let t = shown.trim_matches(|c: char| c.is_whitespace() || "\"'`‘’“”«»<>".contains(c));
    if t.is_empty() {
        return NOBODY.to_string();
    }
    let mut out = String::with_capacity(t.len());
    for (i, w) in t.split_whitespace().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        out.extend(w.chars().flat_map(char::to_lowercase));
    }
    out
}

pub fn sender_key(name: &str, addr: &str) -> String {
    key(sender_shown(name, addr))
}

pub fn recipient_key(to_addrs: &str) -> String {
    key(&recipient_shown(to_addrs))
}

/// Make `sender_key(name, addr)` and `recipient_key(to_addrs)` available to SQL.
pub fn register(conn: &Connection) -> rusqlite::Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    conn.create_scalar_function("sender_key", 2, flags, |ctx| {
        let name: Option<String> = ctx.get(0)?;
        let addr: Option<String> = ctx.get(1)?;
        Ok(sender_key(name.as_deref().unwrap_or(""), addr.as_deref().unwrap_or("")))
    })?;
    conn.create_scalar_function("recipient_key", 1, flags, |ctx| {
        let to: Option<String> = ctx.get(0)?;
        Ok(recipient_key(to.as_deref().unwrap_or("")))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_fold_case_quotes_and_spaces() {
        assert_eq!(sender_key("  \"Åsa  Öberg\" ", "a@x"), "åsa öberg");
        assert_eq!(sender_key("", "Bob@X.com"), "bob@x.com");
        assert_eq!(sender_key("ALICE", "a@x"), sender_key("alice", "other@x"));
        assert_eq!(sender_key("", ""), NOBODY);
        assert!(sender_key("zed", "") < sender_key("", ""), "nobody sorts last");
    }

    #[test]
    fn size_ranges() {
        assert_eq!(SIZE_RANGES[size_range(20 << 20)].1, "Huge (over 10 MB)");
        assert_eq!(size_range(10 << 20), 0);
        assert_eq!(size_range((10 << 20) - 1), 1);
        assert_eq!(size_range(0), 5);
        assert_eq!(size_range(-1), 5);
    }

    #[test]
    fn filter_sql() {
        assert_eq!(ListFilter::default().sql(false), "");
        let f = ListFilter { read: Some(false), attachments: true, keep: Some(7), ..Default::default() };
        assert_eq!(f.sql(false), " AND (((m.flags & 1) = 0 AND m.has_attachments != 0) OR e.message_id = 7)");
        assert_eq!(f.sql(true), " AND (((m.flags & 1) = 0 AND m.has_attachments != 0) OR e.thread_id = 7)");
        assert_eq!(ListFilter { keep: Some(3), ..Default::default() }.sql(false), "", "keep alone doesn't filter");
    }

    #[test]
    fn recipient_is_the_first_one() {
        assert_eq!(recipient_shown("Doe, Jane <jane@x>, bob@y"), "Doe, Jane");
        assert_eq!(recipient_shown("bob@y, Jane <jane@x>"), "bob@y");
        assert_eq!(recipient_key(""), NOBODY);
    }
}
