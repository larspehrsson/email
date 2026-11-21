//! Google Contacts, two ways: a Gmail (or Workspace) account's contacts in the address book,
//! kept in step with the Google People API.
//!
//! Signing in needs an OAuth client of the user's own (a Desktop app client in Google Cloud
//! Console; its ID and secret are kept in the keychain), then each account is connected with a
//! browser sign-in (its refresh token kept in the keychain too).
//!
//! What a sync does, and the rules that keep the user's real contacts safe:
//! - Send first: contacts deleted here (`card_tombstones`) are deleted there; contacts changed
//!   or made here (`card_links.dirty`) are updated or created there. Only the user's own edits
//!   mark a card changed; a sync never does, so nothing echoes back and forth. An update sends
//!   only the fields the app edits, rebuilt from the person as last seen, so types ("work",
//!   "mobile"), titles and everything else stay as they were. A conflict (changed there since)
//!   reads it again and sends ours on top once; gone there, the card stays here, unlinked.
//! - Then read: what changed there since the last sync (a sync token), or everything the first
//!   time (or when the token has expired, after 7 days). Nothing is applied until every page
//!   has arrived. A contact changed there replaces the card here, unless it was changed here
//!   too (ours goes next time). After a whole-list read, cards whose contact wasn't in it are
//!   deleted here: only then, and never ones changed here.
//! - The first sync only reads. Cards already in the address book stay local.
//! - Disconnecting (or removing the account) removes its cards here and changes nothing there.

use std::collections::HashSet;

use anyhow::{Result, anyhow};
use serde::Serialize;
use serde_json::{Value, json};

use crate::addressbook::Card;
use crate::store::Store;

/// The fields a sync reads, and the ones an update replaces.
pub const PERSON_FIELDS: &str = "names,emailAddresses,phoneNumbers,organizations,biographies,metadata";
pub const UPDATE_FIELDS: &str = "names,emailAddresses,phoneNumbers,organizations,biographies";

/// An account linked to its Google contacts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleLink {
    pub account_id: i64,
    /// The Google account signed in with.
    pub google_email: String,
    #[serde(skip)]
    pub sync_token: Option<String>,
    /// Last good sync (Unix seconds).
    pub synced: Option<i64>,
    /// What went wrong last time, if anything ("sign in again" among them).
    pub error: Option<String>,
    /// Contacts here from it.
    pub count: u32,
}

/// A card that is a Google contact.
#[derive(Debug, Clone, PartialEq)]
pub struct CardLink {
    pub card_id: i64,
    pub account_id: i64,
    /// `people/c…`; None: still to be created there.
    pub resource: Option<String>,
    pub etag: Option<String>,
    /// The person as last seen (JSON).
    pub raw: Option<String>,
    /// Changed here since: to send.
    pub dirty: bool,
}

#[derive(Debug)]
pub enum PeopleError {
    /// The sync token is too old: read everything again.
    ExpiredSyncToken,
    NotFound,
    /// Changed there since our copy (etag).
    Conflict,
    /// The sign-in is no good any more.
    SignIn(String),
    Other(anyhow::Error),
}

impl std::fmt::Display for PeopleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PeopleError::ExpiredSyncToken => write!(f, "the sync token expired"),
            PeopleError::NotFound => write!(f, "no such contact"),
            PeopleError::Conflict => write!(f, "the contact changed in Google meanwhile"),
            PeopleError::SignIn(why) => write!(f, "Google needs you to connect again ({why})"),
            PeopleError::Other(e) => write!(f, "{e:#}"),
        }
    }
}

impl std::error::Error for PeopleError {}

impl From<anyhow::Error> for PeopleError {
    fn from(e: anyhow::Error) -> Self {
        PeopleError::Other(e)
    }
}

/// One page of the contacts list.
pub struct ListPage {
    pub people: Vec<Value>,
    pub next_page: Option<String>,
    pub next_sync_token: Option<String>,
}

