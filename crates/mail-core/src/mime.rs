//! MIME parsing and HTML sanitization.

use std::collections::{HashMap, HashSet};

use base64::Engine;
use mail_parser::{Address, MessageParser, MimeHeaders};

use crate::model::{Addr, Attachment, MessageDetail};

#[derive(Debug, Default)]
pub struct ParsedHeader {
    pub subject: String,
    pub from_name: String,
    pub from_addr: String,
    pub to_addrs: String,
    pub date: Option<i64>,
    pub message_id: Option<String>,
    /// X-Microsoft-Original-Message-ID: the sender's Message-ID where Exchange replaced it.
    pub original_message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub refs: Option<String>,
    pub likely_attachments: bool,
}

fn first_addr(a: Option<&Address>) -> (String, String) {
    match a.and_then(|a| a.first()) {
        Some(addr) => (
            addr.name().unwrap_or_default().to_string(),
            addr.address().unwrap_or_default().to_string(),
        ),
        None => (String::new(), String::new()),
    }
}

fn addr_list(a: Option<&Address>) -> Vec<Addr> {
    a.map(|a| {
        a.iter()
            .map(|x| Addr {
                name: x.name().map(str::to_string),
                addr: x.address().unwrap_or_default().to_string(),
            })
            .collect()
    })
    .unwrap_or_default()
}

/// The Reply-To addresses of a raw message (empty if none).
pub fn reply_to(raw: &[u8]) -> Vec<Addr> {
    mail_parser::MessageParser::default().parse(raw).map(|m| addr_list(m.reply_to())).unwrap_or_default()
}

/// Message-IDs in a raw Message-ID / In-Reply-To / References value, without angle brackets.
///
/// Tolerant of what's found in real archives (after the emailer prototype's parser): only
/// `<...>`-delimited ids count, so prose like `<id> (Your message of Mon...)` adds nothing;
/// whitespace and quotes inside an id are removed; RFC 2047 encoded-words are decoded first;
/// and ids that are really one of the message's own addresses (`<bob@example.com>`) are
/// ignored. Without any `<`, bare tokens containing `@` are accepted.
pub fn parse_msg_ids(raw: &str, ignore_addrs: &HashSet<String>) -> Vec<String> {
    let decoded;
    let text = if raw.contains("=?") {
        decoded = raw
            .split_whitespace()
            .map(|w| if w.starts_with("=?") { decode_rfc2047(w) } else { w.to_string() })
            .collect::<Vec<_>>()
            .join(" ");
        decoded.as_str()
    } else {
        raw
    };
    let mut out: Vec<String> = Vec::new();
    let mut push = |id: String| {
        if id.len() >= 3 && !ignore_addrs.contains(&id.to_ascii_lowercase()) && !out.contains(&id) {
            out.push(id);
        }
    };
    if text.contains('<') {
        let mut start = None;
        for (i, c) in text.char_indices() {
            match c {
                // No nesting: a later '<' restarts the id.
                '<' => start = Some(i + 1),
                '>' => {
                    if let Some(s) = start.take() {
                        push(text[s..i].chars().filter(|c| !c.is_whitespace() && *c != '"' && *c != '\'').collect());
                    }
                }
                _ => {}
            }
        }
    } else {
        for tok in text.split(|c: char| c.is_whitespace() || c == ',') {
            let tok = tok.trim_matches(|c: char| c == '"' || c == '\'' || c == '(' || c == ')');
            if tok.contains('@') {
                push(tok.to_string());
            }
        }
    }
    out
}

fn join_ids(ids: Vec<String>) -> Option<String> {
    (!ids.is_empty()).then(|| ids.join(" "))
}

/// Decode RFC 2047 encoded-words (`=?UTF-8?B?...?=`), e.g. in attachment filenames.
pub fn decode_rfc2047(s: &str) -> String {
    if !s.contains("=?") {
        return s.to_string();
    }
    let raw = format!("Subject: {s}\r\n\r\n");
    MessageParser::default()
        .parse_headers(raw.as_bytes())
        .and_then(|m| m.subject().map(str::to_string))
        .unwrap_or_else(|| s.to_string())
}

/// A subject as shown: HTML character references some senders put in the header itself (a web
/// form's "Wacky&#x27;s" for "Wacky's") decoded. Only numeric ones and the XML five (plus
/// &nbsp;), which nobody writes on purpose; anything else is left as it is.
pub fn clean_subject(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let decoded = rest[1..].find(';').filter(|&j| j <= 10).and_then(|j| {
            let name = &rest[1..1 + j];
            let c = if let Some(n) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
                u32::from_str_radix(n, 16).ok().and_then(char::from_u32)
            } else if let Some(n) = name.strip_prefix('#') {
                n.parse().ok().and_then(char::from_u32)
            } else {
                match name {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    "nbsp" => Some(' '),
                    _ => None,
                }
            };
            c.filter(|c| !c.is_control()).map(|c| (c, j + 2))
        });
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Parse a `BODY[HEADER.FIELDS (...)]` block.
pub fn parse_header_block(raw: &[u8]) -> ParsedHeader {
    let Some(msg) = MessageParser::default().parse_headers(raw) else {
        return ParsedHeader::default();
    };
    let (from_name, from_addr) = first_addr(msg.from());
    // Recipients (To + Cc) as "Name <addr>", searchable by name or address.
    let to_addrs = addr_list(msg.to())
        .into_iter()
        .chain(addr_list(msg.cc()))
        .map(|a| match a.name {
            Some(n) if !n.is_empty() => format!("{n} <{}>", a.addr),
            _ => a.addr,
        })
        .collect::<Vec<_>>()
        .join(", ");
    // Broken clients sometimes put an address where a message id belongs; it would glue
    // together every message to or from that person.
    let own_addrs: HashSet<String> = [msg.from(), msg.to(), msg.cc(), msg.reply_to()]
        .into_iter()
        .flatten()
        .flat_map(|a| a.iter())
        .filter_map(|a| a.address().map(|s| s.to_ascii_lowercase()))
        .collect();
    let likely_attachments = msg
        .content_type()
        .map(|ct| {
            ct.ctype().eq_ignore_ascii_case("multipart")
                && ct.subtype().is_some_and(|s| s.eq_ignore_ascii_case("mixed"))
        })
        .unwrap_or(false);
    ParsedHeader {
        subject: clean_subject(msg.subject().unwrap_or_default()),
        from_name,
        from_addr,
        to_addrs,
        date: msg.date().map(|d| d.to_timestamp()),
        message_id: msg
            .header_raw("Message-ID")
            .and_then(|r| parse_msg_ids(r, &HashSet::new()).into_iter().next())
            .or_else(|| msg.message_id().map(str::to_string)),
        original_message_id: msg
            .header_raw("X-Microsoft-Original-Message-ID")
            .and_then(|r| parse_msg_ids(r, &HashSet::new()).into_iter().next()),
        in_reply_to: msg.header_raw("In-Reply-To").and_then(|r| join_ids(parse_msg_ids(r, &own_addrs))),
        refs: msg.header_raw("References").and_then(|r| join_ids(parse_msg_ids(r, &own_addrs))),
        likely_attachments,
    }
}

