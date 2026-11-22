//! Quick-search query parsing: user syntax -> SQLite FTS5 MATCH expressions, per term, for
//! the header index (msg_fts) and the text of the messages (body_fts).
//!
//! Syntax: words are ANDed and prefix-matched across sender, recipients, subject and the
//! message's text; `"quoted phrases"`; `from:`, `to:`, `subject:`, `body:` restrict a term to
//! one field; `-term` excludes. Anything FTS5 would treat as an operator is quoted, so
//! arbitrary input is safe.

#[derive(Debug, PartialEq)]
struct Term {
    field: Option<&'static str>,
    text: String,
    negated: bool,
}

fn field_column(name: &str) -> Option<&'static str> {
    Some(match name.to_ascii_lowercase().as_str() {
        "from" => "sender",
        "to" | "cc" => "recipients",
        "subject" | "subj" => "subject",
        "body" | "text" => "body",
        _ => return None,
    })
}

fn parse(input: &str) -> Vec<Term> {
    let mut terms = Vec::new();
    let mut chars = input.chars().peekable();
    loop {
        while chars.peek().is_some_and(|c| c.is_whitespace()) {
            chars.next();
        }
        if chars.peek().is_none() {
            break;
        }
        let negated = chars.peek() == Some(&'-');
        if negated {
            chars.next();
        }
        // Read a raw token up to whitespace, honouring quotes anywhere in it (from:"Ada L").
        let mut raw = String::new();
        let mut quoted = false;
        while let Some(&c) = chars.peek() {
            if c == '"' {
                quoted = !quoted;
                raw.push(c);
                chars.next();
            } else if c.is_whitespace() && !quoted {
                break;
            } else {
                raw.push(c);
                chars.next();
            }
        }
        let (field, body) = match raw.split_once(':') {
            Some((f, rest)) => match field_column(f) {
                Some(col) => (Some(col), rest.to_string()),
                None => (None, raw.clone()),
            },
            None => (None, raw.clone()),
        };
        let text = body.replace('"', " ").split_whitespace().collect::<Vec<_>>().join(" ");
        if text.chars().any(|c| c.is_alphanumeric()) {
            terms.push(Term { field, text, negated });
        }
    }
    terms
}

/// Split `tag:` terms (`tag:work`, `tag:"to do"`) out of a query: (rest of the query, tag values).
pub fn split_tags(query: &str) -> (String, Vec<String>) {
    let mut rest = String::new();
    let mut tags = Vec::new();
    let mut chars = query.char_indices().peekable();
    while let Some(&(i, _)) = chars.peek() {
        let tail = &query[i..];
        let at_word_start = i == 0 || query[..i].ends_with(char::is_whitespace);
        if at_word_start && tail.len() >= 4 && tail[..4].eq_ignore_ascii_case("tag:") {
            let after = &tail[4..];
            let (value, used) = if let Some(q) = after.strip_prefix('"') {
                match q.find('"') {
                    Some(end) => (q[..end].to_string(), 4 + 1 + end + 1),
                    None => (q.to_string(), tail.len()),
                }
            } else {
                let end = after.find(char::is_whitespace).unwrap_or(after.len());
                (after[..end].to_string(), 4 + end)
            };
            if !value.trim().is_empty() {
                tags.push(value.trim().to_string());
            }
            for _ in 0..tail[..used].chars().count() {
                chars.next();
            }
            continue;
        }
        let (_, c) = chars.next().unwrap();
        rest.push(c);
    }
    (rest, tags)
}

/// Fields a plain (unprefixed) term may match.
pub const ALL_FIELDS: &[&str] = &["sender", "recipients", "subject", "body"];
/// The ones in the header index (msg_fts); `body` is body_fts, a table of its own.
const HEAD_FIELDS: &[&str] = &["sender", "recipients", "subject"];

/// One term of a query as FTS5 expressions, one per index: `head` for msg_fts (sender,
/// recipients, subject) and `body` for body_fts; None where it isn't looked for. A message
/// matches a term when either matches; it matches the query when it matches every positive
/// term and no negated one.
#[derive(Debug, PartialEq)]
pub struct TermMatch {
    pub head: Option<String>,
    pub body: Option<String>,
    pub negated: bool,
}

fn term_match(t: &Term, plain: &[&str]) -> TermMatch {
    let p = format!("\"{}\"*", t.text.replace('"', "\"\""));
    let (head, body) = match t.field {
        Some("body") => (None, Some(p)),
        Some(col) => (Some(format!("{col} : {p}")), None),
        None => {
            let cols: Vec<&str> = HEAD_FIELDS.iter().copied().filter(|f| plain.contains(f)).collect();
            let head = match cols.len() {
                0 => None,
                n if n < HEAD_FIELDS.len() => Some(format!("{{{}}} : {p}", cols.join(" "))),
                _ => Some(p.clone()),
            };
            (head, plain.contains(&"body").then_some(p))
        }
    };
    TermMatch { head, body, negated: t.negated }
}

