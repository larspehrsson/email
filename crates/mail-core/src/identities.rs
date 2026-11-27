//! Other addresses an account sends as: an alias, an address at a domain whose mail comes to
//! the account (a catch-all), a Gmail "Send mail as" address. Each has its own name and its own
//! default signatures, and one can be what the account sends as unless told otherwise.
//!
//! Only the From header changes: the message still goes through the account's own server,
//! with the account's own address as the envelope sender, so the server has to allow sending
//! as the address (Gmail: "Send mail as"; most hosts: an alias of the mailbox).

use serde::{Deserialize, Serialize};

use crate::model::Addr;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    /// 0 for a new one (`save_identity`).
    #[serde(default)]
    pub id: i64,
    pub account_id: i64,
    pub email: String,
    /// The name mail from it is sent under; empty: the account's.
    #[serde(default)]
    pub name: String,
    /// Its default signatures for new messages and for replies and forwards; None: the
    /// account's.
    #[serde(default)]
    pub new_signature_id: Option<i64>,
    #[serde(default)]
    pub reply_signature_id: Option<i64>,
    /// What the account sends as unless told otherwise (at most one per account).
    #[serde(default)]
    pub is_default: bool,
}

/// What mail from an account goes out as: `identity` among `ids` (the account's), or the
/// account's own address when None.
pub fn sender(account_email: &str, account_name: &str, ids: &[Identity], identity: Option<i64>) -> Option<Addr> {
    let named = |n: &str| Some(n.trim().to_string()).filter(|n| !n.is_empty());
    match identity {
        None => Some(Addr { name: named(account_name), addr: account_email.to_string() }),
        Some(id) => {
            let i = ids.iter().find(|i| i.id == id)?;
            Some(Addr { name: named(&i.name).or_else(|| named(account_name)), addr: i.email.clone() })
        }
    }
}

/// Which address a reply (or forward) to mail sent to `to` (its To, Cc, Delivered-To…) goes out
/// from: the identity it was sent to; the account's own address if it was sent to that; an
/// identity at the same domain (a catch-all: mail to shop@ answered from the address there);
/// else the account's default. None: the account's own address.
pub fn for_reply(account_email: &str, ids: &[Identity], to: &[String]) -> Option<i64> {
    let same = |a: &str, b: &str| a.trim().eq_ignore_ascii_case(b.trim());
    for addr in to {
        if let Some(i) = ids.iter().find(|i| same(&i.email, addr)) {
            return Some(i.id);
        }
    }
    if to.iter().any(|a| same(a, account_email)) {
        return None;
    }
    let domain = |a: &str| a.rsplit_once('@').map(|(_, d)| d.trim().to_ascii_lowercase());
    for addr in to {
        let Some(d) = domain(addr) else { continue };
        let mut at = ids.iter().filter(|i| domain(&i.email).as_deref() == Some(d.as_str()));
        let first = at.next();
        // Several there: the default if it's one of them.
        if let Some(i) = ids.iter().find(|i| i.is_default && domain(&i.email).as_deref() == Some(d.as_str())).or(first) {
            return Some(i.id);
        }
    }
    default(ids)
}

/// The account's default identity, if it has one (else its own address).
pub fn default(ids: &[Identity]) -> Option<i64> {
    ids.iter().find(|i| i.is_default).map(|i| i.id)
}

/// The cleaned-up address and name of an identity to save, or why it can't be.
pub fn check(i: &Identity, account_email: &str, others: &[Identity]) -> Result<(String, String), String> {
    let email = i.email.trim().to_string();
    let valid = email.split_once('@').is_some_and(|(l, d)| !l.is_empty() && d.contains('.') && !d.starts_with('.') && !d.ends_with('.'))
        && !email.chars().any(|c| c.is_whitespace() || matches!(c, '<' | '>' | ',' | ';' | '"'));
    if !valid {
        return Err(format!("“{email}” isn't an email address."));
    }
    if email.eq_ignore_ascii_case(account_email) {
        return Err("That's the account's own address.".into());
    }
    if others.iter().any(|o| o.id != i.id && o.email.eq_ignore_ascii_case(&email)) {
        return Err(format!("{email} is already there."));
    }
    Ok((email, i.name.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(id: i64, email: &str, default: bool) -> Identity {
        Identity { id, account_id: 1, email: email.into(), name: String::new(), new_signature_id: None, reply_signature_id: None, is_default: default }
    }
    fn to(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn replies_go_out_from_the_address_mail_came_to() {
        let ids = [id(1, "lars@pehrsson.au", true), id(2, "info@shop.example", false)];
        let me = "lars@pehrsson.info";
        assert_eq!(for_reply(me, &ids, &to(&["Bob <x>", "INFO@shop.example"])), Some(2), "the identity, any case");
        assert_eq!(for_reply(me, &ids, &to(&["lars@pehrsson.info"])), None, "the account's own address");
        assert_eq!(for_reply(me, &ids, &to(&["webshop@pehrsson.au"])), Some(1), "a catch-all: the address at that domain");
        assert_eq!(for_reply(me, &ids, &to(&["list@lists.example"])), Some(1), "neither: the default");
        assert_eq!(for_reply(me, &[id(1, "a@b.example", false)], &to(&["list@lists.example"])), None, "no default: the account's own");
        // Several at the domain: the default one.
        let two = [id(1, "a@d.example", false), id(2, "b@d.example", true)];
        assert_eq!(for_reply(me, &two, &to(&["c@d.example"])), Some(2));
    }

    #[test]
    fn the_sender_has_the_identity_s_name_or_the_account_s() {
        let mut named = id(3, "lars@pehrsson.au", false);
        named.name = " Lars P ".into();
        let ids = [named, id(4, "x@y.example", false)];
        let s = |i| sender("lars@pehrsson.info", "Lars Pehrsson", &ids, i);
        assert_eq!(s(None), Some(Addr { name: Some("Lars Pehrsson".into()), addr: "lars@pehrsson.info".into() }));
        assert_eq!(s(Some(3)), Some(Addr { name: Some("Lars P".into()), addr: "lars@pehrsson.au".into() }));
        assert_eq!(s(Some(4)).unwrap().name.as_deref(), Some("Lars Pehrsson"), "no name of its own");
        assert_eq!(s(Some(99)), None, "not one of the account's");
    }

    #[test]
    fn checks_what_is_saved() {
        let others = [id(1, "a@b.example", false)];
        let c = |email: &str, id_: i64| check(&id(id_, email, false), "me@here.example", &others);
        assert_eq!(c(" new@b.example ", 0), Ok(("new@b.example".into(), String::new())));
        assert!(c("A@B.example", 0).is_err(), "already there");
        assert!(c("a@b.example", 1).is_ok(), "itself");
        assert!(c("ME@here.example", 0).is_err(), "the account's own");
        for bad in ["", "nobody", "x@", "@b.example", "x@local", "a b@c.example", "x@c.example>"] {
            assert!(c(bad, 0).is_err(), "{bad}");
        }
    }
}