/// How much of a message's text search looks through (a long newsletter's tail isn't worth the
/// index's space).
pub const SEARCH_TEXT_MAX: usize = 100_000;
/// How much of the text in a message's attachments (PDFs, plain-text files) search looks
/// through, all of them together, on top of the message's own text.
pub const ATTACHMENT_TEXT_MAX: usize = 100_000;
/// PDFs larger than this aren't read for search (time and memory on the indexing thread).
const PDF_MAX_BYTES: usize = 20 << 20;

/// What search finds a message by in its body, as (the message's text, its attachments'):
/// its text (HTML as text) and its attachments' names, at most `SEARCH_TEXT_MAX`; then the
/// attachments' names and, with `read_files` (the user's choice, off by default), the text in
/// them (stored in the body, or downloaded later: `fetched`, as (name, mime, bytes)), at most
/// `ATTACHMENT_TEXT_MAX`. None: not a message the parser can read.
pub fn search_text(raw: &[u8], fetched: &[(String, String, Vec<u8>)], read_files: bool) -> Option<(String, String)> {
    let msg = MessageParser::default().parse(raw)?;
    let mut text = String::new();
    let mut i = 0;
    while let Some(t) = msg.body_text(i) {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&t);
        i += 1;
        if text.len() >= SEARCH_TEXT_MAX {
            break;
        }
    }
    truncate_at(&mut text, SEARCH_TEXT_MAX);
    let stored = stored_attachments(&msg);
    for a in &stored {
        if let Some(name) = a.attachment_name() {
            text.push('\n');
            text.push_str(name);
        }
    }
    let mut files = String::new();
    let parts: Vec<(String, String, &[u8])> = stored
        .iter()
        .map(|p| (attachment_name(p), part_mime(p), p.contents()))
        .chain(fetched.iter().map(|(n, m, d)| (n.clone(), m.clone(), d.as_slice())))
        .collect();
    for (name, ..) in &parts {
        files.push_str(name);
        files.push('\n');
    }
    for (name, mime, data) in parts.iter().filter(|p| read_files && !p.2.is_empty()) {
        if files.len() >= ATTACHMENT_TEXT_MAX {
            break;
        }
        if let Some(t) = attachment_text(name, mime, data) {
            files.push('\n');
            files.push_str(t.trim());
        }
    }
    truncate_at(&mut files, ATTACHMENT_TEXT_MAX);
    Some((text, files))
}

fn truncate_at(text: &mut String, max: usize) {
    if text.len() > max {
        let mut end = max;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
}

/// The text in an attachment, for search: a PDF's (by type, name or content), or a plain-text
/// file's (.txt, .csv, .md, .ics, .vcf…). None for anything else, and for a PDF that can't be
/// read: damaged, encrypted, only pictures, or too large.
pub fn attachment_text(name: &str, mime: &str, data: &[u8]) -> Option<String> {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    if mime == "application/pdf" || ext == "pdf" || data.starts_with(b"%PDF-") {
        return pdf_text(data);
    }
    let texty = matches!(mime, "text/plain" | "text/csv" | "text/markdown" | "text/calendar" | "text/vcard" | "text/x-vcard")
        || matches!(ext.as_str(), "txt" | "csv" | "tsv" | "md" | "log" | "ics" | "vcf");
    // A file named .txt that's really binary isn't worth indexing.
    (texty && !data.iter().take(4096).any(|&b| b == 0)).then(|| String::from_utf8_lossy(data).into_owned())
}

/// How PDFs are read for search: set by the app (`pdf_helper`, in a process of its own). Unset,
/// they aren't read (the core's tests read them here).
type PdfReader = Box<dyn Fn(&[u8]) -> Option<String> + Send + Sync>;
static PDF_READER: std::sync::OnceLock<PdfReader> = std::sync::OnceLock::new();

/// Read PDFs with `read` from now on (once; later calls are ignored).
pub fn set_pdf_reader(read: impl Fn(&[u8]) -> Option<String> + Send + Sync + 'static) {
    let _ = PDF_READER.set(Box::new(read));
}

fn pdf_text(data: &[u8]) -> Option<String> {
    if data.len() > PDF_MAX_BYTES {
        return None;
    }
    match PDF_READER.get() {
        Some(read) => read(data),
        None if cfg!(test) => pdf_text_here(data),
        None => None,
    }
}

/// A PDF's text, read in this process: only in the helper (`pdf_helper::serve`), since a
/// PDF can crash the library in ways nothing here can catch.
pub fn pdf_text_here(data: &[u8]) -> Option<String> {
    // Panics at least (most damaged files) just give no text.
    let text = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(data)).ok()?.ok()?;
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

/// Snippet and real attachment presence, computed once a body is downloaded.
pub fn body_summary(raw: &[u8]) -> (Option<String>, bool) {
    let Some(msg) = MessageParser::default().parse(raw) else {
        return (None, false);
    };
    let snippet = msg.body_preview(160).map(|s| {
        s.split_whitespace().collect::<Vec<_>>().join(" ")
    });
    let has_attachments = msg.attachments().any(|a| !is_inline_image(a));
    (snippet, has_attachments)
}

fn is_inline_image(part: &mail_parser::MessagePart) -> bool {
    part.content_id().is_some()
        && part.content_type().is_some_and(|ct| ct.ctype().eq_ignore_ascii_case("image"))
}

/// Build the reader view of a message.
pub fn render(id: i64, raw: &[u8], date: i64) -> Option<MessageDetail> {
    let msg = MessageParser::default().parse(raw)?;
    let (from_name, from_addr) = first_addr(msg.from());

    let mut cid_map: HashMap<String, String> = HashMap::new();
    for part in msg.attachments() {
        let mime = part_mime(part);
        if let (Some(cid), true) = (part.content_id(), is_inline_image(part)) {
            let data = base64::engine::general_purpose::STANDARD.encode(part.contents());
            cid_map.insert(cid.trim_matches(['<', '>']).to_string(), format!("data:{mime};base64,{data}"));
        }
    }
    let attachments: Vec<Attachment> = stored_attachments(&msg)
        .into_iter()
        .enumerate()
        .map(|(index, part)| {
            let name = attachment_name(part);
            let mime = part_mime(part);
            Attachment { index, openable: is_openable(&name), name, mime, size: part.contents().len(), downloaded: true }
        })
        .collect();

    let html = if msg.html_body_count() > 0 && !is_text_only(&msg) {
        msg.body_html(0).map(|h| sanitize_html(&h, &cid_map))
    } else {
        None
    };
    let text = msg.body_text(0).map(|t| match flowed_params(&msg) {
        Some(delsp) => decode_flowed(&t, delsp),
        None => t.into_owned(),
    });
    let has_remote_content = html.as_deref().is_some_and(has_remote);
    let sender_domain = crate::icons::icon_domain(&from_addr);
    let sender_verified = sender_vouched(&msg, &from_addr);
    let auth_server = auth_server(&msg);

    Some(MessageDetail {
        id,
        subject: clean_subject(msg.subject().unwrap_or_default()),
        from: Addr { name: (!from_name.is_empty()).then_some(from_name), addr: from_addr },
        to: addr_list(msg.to()),
        cc: addr_list(msg.cc()),
        bcc: addr_list(msg.bcc()),
        date,
        html,
        text,
        attachments,
        has_remote_content,
        remote_allowed: false,
        sender_domain,
        sender_verified,
        auth_server,
        tags: Vec::new(),
    })
}

/// Whether the topmost Authentication-Results vouches for the From address's domain (its
/// registrable part), shared mail services included: DMARC passed for it, or DKIM for a
/// signature by it. Only the topmost counts, the one the user's own server added on arrival
/// where it adds one: the ones below it could have been written by the sender. It's believed
/// only where the account's server is known to write one (`Core::from_believed`).
pub fn sender_vouched(msg: &mail_parser::Message, from_addr: &str) -> bool {
    let Some(domain) = crate::icons::registrable_domain(from_addr) else { return false };
    top_auth_results(msg).is_some_and(|results| auth_results_vouch(results, &domain))
}

/// The registrable domain of the server that wrote the topmost Authentication-Results, by the
/// name it signed it with (its authserv-id, RFC 8601): "fastmail.com" from "mx.fastmail.com;
/// dkim=pass …". None when there's none, or no name (Microsoft writes none).
pub fn auth_server(msg: &mail_parser::Message) -> Option<String> {
    let plain = without_comments(top_auth_results(msg)?);
    let id = plain.split(';').next()?.split_whitespace().next()?;
    if id.contains('=') {
        return None;
    }
    crate::icons::registrable_domain(&format!("x@{id}"))
}

/// The topmost Authentication-Results value (header_raw would give the last one).
fn top_auth_results<'a>(msg: &'a mail_parser::Message) -> Option<&'a str> {
    msg.headers_raw().find(|(name, _)| name.eq_ignore_ascii_case("Authentication-Results")).map(|(_, v)| v)
}

