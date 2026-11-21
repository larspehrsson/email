//! The address book: people the user keeps, with their addresses, phones, company and notes.
//! Kept here (mail.db), apart from the suggestions built from the mail (`contacts`); its people
//! come first in the composer's suggestions, under the names given here.

use serde::{Deserialize, Serialize};

use crate::model::Addr;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    /// 0 for one not saved yet.
    pub id: i64,
    pub name: String,
    pub emails: Vec<String>,
    pub phones: Vec<String>,
    pub company: String,
    pub notes: String,
    /// A Google contact of this account (Google Contacts linked in Settings); None: kept only
    /// here. For a new card, the account to create it in.
    #[serde(default)]
    pub google: Option<i64>,
}

impl Card {
    /// Trimmed, empty entries and repeated addresses (any case) dropped.
    pub fn cleaned(mut self) -> Card {
        self.name = self.name.trim().to_string();
        self.company = self.company.trim().to_string();
        self.notes = self.notes.trim().to_string();
        let mut seen = std::collections::HashSet::new();
        self.emails = self
            .emails
            .iter()
            .map(|e| e.trim().trim_start_matches("mailto:").to_string())
            .filter(|e| !e.is_empty() && seen.insert(e.to_ascii_lowercase()))
            .collect();
        self.phones = self.phones.iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
        self
    }

    /// What it's listed as: the name, else the company, else the first address.
    pub fn title(&self) -> &str {
        [self.name.as_str(), self.company.as_str()]
            .into_iter()
            .find(|s| !s.is_empty())
            .or_else(|| self.emails.first().map(String::as_str))
            .unwrap_or("")
    }
}

/// The cards' addresses matching what's typed (the start of a name word, the company, or an
/// address), in the order of the cards' names; one per address, named as in the card.
pub fn suggest(cards: &[Card], query: &str, limit: usize) -> Vec<Addr> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return vec![];
    }
    let words = |s: &str| s.to_lowercase().split([' ', '.', '_', '-', '\'', '@']).any(|w| !w.is_empty() && w.starts_with(&q));
    let mut hits: Vec<(&Card, &String)> = Vec::new();
    for c in cards {
        let card_hit = c.name.to_lowercase().starts_with(&q) || words(&c.name) || words(&c.company) || (q.contains(' ') && c.name.to_lowercase().contains(&q));
        for e in &c.emails {
            if card_hit || e.to_lowercase().starts_with(&q) || words(e) {
                hits.push((c, e));
            }
        }
    }
    hits.sort_by(|a, b| a.0.title().to_lowercase().cmp(&b.0.title().to_lowercase()).then_with(|| a.1.cmp(b.1)));
    hits.into_iter()
        .take(limit)
        .map(|(c, e)| Addr { name: (!c.name.is_empty()).then(|| c.name.clone()), addr: e.clone() })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(name: &str, emails: &[&str], company: &str) -> Card {
        Card { name: name.into(), emails: emails.iter().map(|s| s.to_string()).collect(), company: company.into(), ..Default::default() }
    }

    #[test]
    fn suggestions_by_name_company_or_address() {
        let cards = [card("Åsa Berg", &["asa@x.se", "asa.berg@y.com"], "Acme"), card("Bob Ek", &["bob@acme.com"], "")];
        let got = |q: &str| suggest(&cards, q, 10).into_iter().map(|a| a.addr).collect::<Vec<_>>();
        assert_eq!(got("åsa"), ["asa.berg@y.com", "asa@x.se"]);
        assert_eq!(got("berg"), ["asa.berg@y.com", "asa@x.se"]);
        assert_eq!(got("acme"), ["bob@acme.com", "asa.berg@y.com", "asa@x.se"], "the address's domain, or the company (Å after B)");
        assert_eq!(got("bob"), ["bob@acme.com"]);
        assert!(got("zed").is_empty() && got(" ").is_empty());
        assert_eq!(suggest(&cards, "bob", 1)[0].name.as_deref(), Some("Bob Ek"));
    }

    #[test]
    fn cleaned_and_titled() {
        let c = card("  ", &[" a@x ", "A@X", "", "mailto:b@y"], " Co ").cleaned();
        assert_eq!(c.emails, ["a@x", "b@y"]);
        assert_eq!(c.title(), "Co");
    }
}