/// A query's terms, or None if it has no searchable (positive) ones. `fields` limits plain
/// terms to those fields (unknown names ignored; empty = all).
pub fn terms(query: &str, fields: &[&str]) -> Option<Vec<TermMatch>> {
    let mut plain: Vec<&str> = ALL_FIELDS.iter().copied().filter(|f| fields.contains(f)).collect();
    if plain.is_empty() {
        plain = ALL_FIELDS.to_vec();
    }
    let terms: Vec<TermMatch> = parse(query).iter().map(|t| term_match(t, &plain)).collect();
    terms.iter().any(|t| !t.negated).then_some(terms)
}

#[cfg(test)]
mod tests {
    use super::TermMatch;

    /// Each term as (head expression, body expression, negated).
    fn terms_in(q: &str, fields: &[&str]) -> Option<Vec<(Option<String>, Option<String>, bool)>> {
        super::terms(q, fields).map(|ts| ts.into_iter().map(|TermMatch { head, body, negated }| (head, body, negated)).collect())
    }
    fn terms(q: &str) -> Option<Vec<(Option<String>, Option<String>, bool)>> {
        terms_in(q, &[])
    }
    /// A plain term: everywhere.
    fn both(p: &str) -> (Option<String>, Option<String>, bool) {
        (Some(p.to_string()), Some(p.to_string()), false)
    }
    fn head(e: &str) -> (Option<String>, Option<String>, bool) {
        (Some(e.to_string()), None, false)
    }

    #[test]
    fn builds_expressions() {
        assert_eq!(terms("invoice").unwrap(), [both(r#""invoice"*"#)]);
        assert_eq!(terms("  ada  bob ").unwrap(), [both(r#""ada"*"#), both(r#""bob"*"#)]);
        assert_eq!(terms(r#""weekly report""#).unwrap(), [both(r#""weekly report"*"#)]);
        assert_eq!(terms(r#"from:"Ada L" subject:q3"#).unwrap(), [head(r#"sender : "Ada L"*"#), head(r#"subject : "q3"*"#)]);
        assert_eq!(terms("to:ada@example.com").unwrap(), [head(r#"recipients : "ada@example.com"*"#)]);
        assert_eq!(terms("body:refund").unwrap(), [(None, Some(r#""refund"*"#.to_string()), false)]);
        let mut not_draft = both(r#""draft"*"#);
        not_draft.2 = true;
        assert_eq!(terms("report -draft").unwrap(), [both(r#""report"*"#), not_draft]);
        // Unknown "field" is just text; operator words and stray punctuation are harmless.
        assert_eq!(terms("re:meeting").unwrap(), [both(r#""re:meeting"*"#)]);
        assert_eq!(terms("AND OR NOT").unwrap(), [both(r#""AND"*"#), both(r#""OR"*"#), both(r#""NOT"*"#)]);
        assert_eq!(terms("-draft"), None);
        assert_eq!(terms(" @ \" "), None);
    }

    #[test]
    fn tag_terms() {
        assert_eq!(super::split_tags("invoice tag:work"), ("invoice ".to_string(), vec!["work".to_string()]));
        assert_eq!(super::split_tags("tag:\"to do\" from:bob"), (" from:bob".to_string(), vec!["to do".to_string()]));
        assert_eq!(super::split_tags("hashtag:x"), ("hashtag:x".to_string(), vec![]));
    }

    #[test]
    fn limits_plain_terms_to_fields() {
        let f = |q, fields: &[&str]| terms_in(q, fields).unwrap();
        assert_eq!(f("ada", &["sender"]), [head(r#"{sender} : "ada"*"#)]);
        assert_eq!(f("ada", &["subject", "sender"]), [head(r#"{sender subject} : "ada"*"#)]);
        assert_eq!(f("ada", &["sender", "recipients", "subject"]), [head(r#""ada"*"#)]);
        assert_eq!(f("ada", &["sender", "body"]), [(Some(r#"{sender} : "ada"*"#.into()), Some(r#""ada"*"#.into()), false)]);
        assert_eq!(f("ada", &["body"]), [(None, Some(r#""ada"*"#.into()), false)]);
        assert_eq!(f("ada", &["bogus"]), [both(r#""ada"*"#)]);
        // Explicit prefixes win over the field limit.
        assert_eq!(f("to:bob ada", &["subject"]), [head(r#"recipients : "bob"*"#), head(r#"{subject} : "ada"*"#)]);
    }
}