/// The text without its comments in parentheses (they can say anything).
fn without_comments(text: &str) -> String {
    let mut plain = String::with_capacity(text.len());
    let mut depth = 0u32;
    for c in text.chars() {
        match c {
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => plain.push(c),
            _ => {}
        }
    }
    plain
}

/// Whether an Authentication-Results value (RFC 8601) has a DMARC or DKIM pass for `domain`
/// (or one of its subdomains).
fn auth_results_vouch(results: &str, domain: &str) -> bool {
    let plain = without_comments(results);
    let ours = |v: &str| {
        let v = v.trim().trim_matches('"');
        let host = v.rsplit_once('@').map_or(v, |(_, d)| d);
        crate::icons::registrable_domain(&format!("x@{host}")).as_deref() == Some(domain)
    };
    // The first part names the server that checked; the results follow.
    plain.split(';').skip(1).any(|result| {
        let mut words = result.split_whitespace();
        let Some((method, outcome)) = words.next().and_then(|w| w.split_once('=')) else {
            return false;
        };
        if !outcome.eq_ignore_ascii_case("pass") {
            return false;
        }
        let props: Vec<(&str, &str)> = words.filter_map(|w| w.split_once('=')).collect();
        let prop = |k: &str| props.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|&(_, v)| v);
        match method.to_ascii_lowercase().as_str() {
            "dmarc" => prop("header.from").is_some_and(ours),
            "dkim" => prop("header.d").or_else(|| prop("header.i")).is_some_and(ours),
            _ => false,
        }
    })
}

/// `Some(delsp)` when the first text body part is `text/plain; format=flowed` (RFC 3676).
fn flowed_params(msg: &mail_parser::Message) -> Option<bool> {
    let part = msg.part(*msg.text_body.first()?)?;
    let ct = part.content_type()?;
    let plain = ct.ctype().eq_ignore_ascii_case("text") && ct.subtype().is_some_and(|s| s.eq_ignore_ascii_case("plain"));
    if !plain || !ct.attribute("format").is_some_and(|f| f.eq_ignore_ascii_case("flowed")) {
        return None;
    }
    Some(ct.attribute("delsp").is_some_and(|d| d.eq_ignore_ascii_case("yes")))
}

/// Undo RFC 3676 `format=flowed` soft line breaks (after the emailer prototype's decoder).
/// A line ending in a space continues on the next line at the same quote depth; space-stuffing
/// is removed; `delsp=yes` drops the space at each soft break. Quote depth is re-emitted as
/// `> ` prefixes so the reader's quote rendering still applies.
pub fn decode_flowed(text: &str, delsp: bool) -> String {
    let mut paras: Vec<(usize, String)> = Vec::new();
    let mut continues = false;
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let depth = line.chars().take_while(|&c| c == '>').count();
        let mut rest = &line[depth..];
        rest = rest.strip_prefix(' ').unwrap_or(rest);
        // The signature separator is never a soft break.
        let soft = rest.ends_with(' ') && rest != "-- ";
        let piece = if soft && delsp { &rest[..rest.len() - 1] } else { rest };
        match paras.last_mut() {
            Some((d, p)) if continues && *d == depth => p.push_str(piece),
            _ => paras.push((depth, piece.to_string())),
        }
        continues = soft;
    }
    paras
        .into_iter()
        .map(|(depth, p)| if depth == 0 { p } else { format!("{} {}", ">".repeat(depth), p) })
        .collect::<Vec<_>>()
        .join("\n")
}