/// What a sync needs from Google (the People API; a fake in the tests).
#[allow(async_fn_in_trait)]
pub trait PeopleApi {
    async fn list(&self, sync_token: Option<&str>, page: Option<&str>) -> Result<ListPage, PeopleError>;
    async fn get(&self, resource: &str) -> Result<Value, PeopleError>;
    async fn create(&self, person: &Value) -> Result<Value, PeopleError>;
    async fn update(&self, resource: &str, person: &Value) -> Result<Value, PeopleError>;
    async fn delete(&self, resource: &str) -> Result<(), PeopleError>;
}

// ------------------------------------------------------------- mapping

fn first<'a>(p: &'a Value, field: &str) -> Option<&'a Value> {
    p.get(field)?.as_array()?.first()
}

fn text(v: Option<&Value>, key: &str) -> String {
    v.and_then(|v| v.get(key)).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

/// The name a person shows as.
fn person_name(p: &Value) -> String {
    let n = first(p, "names");
    let shown = text(n, "displayName");
    if !shown.is_empty() {
        return shown;
    }
    let free = text(n, "unstructuredName");
    if !free.is_empty() {
        return free;
    }
    [text(n, "givenName"), text(n, "familyName")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ")
}

fn values(p: &Value, field: &str) -> Vec<String> {
    p.get(field)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|e| e.get("value").and_then(Value::as_str)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default()
}

/// A Google person as a card (of account `account_id`).
pub fn card_from_person(p: &Value, account_id: i64) -> Card {
    Card {
        id: 0,
        name: person_name(p),
        emails: values(p, "emailAddresses"),
        phones: values(p, "phoneNumbers"),
        company: text(first(p, "organizations"), "name"),
        notes: first(p, "biographies").and_then(|b| b.get("value")).and_then(Value::as_str).unwrap_or("").trim().to_string(),
        google: Some(account_id),
    }
    .cleaned()
}

/// Only these keys of an entry are sent back (the rest is output only, or the server's).
fn keep(v: &Value, keys: &[&str]) -> Value {
    let mut out = serde_json::Map::new();
    for k in keys {
        if let Some(x) = v.get(*k) {
            out.insert((*k).to_string(), x.clone());
        }
    }
    Value::Object(out)
}

/// Entries for `wanted` values, each the one there was for it (same value, any case: its type
/// kept) or a new one.
fn entries(raw: &Value, field: &str, wanted: &[String], keys: &[&str]) -> Value {
    let old: Vec<Value> = raw.get(field).and_then(Value::as_array).cloned().unwrap_or_default();
    Value::Array(
        wanted
            .iter()
            .map(|w| {
                old.iter()
                    .find(|e| e.get("value").and_then(Value::as_str).is_some_and(|v| v.trim().eq_ignore_ascii_case(w)))
                    .map(|e| {
                        let mut k = keep(e, keys);
                        k["value"] = json!(w);
                        k
                    })
                    .unwrap_or_else(|| json!({ "value": w }))
            })
            .collect(),
    )
}

/// The person to send for a card: the fields the app edits (`UPDATE_FIELDS`) from the card,
/// on top of the person as last seen (`raw`, empty for a new one).
pub fn person_from_card(raw: &Value, card: &Card) -> Value {
    let card = card.clone().cleaned();
    let names = if card.name.is_empty() {
        json!([])
    } else if person_name(raw) == card.name {
        let n = first(raw, "names").cloned().unwrap_or(json!({}));
        json!([keep(
            &n,
            &["givenName", "familyName", "middleName", "honorificPrefix", "honorificSuffix", "unstructuredName", "phoneticGivenName", "phoneticFamilyName"]
        )])
    } else {
        json!([{ "unstructuredName": card.name }])
    };
    let mut orgs: Vec<Value> = raw
        .get("organizations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|o| keep(o, &["name", "title", "department", "type", "jobDescription", "location"]))
        .collect();
    match (orgs.first_mut(), card.company.is_empty()) {
        (Some(o), false) => o["name"] = json!(card.company),
        (Some(o), true) => {
            if let Some(m) = o.as_object_mut() {
                m.remove("name");
            }
            if o.as_object().is_some_and(|m| m.is_empty()) {
                orgs.remove(0);
            }
        }
        (None, false) => orgs.push(json!({ "name": card.company })),
        (None, true) => {}
    }
    let bios = if card.notes.is_empty() { json!([]) } else { json!([{ "value": card.notes, "contentType": "TEXT_PLAIN" }]) };
    let mut p = json!({
        "names": names,
        "emailAddresses": entries(raw, "emailAddresses", &card.emails, &["type"]),
        "phoneNumbers": entries(raw, "phoneNumbers", &card.phones, &["type"]),
        "organizations": orgs,
        "biographies": bios,
    });
    // The version this is based on (for an update): the contact source's etag.
    if let Some(etag) = raw.get("etag") {
        p["etag"] = etag.clone();
    }
    if let Some(sources) = raw.pointer("/metadata/sources").and_then(Value::as_array) {
        let contact: Vec<Value> =
            sources.iter().filter(|s| s.get("type").and_then(Value::as_str) == Some("CONTACT")).map(|s| keep(s, &["type", "id", "etag"])).collect();
        if !contact.is_empty() {
            p["metadata"] = json!({ "sources": contact });
        }
    }
    p
}

fn resource_of(p: &Value) -> Option<String> {
    p.get("resourceName").and_then(Value::as_str).map(str::to_string)
}

fn etag_of(p: &Value) -> Option<String> {
    p.get("etag").and_then(Value::as_str).map(str::to_string)
}

fn link_with(card_id: i64, account_id: i64, p: &Value) -> CardLink {
    CardLink { card_id, account_id, resource: resource_of(p), etag: etag_of(p), raw: Some(p.to_string()), dirty: false }
}

// ------------------------------------------------------------- the sync

/// What a sync did.
#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub sent: u32,
    pub added: u32,
    pub changed: u32,
    pub removed: u32,
}

impl SyncReport {
    pub fn any(&self) -> bool {
        self.sent + self.added + self.changed + self.removed > 0
    }
}

fn other(e: PeopleError) -> anyhow::Error {
    anyhow!("{e}")
}

/// Sync account `account_id`'s Google contacts with the address book (see the module doc).
pub async fn sync<A: PeopleApi>(store: &Store, account_id: i64, api: &A, now: i64) -> Result<SyncReport> {
    let link = store.google_link(account_id)?.ok_or_else(|| anyhow!("Google Contacts isn't connected for this account."))?;
    let mut report = SyncReport::default();
    // Sent in this run: what the read brings back of them may be from before.
    let mut pushed: HashSet<String> = HashSet::new();

    // ---- send: deletions, then changes and new ones, one at a time.
    for resource in store.card_tombstones(account_id)? {
        match api.delete(&resource).await {
            Ok(()) | Err(PeopleError::NotFound) => store.remove_card_tombstone(account_id, &resource)?,
            Err(e) => return Err(other(e)),
        }
        report.sent += 1;
    }
    for l in store.card_links(account_id)?.into_iter().filter(|l| l.dirty) {
        let Some(card) = store.card(l.card_id)? else {
            store.delete_card_link(l.card_id)?;
            continue;
        };
        let raw: Value = l.raw.as_deref().and_then(|r| serde_json::from_str(r).ok()).unwrap_or(json!({}));
        let sent = match &l.resource {
            None => api.create(&person_from_card(&json!({}), &card)).await.map_err(other)?,
            Some(res) => match api.update(res, &person_from_card(&raw, &card)).await {
                Ok(p) => p,
                Err(PeopleError::Conflict) => {
                    // Changed there meanwhile: ours on top of theirs, once.
                    let fresh = match api.get(res).await {
                        Ok(f) => f,
                        Err(PeopleError::NotFound) => {
                            store.delete_card_link(l.card_id)?;
                            continue;
                        }
                        Err(e) => return Err(other(e)),
                    };
                    api.update(res, &person_from_card(&fresh, &card)).await.map_err(other)?
                }
                Err(PeopleError::NotFound) => {
                    // Gone there: kept here, as a card of this computer's.
                    store.delete_card_link(l.card_id)?;
                    continue;
                }
                Err(e) => return Err(other(e)),
            },
        };
        if let Some(r) = resource_of(&sent) {
            pushed.insert(r);
        }
        store.save_card_link(&link_with(l.card_id, account_id, &sent))?;
        report.sent += 1;
    }

    // ---- read: every page first, then apply.
    let mut token = link.sync_token.clone();
    let (people, next_token, full) = 'read: loop {
        let full = token.is_none();
        let mut people = Vec::new();
        let mut page: Option<String> = None;
        loop {
            match api.list(token.as_deref(), page.as_deref()).await {
                Ok(p) => {
                    people.extend(p.people);
                    match p.next_page {
                        Some(next) => page = Some(next),
                        None => break 'read (people, p.next_sync_token, full),
                    }
                }
                Err(PeopleError::ExpiredSyncToken) if !full => {
                    token = None;
                    continue 'read;
                }
                Err(e) => return Err(other(e)),
            }
        }
    };

    let links = store.card_links(account_id)?;
    let by_resource = |r: &str| links.iter().find(|l| l.resource.as_deref() == Some(r));
    let mut seen: HashSet<String> = HashSet::new();
    for p in &people {
        let Some(res) = resource_of(p) else { continue };
        seen.insert(res.clone());
        if pushed.contains(&res) {
            continue;
        }
        let deleted = p.pointer("/metadata/deleted").and_then(Value::as_bool).unwrap_or(false);
        match by_resource(&res) {
            Some(l) if deleted => {
                if !l.dirty {
                    store.delete_card(l.card_id)?;
                    report.removed += 1;
                }
            }
            None if deleted => {}
            Some(l) if l.dirty => {
                // Changed on both sides: ours goes next time, on top of this version.
                store.save_card_link(&CardLink { dirty: true, ..link_with(l.card_id, account_id, p) })?;
            }
            Some(l) => {
                let card = card_from_person(p, account_id);
                if card.title().is_empty() {
                    continue;
                }
                let before = store.card(l.card_id)?;
                if before.as_ref().is_none_or(|b| !same(b, &card)) {
                    store.save_card(Card { id: l.card_id, ..card })?;
                    report.changed += 1;
                }
                store.save_card_link(&link_with(l.card_id, account_id, p))?;
            }
            None => {
                let card = card_from_person(p, account_id);
                // Nothing to show it by (a phone number alone): left out.
                if card.title().is_empty() {
                    continue;
                }
                let id = store.save_card(card)?;
                store.save_card_link(&link_with(id, account_id, p))?;
                report.added += 1;
            }
        }
    }
    if full {
        // Read whole: those not in it are gone there.
        for l in store.card_links(account_id)? {
            if let Some(r) = &l.resource
                && !l.dirty
                && !seen.contains(r)
            {
                store.delete_card(l.card_id)?;
                report.removed += 1;
            }
        }
    }
    store.set_google_sync(account_id, next_token.as_deref(), Some(now), None)?;
    Ok(report)
}

fn same(a: &Card, b: &Card) -> bool {
    a.name == b.name && a.emails == b.emails && a.phones == b.phones && a.company == b.company && a.notes == b.notes
}

// ------------------------------------------------------------- Google, over HTTPS

const PEOPLE_HOST: &str = "people.googleapis.com";

/// The People API with an access token.
pub struct GoogleApi {
    pub access_token: String,
}

impl GoogleApi {
    async fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value, PeopleError> {
        let auth = format!("Bearer {}", self.access_token);
        let body_text = body.map(Value::to_string).unwrap_or_default();
        let mut headers = vec![("Authorization", auth.as_str())];
        if body.is_some() {
            headers.push(("Content-Type", "application/json"));
        }
        let (status, text) = crate::oauth::https(PEOPLE_HOST, method, path, &headers, &body_text).await?;
        if (200..300).contains(&status) {
            return Ok(if text.trim().is_empty() { json!({}) } else { serde_json::from_str(&text).map_err(|e| anyhow!("Google's answer: {e}"))? });
        }
        let v: Value = serde_json::from_str(&text).unwrap_or(json!({}));
        let message = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("").to_string();
        Err(match status {
            _ if text.contains("EXPIRED_SYNC_TOKEN") => PeopleError::ExpiredSyncToken,
            404 => PeopleError::NotFound,
            401 => PeopleError::SignIn(message),
            400 if text.contains("FAILED_PRECONDITION") || text.contains("failedPrecondition") => PeopleError::Conflict,
            _ => PeopleError::Other(anyhow!("Google Contacts answered {status}: {message}")),
        })
    }
}

fn q(s: &str) -> String {
    form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

impl PeopleApi for GoogleApi {
    async fn list(&self, sync_token: Option<&str>, page: Option<&str>) -> Result<ListPage, PeopleError> {
        let mut path = format!("/v1/people/me/connections?personFields={}&pageSize=1000&requestSyncToken=true", q(PERSON_FIELDS));
        if let Some(t) = sync_token {
            path.push_str(&format!("&syncToken={}", q(t)));
        }
        if let Some(p) = page {
            path.push_str(&format!("&pageToken={}", q(p)));
        }
        let v = self.call("GET", &path, None).await?;
        Ok(ListPage {
            people: v.get("connections").and_then(Value::as_array).cloned().unwrap_or_default(),
            next_page: v.get("nextPageToken").and_then(Value::as_str).map(str::to_string),
            next_sync_token: v.get("nextSyncToken").and_then(Value::as_str).map(str::to_string),
        })
    }

    async fn get(&self, resource: &str) -> Result<Value, PeopleError> {
        self.call("GET", &format!("/v1/{resource}?personFields={}", q(PERSON_FIELDS)), None).await
    }

    async fn create(&self, person: &Value) -> Result<Value, PeopleError> {
        self.call("POST", &format!("/v1/people:createContact?personFields={}", q(PERSON_FIELDS)), Some(person)).await
    }

    async fn update(&self, resource: &str, person: &Value) -> Result<Value, PeopleError> {
        self.call(
            "PATCH",
            &format!("/v1/{resource}:updateContact?updatePersonFields={}&personFields={}", q(UPDATE_FIELDS), q(PERSON_FIELDS)),
            Some(person),
        )
        .await
    }

    async fn delete(&self, resource: &str) -> Result<(), PeopleError> {
        self.call("DELETE", &format!("/v1/{resource}:deleteContact"), None).await.map(|_| ())
    }
}

// ------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Provider;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    /// Google, in memory: contacts by resource, a change log for sync tokens, and switches for
    /// what can go wrong.
    #[derive(Default)]
    struct Fake {
        people: RefCell<BTreeMap<String, Value>>,
        /// (version, resource) of every change; a token is the version it was given at.
        log: RefCell<Vec<(u32, String)>>,
        version: RefCell<u32>,
        seq: RefCell<u32>,
        page_size: usize,
        fail_page: RefCell<Option<usize>>,
        expire: RefCell<bool>,
        calls: RefCell<Vec<String>>,
    }

    impl Fake {
        fn new(page_size: usize) -> Fake {
            Fake { page_size, ..Default::default() }
        }
        fn bump(&self, res: &str) {
            *self.version.borrow_mut() += 1;
            let v = *self.version.borrow();
            self.log.borrow_mut().push((v, res.to_string()));
        }
        /// A contact made in Google (not by the app).
        fn add(&self, name: &str, email: &str, kind: &str) -> String {
            *self.seq.borrow_mut() += 1;
            let res = format!("people/c{}", self.seq.borrow());
            let etag = format!("e{}", self.version.borrow());
            self.people.borrow_mut().insert(
                res.clone(),
                json!({
                    "resourceName": res, "etag": etag,
                    "metadata": { "sources": [{ "type": "CONTACT", "id": "x", "etag": etag }] },
                    "names": [{ "displayName": name, "givenName": name }],
                    "emailAddresses": [{ "value": email, "type": kind, "formattedType": "Work" }],
                    "organizations": [{ "name": "Acme", "title": "CTO" }],
                }),
            );
            self.bump(&res);
            res
        }
        fn edit(&self, res: &str, f: impl FnOnce(&mut Value)) {
            let mut people = self.people.borrow_mut();
            let p = people.get_mut(res).unwrap();
            f(p);
            let etag = format!("e{}x", self.version.borrow());
            p["etag"] = json!(etag);
            p["metadata"]["sources"][0]["etag"] = json!(etag);
            drop(people);
            self.bump(res);
        }
        fn remove(&self, res: &str) {
            self.people.borrow_mut().remove(res);
            self.bump(res);
        }
    }

    impl PeopleApi for Fake {
        async fn list(&self, sync_token: Option<&str>, page: Option<&str>) -> Result<ListPage, PeopleError> {
            self.calls.borrow_mut().push(format!("list {sync_token:?} {page:?}"));
            if sync_token.is_some() && *self.expire.borrow() {
                *self.expire.borrow_mut() = false;
                return Err(PeopleError::ExpiredSyncToken);
            }
            let all: Vec<Value> = match sync_token {
                None => self.people.borrow().values().cloned().collect(),
                Some(t) => {
                    let since: u32 = t.parse().unwrap();
                    let mut changed: Vec<String> =
                        self.log.borrow().iter().filter(|(v, _)| *v > since).map(|(_, r)| r.clone()).collect();
                    changed.dedup();
                    changed
                        .into_iter()
                        .collect::<std::collections::BTreeSet<_>>()
                        .into_iter()
                        .map(|r| self.people.borrow().get(&r).cloned().unwrap_or(json!({ "resourceName": r, "metadata": { "deleted": true } })))
                        .collect()
                }
            };
            let at: usize = page.map(|p| p.parse().unwrap()).unwrap_or(0);
            if *self.fail_page.borrow() == Some(at) {
                return Err(PeopleError::Other(anyhow!("network")));
            }
            let end = (at + self.page_size).min(all.len());
            let last = end >= all.len();
            Ok(ListPage {
                people: all[at..end].to_vec(),
                next_page: (!last).then(|| end.to_string()),
                next_sync_token: last.then(|| self.version.borrow().to_string()),
            })
        }
        async fn get(&self, resource: &str) -> Result<Value, PeopleError> {
            self.people.borrow().get(resource).cloned().ok_or(PeopleError::NotFound)
        }
        async fn create(&self, person: &Value) -> Result<Value, PeopleError> {
            self.calls.borrow_mut().push("create".into());
            *self.seq.borrow_mut() += 1;
            let res = format!("people/c{}", self.seq.borrow());
            let mut p = person.clone();
            p["resourceName"] = json!(res);
            p["etag"] = json!("new");
            p["metadata"] = json!({ "sources": [{ "type": "CONTACT", "id": "y", "etag": "new" }] });
            self.people.borrow_mut().insert(res.clone(), p.clone());
            self.bump(&res);
            Ok(p)
        }
        async fn update(&self, resource: &str, person: &Value) -> Result<Value, PeopleError> {
            self.calls.borrow_mut().push(format!("update {resource}"));
            let mut people = self.people.borrow_mut();
            let Some(cur) = people.get_mut(resource) else { return Err(PeopleError::NotFound) };
            if person.pointer("/metadata/sources/0/etag") != cur.pointer("/metadata/sources/0/etag") {
                return Err(PeopleError::Conflict);
            }
            for f in UPDATE_FIELDS.split(',') {
                cur[f] = person[f].clone();
            }
            // The server works out the shown name.
            if let Some(n) = cur["names"][0]["unstructuredName"].as_str().map(str::to_string) {
                cur["names"][0]["displayName"] = json!(n);
            }
            let etag = format!("u{}", self.version.borrow());
            cur["etag"] = json!(etag);
            cur["metadata"]["sources"][0]["etag"] = json!(etag);
            let out = cur.clone();
            drop(people);
            self.bump(resource);
            Ok(out)
        }
        async fn delete(&self, resource: &str) -> Result<(), PeopleError> {
            self.calls.borrow_mut().push(format!("delete {resource}"));
            if self.people.borrow_mut().remove(resource).is_none() {
                return Err(PeopleError::NotFound);
            }
            self.bump(resource);
            Ok(())
        }
    }

    fn setup(name: &str) -> (std::path::PathBuf, Store, i64) {
        let dir = std::env::temp_dir().join(format!("mail-core-gc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::open(&dir).unwrap();
        let a = store.insert_account("me@gmail.com", "me", Provider::Gmail, "imap.gmail.com", 993).unwrap();
        store.set_google_link(a.id, "me@gmail.com").unwrap();
        (dir, store, a.id)
    }
    fn names(store: &Store) -> Vec<String> {
        store.cards().unwrap().into_iter().map(|c| c.name).collect()
    }
    fn block<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().build().unwrap().block_on(f)
    }

    #[test]
    fn first_sync_reads_only_and_keeps_local_cards() {
        let (dir, store, acct) = setup("first");
        store.save_card(Card { name: "Local Person".into(), emails: vec!["l@x.com".into()], ..Default::default() }).unwrap();
        let g = Fake::new(2);
        g.add("Ann", "ann@x.com", "work");
        g.add("Bob", "bob@x.com", "home");
        g.add("Cid", "cid@x.com", "work");
        let r = block(sync(&store, acct, &g, 100)).unwrap();
        assert_eq!(r, SyncReport { added: 3, ..Default::default() });
        assert_eq!(names(&store), ["Ann", "Bob", "Cid", "Local Person"]);
        assert!(g.calls.borrow().iter().all(|c| c.starts_with("list")), "nothing written: {:?}", g.calls.borrow());
        let local = store.cards().unwrap().into_iter().find(|c| c.name == "Local Person").unwrap();
        assert_eq!(local.google, None, "stays local");
        let ann = store.cards().unwrap().into_iter().find(|c| c.name == "Ann").unwrap();
        assert_eq!((ann.google, ann.company.as_str()), (Some(acct), "Acme"));
        // Nothing changed: nothing happens.
        assert!(!block(sync(&store, acct, &g, 101)).unwrap().any());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changes_there_come_here_and_deletes_go() {
        let (dir, store, acct) = setup("pull");
        let g = Fake::new(10);
        let ann = g.add("Ann", "ann@x.com", "work");
        let bob = g.add("Bob", "bob@x.com", "home");
        block(sync(&store, acct, &g, 1)).unwrap();
        g.edit(&ann, |p| p["names"][0]["displayName"] = json!("Ann Smith"));
        g.remove(&bob);
        let r = block(sync(&store, acct, &g, 2)).unwrap();
        assert_eq!((r.changed, r.removed), (1, 1));
        assert_eq!(names(&store), ["Ann Smith"]);
        assert!(g.calls.borrow().iter().any(|c| c.starts_with("list Some")), "incremental");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_expired_token_reads_everything_again() {
        let (dir, store, acct) = setup("expired");
        let g = Fake::new(10);
        g.add("Ann", "ann@x.com", "work");
        let bob = g.add("Bob", "bob@x.com", "home");
        block(sync(&store, acct, &g, 1)).unwrap();
        // Gone there while the token aged: the whole list doesn't have it.
        g.people.borrow_mut().remove(&bob);
        *g.expire.borrow_mut() = true;
        let r = block(sync(&store, acct, &g, 2)).unwrap();
        assert_eq!(r.removed, 1);
        assert_eq!(names(&store), ["Ann"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_page_failing_changes_nothing() {
        let (dir, store, acct) = setup("pagefail");
        let g = Fake::new(1);
        g.add("Ann", "ann@x.com", "work");
        g.add("Bob", "bob@x.com", "home");
        *g.fail_page.borrow_mut() = Some(1);
        assert!(block(sync(&store, acct, &g, 1)).is_err());
        assert!(names(&store).is_empty(), "nothing applied from the first page alone");
        *g.fail_page.borrow_mut() = None;
        block(sync(&store, acct, &g, 2)).unwrap();
        assert_eq!(names(&store), ["Ann", "Bob"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edits_here_go_there_keeping_what_the_app_doesnt_edit() {
        let (dir, store, acct) = setup("push");
        let g = Fake::new(10);
        let ann = g.add("Ann", "ann@x.com", "work");
        block(sync(&store, acct, &g, 1)).unwrap();
        let card = store.cards().unwrap().into_iter().find(|c| c.name == "Ann").unwrap();
        // A user's edit: the card changes and its link is marked (what Core::save_card does).
        store.save_card(Card { emails: vec!["ANN@x.com".into(), "ann@home.org".into()], notes: "Met at the fair".into(), ..card.clone() }).unwrap();
        let mut l = store.card_link(card.id).unwrap().unwrap();
        l.dirty = true;
        store.save_card_link(&l).unwrap();
        let r = block(sync(&store, acct, &g, 2)).unwrap();
        assert_eq!(r.sent, 1);
        let there = g.people.borrow()[&ann].clone();
        assert_eq!(there["emailAddresses"][0], json!({ "value": "ANN@x.com", "type": "work" }), "type kept, output-only fields not sent");
        assert_eq!(there["emailAddresses"][1], json!({ "value": "ann@home.org" }));
        assert_eq!(there["organizations"][0]["title"], "CTO", "kept");
        assert_eq!(there["biographies"][0]["value"], "Met at the fair");
        assert_eq!(there["names"][0]["givenName"], "Ann", "the name unchanged: sent as it was");
        assert!(!store.card_link(card.id).unwrap().unwrap().dirty);
        // A sync after it doesn't bring it back as a change.
        assert!(!block(sync(&store, acct, &g, 3)).unwrap().any());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_conflict_reads_theirs_and_sends_ours_on_top() {
        let (dir, store, acct) = setup("conflict");
        let g = Fake::new(10);
        let ann = g.add("Ann", "ann@x.com", "work");
        block(sync(&store, acct, &g, 1)).unwrap();
        g.edit(&ann, |p| p["organizations"][0]["title"] = json!("CEO"));
        let card = store.cards().unwrap()[0].clone();
        store.save_card(Card { company: "Acme Ltd".into(), ..card.clone() }).unwrap();
        let mut l = store.card_link(card.id).unwrap().unwrap();
        l.dirty = true;
        store.save_card_link(&l).unwrap();
        block(sync(&store, acct, &g, 2)).unwrap();
        let there = g.people.borrow()[&ann].clone();
        assert_eq!((there["organizations"][0]["name"].as_str(), there["organizations"][0]["title"].as_str()), (Some("Acme Ltd"), Some("CEO")));
        assert_eq!(store.cards().unwrap()[0].company, "Acme Ltd");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn made_and_deleted_here() {
        let (dir, store, acct) = setup("create");
        let g = Fake::new(10);
        let bob = g.add("Bob", "bob@x.com", "home");
        block(sync(&store, acct, &g, 1)).unwrap();
        // New in this account's contacts (Core::save_card with google = account).
        let id = store.save_card(Card { name: "New One".into(), emails: vec!["n@x.com".into()], ..Default::default() }).unwrap();
        store.save_card_link(&CardLink { card_id: id, account_id: acct, resource: None, etag: None, raw: None, dirty: true }).unwrap();
        // Bob deleted here (Core::delete_card).
        let b = store.cards().unwrap().into_iter().find(|c| c.name == "Bob").unwrap();
        store.add_card_tombstone(acct, &bob).unwrap();
        store.delete_card(b.id).unwrap();
        block(sync(&store, acct, &g, 2)).unwrap();
        let there: Vec<String> = g.people.borrow().values().map(person_name).collect();
        assert_eq!(there, ["New One"]);
        assert_eq!(names(&store), ["New One"]);
        assert!(store.card_link(id).unwrap().unwrap().resource.is_some());
        assert!(store.card_tombstones(acct).unwrap().is_empty());
        // Disconnecting takes its cards here, nothing there.
        store.remove_google_link(acct).unwrap();
        assert!(names(&store).is_empty());
        assert_eq!(g.people.borrow().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn people_without_a_name_or_address_are_left_out() {
        let p = json!({ "resourceName": "people/c1", "phoneNumbers": [{ "value": "+1 555" }] });
        assert!(card_from_person(&p, 1).title().is_empty());
        let p = json!({ "names": [{ "unstructuredName": "Jo" }] });
        assert_eq!(card_from_person(&p, 1).name, "Jo");
    }

    /// The real People API: `GOOGLE_ACCESS_TOKEN=… cargo test -p mail-core gcontacts::tests::live -- --ignored`
    /// (reads only).
    #[tokio::test]
    #[ignore]
    async fn live() {
        let token = std::env::var("GOOGLE_ACCESS_TOKEN").expect("GOOGLE_ACCESS_TOKEN");
        let api = GoogleApi { access_token: token };
        let page = api.list(None, None).await.unwrap();
        println!("{} people, next page: {}", page.people.len(), page.next_page.is_some());
    }
}
