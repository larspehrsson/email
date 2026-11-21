//! Signatures: named rich-text blocks put under what's written (above a reply's quote), and
//! each account's default one for new messages and for replies and forwards. Kept here, on
//! this computer, like tag definitions.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    pub id: i64,
    pub name: String,
    /// The composer's HTML (bold, italic, links, lists…).
    pub html: String,
}

/// An account's default signatures (None: none).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignatureDefaults {
    pub account_id: i64,
    pub new_id: Option<i64>,
    pub reply_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Signatures {
    pub signatures: Vec<Signature>,
    pub defaults: Vec<SignatureDefaults>,
}