fn part_mime(part: &mail_parser::MessagePart) -> String {
    part.content_type()
        .map(|ct| match ct.subtype() {
            Some(sub) => format!("{}/{}", ct.ctype(), sub),
            None => ct.ctype().to_string(),
        })
        .unwrap_or_else(|| "application/octet-stream".into())
        .to_ascii_lowercase()
}

fn attachment_name(part: &mail_parser::MessagePart) -> String {
    match part.attachment_name() {
        Some(n) => n.to_string(),
        None if matches!(part.body, mail_parser::PartType::Message(_)) => "forwarded message.eml".into(),
        None => "attachment".into(),
    }
}

/// The attachments shown for a stored message, in order: everything mail-parser reports as an
/// attachment except inline images (those are rendered in the body). Shared by the reader
/// and by extraction so an attachment's index means the same thing in both.
fn stored_attachments<'a>(msg: &'a mail_parser::Message<'a>) -> Vec<&'a mail_parser::MessagePart<'a>> {
    msg.attachments().filter(|p| !is_inline_image(p)).collect()
}

/// Decoded bytes of the `index`-th stored attachment: (name, mime, bytes).
pub fn stored_attachment(raw: &[u8], index: usize) -> Option<(String, String, Vec<u8>)> {
    let msg = MessageParser::default().parse(raw)?;
    let part = *stored_attachments(&msg).get(index)?;
    Some((attachment_name(part), part_mime(part), part.contents().to_vec()))
}

/// Every stored attachment's (name, mime, bytes), in index order.
pub fn stored_attachment_parts(raw: &[u8]) -> Vec<(String, String, Vec<u8>)> {
    let Some(msg) = MessageParser::default().parse(raw) else { return Vec::new() };
    stored_attachments(&msg).into_iter().map(|p| (attachment_name(p), part_mime(p), p.contents().to_vec())).collect()
}

/// Whether `text` has a word starting with any of `words` (lowercase), as search's prefix
/// matching finds them.
pub fn has_word_prefix(text: &str, words: &[String]) -> bool {
    use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};
    // As search's index has it: no accents (café is cafe), any case.
    let lower: String = text.nfd().filter(|c| !is_combining_mark(*c)).collect::<String>().to_lowercase();
    words.iter().filter(|w| !w.is_empty()).any(|w| {
        lower.match_indices(w.as_str()).any(|(i, _)| !lower[..i].chars().next_back().is_some_and(char::is_alphanumeric))
    })
}

/// How many attachments are stored in the raw message (omitted ones are numbered after these).
pub fn stored_attachment_count(raw: &[u8]) -> usize {
    MessageParser::default().parse(raw).map(|m| stored_attachments(&m).len()).unwrap_or(0)
}

/// Whether the app opens an attachment directly (with the system's default app for its type), or
/// only saves it. Only known kinds of documents, pictures, sound and video open: anything else
/// (programs, scripts, shortcuts, disk images, web pages, Office files with macros, and types not
/// listed) is saved, since opening it can run it (`.command` on macOS, `.desktop` on Linux,
/// `.url` or `.msc` on Windows, a script in an `.html` or `.svg`).
pub fn is_openable(name: &str) -> bool {
    const OPENS: &[&str] = &[
        // documents
        "pdf", "txt", "csv", "md", "rtf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages", "numbers",
        "key", "ics", "vcf", "eml",
        // pictures
        "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff",
        // sound and video
        "mp3", "m4a", "wav", "aac", "flac", "ogg", "opus", "mp4", "m4v", "mov", "webm",
        // archives (opened in an archive viewer; what's inside is opened, or not, from there)
        "zip",
    ];
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    OPENS.contains(&ext.as_str())
}

/// A safe file name for writing to disk: no directories, no hidden/dot names, no control or
/// reserved characters, bounded length (extension kept).
pub fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let mut s: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    s = s.trim().trim_start_matches('.').trim().to_string();
    if s.chars().count() > 150 {
        let (stem, ext) = match s.rsplit_once('.') {
            Some((stem, ext)) if ext.len() <= 10 => (stem.to_string(), format!(".{ext}")),
            _ => (s.clone(), String::new()),
        };
        s = stem.chars().take(150 - ext.chars().count()).collect::<String>() + &ext;
    }
    if s.is_empty() { "attachment".into() } else { s }
}

/// Undo a Content-Transfer-Encoding on a fetched MIME part.
pub fn decode_transfer(data: &[u8], encoding: Option<&str>) -> Vec<u8> {
    match encoding.map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("base64") => {
            let clean: Vec<u8> = data.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect();
            base64::engine::general_purpose::STANDARD
                .decode(&clean)
                .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(clean.strip_suffix(b"=").unwrap_or(&clean)))
                .unwrap_or_else(|_| data.to_vec())
        }
        Some("quoted-printable") => decode_qp(data),
        _ => data.to_vec(),
    }
}

fn decode_qp(data: &[u8]) -> Vec<u8> {
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        match data[i] {
            b'=' if data.get(i + 1) == Some(&b'\r') && data.get(i + 2) == Some(&b'\n') => i += 3,
            b'=' if data.get(i + 1) == Some(&b'\n') => i += 2,
            b'=' => match (data.get(i + 1).copied().and_then(hex), data.get(i + 2).copied().and_then(hex)) {
                (Some(h), Some(l)) => {
                    out.push(h << 4 | l);
                    i += 3;
                }
                _ => {
                    out.push(b'=');
                    i += 1;
                }
            },
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    out
}

/// mail-parser synthesizes an HTML body from text/plain; we'd rather render real text.
fn is_text_only(msg: &mail_parser::Message) -> bool {
    msg.html_body
        .iter()
        .all(|&i| msg.part(i).is_some_and(|p| matches!(p.body, mail_parser::PartType::Text(_))))
}

/// Remove scripts, event handlers, forms and other active content while keeping the layout
/// features (tables, inline styles, `<style>` blocks) that real-world HTML email depends on.
/// Remote loads are further gated by the CSP the reader injects into its sandboxed iframe.
pub fn sanitize_html(html: &str, cid_map: &HashMap<String, String>) -> String {
    let html = if cid_map.is_empty() {
        html.to_string()
    } else {
        replace_cids(html, cid_map)
    };

    let tags: HashSet<&str> = [
        "a", "abbr", "address", "area", "article", "aside", "b", "bdi", "bdo", "big", "blockquote",
        "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn",
        "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4",
        "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "map", "mark", "nav",
        "ol", "p", "picture", "pre", "q", "s", "samp", "section", "small", "source", "span",
        "strike", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
        "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
    ]
    .into();
    let generic: HashSet<&str> = [
        "style", "class", "id", "align", "valign", "width", "height", "bgcolor", "background",
        "border", "cellpadding", "cellspacing", "color", "face", "size", "dir", "lang", "title",
        "colspan", "rowspan", "nowrap", "role", "alt", "src", "srcset", "href", "name", "type",
        "media", "start", "reversed", "datetime", "span", "frame", "rules", "summary", "usemap",
        "shape", "coords",
    ]
    .into();
    let schemes: HashSet<&str> = ["http", "https", "mailto", "tel", "data", "cid"].into();

    ammonia::Builder::default()
        .tags(tags)
        // Removed with what's inside. A <title> (in the HTML's <head>) is the page's name, which
        // a browser shows in the tab, never on the page.
        .clean_content_tags(["script", "noscript", "iframe", "object", "embed", "form", "title"].into())
        .generic_attributes(generic)
        .tag_attributes(HashMap::new())
        .url_schemes(schemes)
        // data: is for pictures (and their sources) only: a link to a data: page would open a
        // document of the message's own making, where the frame's content policy may not follow
        // it. (No `target` either: every link opens in the browser, by the frame's <base>.)
        .attribute_filter(|element, attribute, value| {
            let data = value.trim_start().get(..5).is_some_and(|p| p.eq_ignore_ascii_case("data:"));
            let picture = (matches!(element, "img" | "source") && matches!(attribute, "src" | "srcset")) || attribute == "background";
            if data && !picture {
                return None;
            }
            Some(value.into())
        })
        .link_rel(Some("noopener noreferrer"))
        .strip_comments(true)
        .clean(&html)
        .to_string()
}

/// A signature as kept: shown in the composer itself (not a sandboxed frame), so only plain
/// formatting stays (ammonia's defaults: no styles, scripts or handlers; links open safely).
pub fn sanitize_signature(html: &str) -> String {
    ammonia::Builder::default()
        .link_rel(Some("noopener noreferrer"))
        // A signature saved from a web page: its <title> isn't part of it.
        .add_clean_content_tags(["title"])
        // Signatures made elsewhere and pasted in as HTML: colours, fonts and table layouts kept
        // (inline styles and the old attributes); scripts, handlers and the like still go.
        .add_generic_attributes(["style", "align", "valign", "width", "height", "bgcolor"])
        .add_tags(["font", "center"])
        .add_tag_attributes("font", ["color", "face", "size"])
        .add_tag_attributes("table", ["border", "cellpadding", "cellspacing"])
        .add_tag_attributes("img", ["border"])
        // Pictures pasted in come as data: URLs (sent as inline parts, see compose::inline_images):
        // allowed on an <img>'s src, as an image, and nowhere else.
        .add_url_schemes(["data"])
        .attribute_filter(|element, attribute, value| {
            if attribute == "style" {
                // CSS that runs or loads code: the whole style goes.
                let lower = value.to_ascii_lowercase();
                let bad = ["expression", "javascript:", "behavior", "-moz-binding", "@import", "vbscript:"];
                return (!bad.iter().any(|b| lower.contains(b))).then(|| value.into());
            }
            let data = value.trim_start().get(..5).is_some_and(|p| p.eq_ignore_ascii_case("data:"));
            if !data {
                return Some(value.into());
            }
            let image = ["data:image/png;", "data:image/jpeg;", "data:image/gif;", "data:image/webp;"]
                .iter()
                .any(|p| value.trim_start().get(..p.len()).is_some_and(|v| v.eq_ignore_ascii_case(p)));
            (element == "img" && attribute == "src" && image).then(|| value.into())
        })
        .clean(html)
        .to_string()
}

fn replace_cids(html: &str, cid_map: &HashMap<String, String>) -> String {
    let mut out = html.to_string();
    for (cid, data) in cid_map {
        out = out.replace(&format!("cid:{cid}"), data);
    }
    out
}

fn has_remote(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    ["src=\"http", "src='http", "url(http", "url('http", "url(\"http", "background=\"http", "srcset=\"http"]
        .iter()
        .any(|p| lower.contains(p))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A one-page PDF saying `text` (in Helvetica), for tests.
    pub(crate) fn tiny_pdf(text: &str) -> Vec<u8> {
        let content = format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET");
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_string(),
            format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
        ];
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (i, o) in objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
        }
        let xref = out.len();
        out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
        for o in offsets {
            out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes());
        out
    }

    /// A message with `files` attached ((name, mime, bytes), base64).
    fn with_attachments(files: &[(&str, &str, &[u8])]) -> Vec<u8> {
        let mut m = String::from("Subject: Files\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nSee attached.\r\n");
        for (name, mime, data) in files {
            let b64 = base64::engine::general_purpose::STANDARD.encode(data);
            m.push_str(&format!("--b\r\nContent-Type: {mime}\r\nContent-Disposition: attachment; filename=\"{name}\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{b64}\r\n"));
        }
        m.push_str("--b--\r\n");
        m.into_bytes()
    }

    /// Reading every PDF in a real bodies.db (opened read-only), for time and trouble:
    /// MAIL_DB_DIR=/path cargo test --release -p mail-core real_pdfs -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_pdfs() {
        let dir = std::path::PathBuf::from(std::env::var("MAIL_DB_DIR").unwrap());
        let db = rusqlite::Connection::open_with_flags(dir.join("bodies.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let mut stmt = db.prepare("SELECT raw FROM bodies UNION ALL SELECT data FROM attachment_cache").unwrap();
        let mut rows = stmt.query([]).unwrap();
        let (mut n, mut read, mut bytes, mut text_len) = (0, 0, 0usize, 0usize);
        let mut slowest = std::time::Duration::ZERO;
        let t = std::time::Instant::now();
        while let Some(r) = rows.next().unwrap() {
            let raw: Vec<u8> = r.get(0).unwrap();
            let pdfs: Vec<Vec<u8>> = if raw.starts_with(b"%PDF-") {
                vec![raw]
            } else {
                let Some(msg) = MessageParser::default().parse(&raw) else { continue };
                stored_attachments(&msg)
                    .into_iter()
                    .filter(|p| part_mime(p) == "application/pdf" || attachment_name(p).to_ascii_lowercase().ends_with(".pdf"))
                    .map(|p| p.contents().to_vec())
                    .collect()
            };
            for pdf in pdfs {
                n += 1;
                bytes += pdf.len();
                let one = std::time::Instant::now();
                let out = attachment_text("x.pdf", "application/pdf", &pdf);
                let took = one.elapsed();
                if took > slowest {
                    slowest = took;
                }
                if took.as_secs() >= 2 {
                    println!("slow: {} KB took {took:?}", pdf.len() / 1000);
                }
                if let Some(o) = out {
                    read += 1;
                    text_len += o.len();
                }
            }
        }
        println!("{n} PDFs ({} MB), {read} with text ({} KB of it), in {:?}; slowest {slowest:?}", bytes / 1_000_000, text_len / 1000, t.elapsed());
    }

    #[test]
    fn search_text_reads_pdfs_and_text_files() {
        let pdf = tiny_pdf("Invoice for the wombat enclosure");
        assert!(attachment_text("x.pdf", "application/pdf", &pdf).unwrap().contains("wombat enclosure"));
        let raw = with_attachments(&[
            ("invoice.pdf", "application/octet-stream", &pdf), // a PDF by its name and content
            ("notes.txt", "text/plain", b"platypus sightings"),
            ("photo.jpg", "image/jpeg", b"\xff\xd8\xff\x00wallaby"),
        ]);
        let (text, files) = search_text(&raw, &[], true).unwrap();
        assert!(text.contains("See attached.") && text.contains("invoice.pdf"), "{text}");
        assert!(!text.contains("wombat"), "the message's own text is apart: {text}");
        assert!(files.contains("invoice.pdf") && files.contains("photo.jpg"), "names: {files}");
        assert!(files.contains("wombat enclosure"), "the PDF's text: {files}");
        assert!(files.contains("platypus"), "a text file's: {files}");
        assert!(!files.contains("wallaby"), "not a picture's bytes");
        // Unless the user turned it on: the names only.
        let (_, names) = search_text(&raw, &[], false).unwrap();
        assert!(names.contains("invoice.pdf") && !names.contains("wombat") && !names.contains("platypus"), "{names}");
        // Downloaded apart (the body stored without them).
        let plain = b"Subject: Hi\r\nContent-Type: text/plain\r\n\r\nHello\r\n";
        let fetched = [("later.pdf".to_string(), "application/pdf".to_string(), tiny_pdf("echidna report"))];
        assert!(search_text(plain, &fetched, true).unwrap().1.contains("echidna report"));
    }

    #[test]
    fn words_match_at_the_start_of_words() {
        let w = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(has_word_prefix("Invoice for the Wombat enclosure", &w(&["wom"])), "a prefix, any case");
        assert!(has_word_prefix("Café menu", &w(&["cafe"])), "no accents");
        assert!(!has_word_prefix("Combat ready", &w(&["bat"])), "not inside a word");
        assert!(has_word_prefix("2026-invoice.pdf", &w(&["xyz", "invoice"])), "any of them");
        assert!(!has_word_prefix("anything", &w(&[""])));
    }

    #[test]
    fn broken_pdfs_are_passed_over() {
        let pdf = tiny_pdf("Hello there");
        for bad in [b"%PDF-1.4 nothing else".to_vec(), pdf[..pdf.len() / 2].to_vec(), b"%PDF-".to_vec(), Vec::new()] {
            assert_eq!(attachment_text("bad.pdf", "application/pdf", &bad), None);
        }
        let raw = with_attachments(&[("bad.pdf", "application/pdf", b"%PDF-1.7 garbage")]);
        assert!(search_text(&raw, &[], true).unwrap().1.contains("bad.pdf"), "the name still counts");
    }

    #[test]
    fn attachment_text_has_its_own_limit() {
        let long = "kookaburra ".repeat(SEARCH_TEXT_MAX / 5);
        let raw = with_attachments(&[("a.txt", "text/plain", long.as_bytes()), ("b.txt", "text/plain", long.as_bytes())]);
        let (_, files) = search_text(&raw, &[], true).unwrap();
        assert!(files.len() <= ATTACHMENT_TEXT_MAX && files.len() > ATTACHMENT_TEXT_MAX / 2);
        let long_body = format!("Subject: Long\r\nContent-Type: text/plain\r\n\r\n{long}{long}\r\n");
        let fetched = [("c.txt".to_string(), "text/plain".to_string(), b"dingo".to_vec())];
        let (text, files) = search_text(long_body.as_bytes(), &fetched, true).unwrap();
        assert!(text.len() <= SEARCH_TEXT_MAX && files.contains("dingo"), "a long body doesn't crowd attachments out");
    }

    #[test]
    fn a_sender_domain_counts_only_when_the_receiving_server_vouched() {
        let msg = |headers: &str| format!("{headers}From: Ann <ann@mail.example.com>\r\nTo: john@example.org\r\nSubject: Hi\r\n\r\nHello\r\n");
        let domain = |raw: &str| {
            let parsed = MessageParser::default().parse(raw.as_bytes()).unwrap();
            sender_vouched(&parsed, "ann@mail.example.com").then(|| crate::icons::icon_domain("ann@mail.example.com")).flatten()
        };
        // DMARC passed for the From domain (Gmail's wording, a comment with a ; in it).
        let gmail = "Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@other.example header.s=s1;\r\n       spf=pass (google.com: x; y) smtp.mailfrom=bounce@other.example;\r\n       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=mail.example.com\r\n";
        assert_eq!(domain(&msg(gmail)).as_deref(), Some("example.com"));
        // DKIM by the domain itself (Microsoft's wording, no spaces after ;).
        let outlook = "Authentication-Results: spf=fail smtp.mailfrom=x.example; dkim=pass (signature was verified) header.d=example.com;dmarc=none action=none header.from=mail.example.com;\r\n";
        assert_eq!(domain(&msg(outlook)).as_deref(), Some("example.com"));
        // Passes only for someone else's domain, a look-alike, or failed: nothing vouches.
        for bad in [
            "Authentication-Results: mx.example.net; dkim=pass header.d=sendgrid.example; dmarc=fail header.from=mail.example.com\r\n",
            "Authentication-Results: mx.example.net; dmarc=pass header.from=xexample.com\r\n",
            "Authentication-Results: mx.example.net; dkim=fail header.d=example.com\r\n",
            "Authentication-Results: mx.example.net (dmarc=pass header.from=example.com); spf=pass\r\n",
            "",
        ] {
            assert_eq!(domain(&msg(bad)), None, "{bad}");
        }
        // A sender at a shared mail service: their own address can be confirmed (sender rules),
        // though there's no domain to allow everyone at.
        let shared = "From: Ann <ann@gmail.com>\r\nAuthentication-Results: mx.google.com; dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com\r\nSubject: Hi\r\n\r\nHello\r\n";
        let parsed = MessageParser::default().parse(shared.as_bytes()).unwrap();
        assert!(sender_vouched(&parsed, "ann@gmail.com"));
        assert_eq!(crate::icons::icon_domain("ann@gmail.com"), None);
        assert!(!sender_vouched(&parsed, "ann@other.example"), "someone else's domain");
        // Only the topmost counts: one below it may be the sender's own.
        let forged = format!("Authentication-Results: mx.example.net; dmarc=fail header.from=mail.example.com\r\n{}", gmail);
        assert_eq!(domain(&msg(&forged)), None);
    }

    #[test]
    fn the_server_that_checked_is_named_by_the_topmost_results() {
        let server = |headers: &str| auth_server(&MessageParser::default().parse(format!("{headers}From: ann@example.com\r\nSubject: Hi\r\n\r\nHello\r\n").as_bytes()).unwrap());
        assert_eq!(server("Authentication-Results: mx.mail.example.net; dmarc=pass header.from=example.com\r\n").as_deref(), Some("example.net"));
        assert_eq!(server("Authentication-Results: (a comment) mx.example.org 1; dkim=none\r\n").as_deref(), Some("example.org"));
        // Microsoft names none; none at all.
        assert_eq!(server("Authentication-Results: spf=pass smtp.mailfrom=example.com; dmarc=pass header.from=example.com\r\n"), None);
        assert_eq!(server(""), None);
        // The topmost only.
        assert_eq!(server("Authentication-Results: mx.example.org; spf=none\r\nAuthentication-Results: mx.example.net; spf=none\r\n").as_deref(), Some("example.org"));
    }

    #[test]
    fn html_references_in_subjects() {
        assert_eq!(clean_subject("Review (Wacky&#x27;s Bar)"), "Review (Wacky's Bar)");
        assert_eq!(clean_subject("Q&amp;A &#8212; &quot;fast&quot;"), "Q&A — \"fast\"");
        // left alone: not a reference, an unknown name, a control character
        assert_eq!(clean_subject("AT&T; R&D & more &copy; &#0;"), "AT&T; R&D & more &copy; &#0;");
        assert_eq!(clean_subject("plain"), "plain");
    }

    #[test]
    fn signatures_keep_formatting_only() {
        let out = sanitize_signature(r#"<p><b>Lars</b> <a href="https://x.se" onclick="x()">x.se</a></p><style>body{display:none}</style><script>1</script>"#);
        assert!(out.contains("<b>Lars</b>") && out.contains(r#"href="https://x.se""#));
        assert!(!out.contains("onclick") && !out.contains("<style") && !out.contains("script"));
        // A pasted picture stays; data: anywhere else (or not an image) goes.
        let img = sanitize_signature(r#"<p><img src="data:image/png;base64,iVBORw0KGgo=" width="120" height="40"><a href="data:text/html;base64,PHNjcmlwdD4=">x</a><img src="data:image/svg+xml;base64,PHN2Zz4="></p>"#);
        assert!(img.contains(r#"src="data:image/png;base64,iVBORw0KGgo=""#) && img.contains(r#"width="120""#), "{img}");
        assert!(!img.contains("data:text/html") && !img.contains("svg+xml"), "{img}");
        // Pasted HTML: colours, fonts, tables kept; scripted CSS not.
        let pasted = sanitize_signature(
            r#"<table cellpadding="0" style="border-collapse:collapse"><tr><td valign="top" style="color:#c00;font-family:Georgia"><font color="navy" face="Arial">Lars</font></td><td style="background:url(javascript:alert(1))">x</td></tr></table>"#,
        );
        assert!(pasted.contains(r#"style="color:#c00;font-family:Georgia""#) && pasted.contains(r#"<font color="navy" face="Arial">"#), "{pasted}");
        assert!(pasted.contains(r#"cellpadding="0""#) && pasted.contains(r#"valign="top""#), "{pasted}");
        assert!(!pasted.contains("javascript"), "{pasted}");
    }

    #[test]
    fn strips_active_content_keeps_layout() {
        let out = sanitize_html(
            r#"<style>.a{color:red}</style><table width="100%"><tr><td style="padding:4px" onclick="x()">hi</td></tr></table><script>alert(1)</script><img src="http://t.co/p.gif">"#,
            &HashMap::new(),
        );
        assert!(out.contains("<style>"));
        assert!(out.contains(r#"width="100%""#));
        assert!(out.contains("padding:4px"));
        assert!(!out.contains("onclick"));
        assert!(!out.contains("alert"));
        assert!(has_remote(&out));
    }

    /// The message frame allows scripts (WebKit needs it for the app's key listener), so the
    /// sanitiser and the frame's CSP are what keep an email from running code.
    #[test]
    fn no_way_to_run_code_survives() {
        let out = sanitize_html(
            r#"<a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(2)">b</a><svg onload="alert(3)"></svg><meta http-equiv="refresh" content="0;url=javascript:alert(4)"><iframe src="https://x"></iframe><img src=x onerror="alert(5)"><body onload="alert(6)"><base href="https://evil/"><object data="x"></object>"#,
            &HashMap::new(),
        );
        let lower = out.to_ascii_lowercase();
        for bad in ["javascript", "onload", "onerror", "<svg", "<meta", "<iframe", "<base", "<object", "alert"] {
            assert!(!lower.contains(bad), "{bad} survived: {out}");
        }
    }

    /// A newsletter's `<head><title>` isn't shown above it (only its `<style>` is kept).
    #[test]
    fn no_data_links_or_targets() {
        let out = sanitize_html(
            r#"<a href="data:text/html,<script>alert(1)</script>" target="_top">a</a><a href=" DATA:text/html;base64,PHNjcmlwdD4=">b</a><a href="https://x.example/" target="_self">c</a><img src="data:image/png;base64,iVBORw0KGgo="><table><tr><td background="data:image/png;base64,AA">d</td></tr></table>"#,
            &HashMap::new(),
        );
        assert!(!out.contains("text/html") && !out.contains("DATA:"), "{out}");
        assert!(!out.contains("target"), "{out}");
        assert!(out.contains(r#"href="https://x.example/""#), "{out}");
        assert!(out.contains(r#"<img src="data:image/png"#) && out.contains(r#"background="data:image/png"#), "pictures keep data: {out}");
    }

    #[test]
    fn title_is_not_shown() {
        let html = "<!DOCTYPE html><html lang=\"en\"><head><title>bp Australia</title><meta charset=\"utf-8\"><style>p{color:red}</style></head><body><p>Hi Lars,</p></body></html>";
        let out = sanitize_html(html, &HashMap::new());
        assert!(!out.contains("bp Australia"), "{out}");
        assert!(out.contains("Hi Lars,") && out.contains("p{color:red}"), "{out}");
        let sig = sanitize_signature("<html><head><title>Signature</title></head><body><b>Lars</b></body></html>");
        assert!(!sig.contains("Signature") && sig.contains("<b>Lars</b>"), "{sig}");
    }

    /// FLOWED_IDS=1,2,3 BODIES_DB=/path/bodies.db cargo test -p mail-core real_flowed -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_flowed() {
        let db = rusqlite::Connection::open_with_flags(
            std::env::var("BODIES_DB").unwrap(),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        for id in std::env::var("FLOWED_IDS").unwrap().split(',') {
            let raw: Vec<u8> = db.query_row("SELECT raw FROM bodies WHERE message_id=?1", [id], |r| r.get(0)).unwrap();
            let msg = MessageParser::default().parse(&raw).unwrap();
            let before = msg.body_text(0).unwrap().into_owned();
            let after = render(0, &raw, 0).unwrap().text.unwrap();
            let longest = |s: &str| s.lines().map(|l| l.chars().count()).max().unwrap_or(0);
            println!(
                "message {id}: flowed={:?} lines {} -> {}, longest line {} -> {} chars, words equal: {}",
                flowed_params(&msg),
                before.lines().count(),
                after.lines().count(),
                longest(&before),
                longest(&after),
                before.split_whitespace().filter(|w| !w.starts_with('>')).collect::<Vec<_>>()
                    == after.split_whitespace().filter(|w| !w.starts_with('>')).collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn attachment_helpers() {
        assert_eq!(decode_transfer(b"aGVs\r\nbG8=", Some("base64")), b"hello");
        assert_eq!(decode_transfer(b"caf=C3=A9 =\r\nok", Some("quoted-printable")), "café ok".as_bytes());
        assert_eq!(decode_transfer(b"raw", Some("7bit")), b"raw");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name(".bashrc"), "bashrc");
        assert_eq!(safe_file_name("a\u{0}b?.pdf"), "a_b_.pdf");
        assert_eq!(safe_file_name(""), "attachment");
        assert!(is_openable("Report.PDF") && !is_openable("setup.exe") && !is_openable("run.command"));
        for risky in ["a.msc", "b.url", "c.iso", "d.html", "e.svg", "f.docm", "g.xlsm", "h.chm", "i.scf", "j.application", "noext", "k.dmg", "l.deb"] {
            assert!(!is_openable(risky), "{risky}");
        }
        for fine in ["photo.JPG", "notes.docx", "data.csv", "clip.mov", "invite.ics"] {
            assert!(is_openable(fine), "{fine}");
        }

        let raw = b"From: a@b.c\r\nSubject: t\r\nContent-Type: multipart/mixed; boundary=X\r\n\r\n--X\r\nContent-Type: text/plain\r\n\r\nhi\r\n--X\r\nContent-Type: application/pdf; name=\"r.pdf\"\r\nContent-Disposition: attachment; filename=\"r.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n--X--\r\n";
        assert_eq!(stored_attachment_count(raw), 1);
        let (name, mime, bytes) = stored_attachment(raw, 0).unwrap();
        assert_eq!((name.as_str(), mime.as_str(), bytes.as_slice()), ("r.pdf", "application/pdf", &b"%PDF-"[..]));
        let d = render(1, raw, 0).unwrap();
        assert_eq!(d.attachments.len(), 1);
        assert!(d.attachments[0].downloaded && d.attachments[0].openable && d.attachments[0].index == 0);
    }

    #[test]
    fn flowed_text() {
        let src = "This is a long \r\nparagraph.\r\n\r\n> quoted \r\n> text\r\n>> deeper\r\n -- \r\n-- \r\nsig";
        assert_eq!(
            decode_flowed(src, false),
            "This is a long paragraph.\n\n> quoted text\n>> deeper\n-- \n-- \nsig"
        );
        assert_eq!(decode_flowed("ab \r\ncd", true), "abcd");
    }

    #[test]
    fn message_ids_from_damaged_headers() {
        let none = HashSet::new();
        assert_eq!(parse_msg_ids("<a@x> <b@y>", &none), vec!["a@x", "b@y"]);
        // Prose after the id must not become ids.
        assert_eq!(parse_msg_ids("<a@x> (Your message of Mon, 3 Mar 1998)", &none), vec!["a@x"]);
        // Folding/quotes inside brackets.
        assert_eq!(parse_msg_ids("<\"a b\"@x>", &none), vec!["ab@x"]);
        // Encoded-word ids.
        assert_eq!(parse_msg_ids("=?utf-8?q?=3CPR=5Fk=40apache=2Eorg=3E?=", &none), vec!["PR_k@apache.org"]);
        // An address used as an id is ignored.
        let me: HashSet<String> = ["bob@example.com".to_string()].into();
        assert_eq!(parse_msg_ids("<Bob@Example.com> <c@z>", &me), vec!["c@z"]);
        // Bare ids without brackets.
        assert_eq!(parse_msg_ids("a@x, b@y", &none), vec!["a@x", "b@y"]);
        assert!(parse_msg_ids("org", &none).is_empty());
    }

    #[test]
    fn parses_header_block() {
        let raw = b"From: \"Ada L\" <ada@example.com>\r\nTo: bob@example.com\r\nSubject: =?utf-8?q?Caf=C3=A9?=\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n";
        let h = parse_header_block(raw);
        assert_eq!(h.from_name, "Ada L");
        assert_eq!(h.from_addr, "ada@example.com");
        assert_eq!(h.subject, "Café");
        assert!(h.likely_attachments);
    }
}
