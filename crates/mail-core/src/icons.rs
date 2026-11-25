//! Sender pictures (as eM Client shows beside each message): the logo a sender's domain
//! publishes for mail (BIMI: a TXT record at `default._bimi.<domain>` naming an SVG), else its
//! website's own icon (the largest `<link rel=icon>` / `apple-touch-icon`, else
//! `/favicon.ico`). Looked up once per domain, from the domain itself (DNS through the system's
//! resolver, the website over HTTPS: no third party learns who writes to you), and kept in
//! mail.db (`sender_icons`) — a miss too, so a domain without one isn't asked again for a while.
//!
//! Mail services everyone has an address at (gmail.com, outlook.com…) have no picture: their
//! logo would say nothing about the person.

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

/// Whose pictures may be looked up (the user's choice, Settings › General › Sender pictures).
/// Looking a domain's picture up contacts it, so the wider the scope the more senders can tell
/// their mail was shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PictureScope {
    /// Google contacts' own photos only: no sender's domain is contacted.
    Contacts,
    /// And the domains the user corresponds with (`Core::known_domain`).
    Known,
    /// And any sender's domain.
    All,
}

/// A picture: its MIME type and bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct Icon {
    pub mime: String,
    pub data: Vec<u8>,
}

impl Icon {
    pub fn data_url(&self) -> String {
        use base64::Engine;
        format!("data:{};base64,{}", self.mime, base64::engine::general_purpose::STANDARD.encode(&self.data))
    }
}

/// Domains where anyone can have an address.
const SHARED: &[&str] = &[
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "gmx.com", "gmx.net", "gmx.de", "web.de", "proton.me",
    "protonmail.com", "pm.me", "zoho.com", "mail.com", "yandex.ru", "yandex.com", "fastmail.com", "hey.com",
    "qq.com", "163.com", "126.com", "tutanota.com", "tuta.io", "hotmail.co.uk", "yahoo.co.uk", "live.dk",
    "hotmail.dk", "outlook.dk", "live.se", "hotmail.se", "outlook.se", "mail.dk", "jubii.dk", "telia.com",
    "comhem.se", "bredband.net", "bigpond.com", "optusnet.com.au", "hotmail.de", "t-online.de", "orange.fr",
    "free.fr", "laposte.net", "libero.it", "seznam.cz", "wp.pl", "o2.pl", "mail.ru", "rambler.ru",
];

/// Second-level labels under a country code that a registrable domain sits below ("co.uk").
const UNDER_CC: &[&str] = &["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "or", "ne", "go"];

/// The domain whose picture stands for an address: its registrable part ("mail.github.com" →
/// "github.com", "x.co.uk" kept as "x.co.uk"). None for shared mail services and nonsense.
pub fn icon_domain(addr: &str) -> Option<String> {
    let (d, base) = domains(addr)?;
    if SHARED.contains(&base.as_str()) || SHARED.contains(&d.as_str()) {
        return None;
    }
    Some(base)
}

/// The registrable part of an address's domain, shared mail services included ("gmail.com").
pub fn registrable_domain(addr: &str) -> Option<String> {
    domains(addr).map(|(_, base)| base)
}

/// (the domain as written, lowercase; its registrable part).
fn domains(addr: &str) -> Option<(String, String)> {
    let d = addr.rsplit_once('@')?.1.trim().trim_end_matches(['>', '.']).to_ascii_lowercase();
    if d.is_empty() || !d.contains('.') || !d.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return None;
    }
    let labels: Vec<&str> = d.split('.').filter(|l| !l.is_empty()).collect();
    if labels.len() < 2 {
        return None;
    }
    let n = labels.len();
    let keep = if n >= 3 && labels[n - 1].len() == 2 && UNDER_CC.contains(&labels[n - 2]) { 3 } else { 2 };
    let base = labels[n.saturating_sub(keep)..].join(".");
    Some((d, base))
}

/// Biggest picture worth keeping.
const MAX_BYTES: usize = 400 * 1024;

/// Look a domain's picture up: BIMI first, then the website. Ok(None): it has none.
pub async fn fetch(domain: &str) -> Result<Option<Icon>> {
    if let Some(url) = bimi_logo(domain).await
        && let Ok(icon) = get_image(&url).await
    {
        return Ok(Some(icon));
    }
    for site in [domain.to_string(), format!("www.{domain}")] {
        match website_icon(&site).await {
            Ok(Some(icon)) => return Ok(Some(icon)),
            Ok(None) => {}
            Err(e) => tracing::debug!(site, "no website icon: {e:#}"),
        }
    }
    Ok(None)
}

/// The SVG a domain names in its BIMI record (`v=BIMI1; l=https://…`).
async fn bimi_logo(domain: &str) -> Option<String> {
    let resolver = hickory_resolver::TokioResolver::builder_tokio().ok()?.build().ok()?;
    let lookup = tokio::time::timeout(Duration::from_secs(4), resolver.txt_lookup(format!("default._bimi.{domain}.")))
        .await
        .ok()?
        .ok()?;
    for record in lookup.answers() {
        let hickory_resolver::proto::rr::RData::TXT(txt) = &record.data else { continue };
        let text: String = txt.txt_data.iter().map(|b| String::from_utf8_lossy(b).into_owned()).collect();
        if let Some(url) = bimi_location(&text) {
            return Some(url);
        }
    }
    None
}

/// `l=` of a BIMI record, when it's an https URL.
fn bimi_location(record: &str) -> Option<String> {
    if !record.trim_start().to_ascii_lowercase().starts_with("v=bimi1") {
        return None;
    }
    record
        .split(';')
        .filter_map(|p| p.trim().split_once('='))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("l"))
        .map(|(_, v)| v.trim().to_string())
        .filter(|v| v.starts_with("https://"))
}

/// The best icon a website's front page names, else its /favicon.ico.
async fn website_icon(host: &str) -> Result<Option<Icon>> {
    let page_url = format!("https://{host}/");
    let (final_url, status, mime, body) = get(&page_url, 4, ICONS).await?;
    let mut candidates = Vec::new();
    if (200..300).contains(&status) && mime.contains("html") {
        let html = String::from_utf8_lossy(&body[..body.len().min(256 * 1024)]);
        candidates = page_icons(&html, &final_url);
    }
    let origin = origin_of(&final_url).unwrap_or_else(|| format!("https://{host}"));
    candidates.push(format!("{origin}/favicon.ico"));
    for url in candidates {
        if let Ok(icon) = get_image(&url).await {
            return Ok(Some(icon));
        }
    }
    Ok(None)
}

/// Icons a page's `<link>`s name, best first: apple-touch-icon (180 px or so), then icons by
/// their size (largest first; SVG counts as large), absolute URLs.
fn page_icons(html: &str, base: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let mut found: Vec<(u32, String)> = Vec::new();
    let mut at = 0;
    while let Some(i) = lower[at..].find("<link") {
        let start = at + i;
        let end = lower[start..].find('>').map(|e| start + e).unwrap_or(lower.len());
        let tag = &html[start..end];
        at = end;
        let rel = attr(tag, "rel").unwrap_or_default().to_ascii_lowercase();
        let Some(href) = attr(tag, "href").filter(|h| !h.is_empty()) else { continue };
        let is_touch = rel.contains("apple-touch-icon");
        if !is_touch && !rel.split_whitespace().any(|r| r == "icon") {
            continue;
        }
        let kind = attr(tag, "type").unwrap_or_default().to_ascii_lowercase();
        let size = attr(tag, "sizes")
            .and_then(|s| s.split_whitespace().filter_map(|x| x.split(['x', 'X']).next()?.parse::<u32>().ok()).max())
            .unwrap_or(if kind.contains("svg") || href.ends_with(".svg") { 512 } else if is_touch { 180 } else { 16 });
        let score = if is_touch { size + 1000 } else { size };
        if let Some(url) = absolute(&href, base) {
            found.push((score, url));
        }
    }
    found.sort_by_key(|f| std::cmp::Reverse(f.0));
    found.into_iter().map(|(_, u)| u).collect()
}

/// An HTML attribute's value (quoted or not), entities for `&` undone.
fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(name) {
        let at = from + i;
        from = at + name.len();
        // a whole attribute name: space before, `=` after
        if at == 0 || !lower.as_bytes()[at - 1].is_ascii_whitespace() {
            continue;
        }
        let rest = tag[at + name.len()..].trim_start();
        let Some(rest) = rest.strip_prefix('=') else { continue };
        let rest = rest.trim_start();
        let value = match rest.chars().next() {
            Some(q @ ('"' | '\'')) => rest[1..].split(q).next().unwrap_or(""),
            _ => rest.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or(""),
        };
        return Some(value.replace("&amp;", "&").trim().to_string());
    }
    None
}

/// `https://host[:port]` of a URL.
fn origin_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?', '#']).next()?;
    Some(format!("https://{host}"))
}

/// `href` resolved against `base` (https only).
fn absolute(href: &str, base: &str) -> Option<String> {
    let href = href.trim();
    if href.starts_with("https://") {
        return Some(href.to_string());
    }
    if href.starts_with("data:") || href.starts_with("http://") {
        return None;
    }
    if let Some(rest) = href.strip_prefix("//") {
        return Some(format!("https://{rest}"));
    }
    let origin = origin_of(base)?;
    if href.starts_with('/') {
        return Some(format!("{origin}{href}"));
    }
    // relative to the page's directory
    let path = base.strip_prefix(&origin).unwrap_or("/");
    let dir = &path[..path.rfind('/').map(|i| i + 1).unwrap_or(0)];
    Some(format!("{origin}{}{href}", if dir.is_empty() { "/" } else { dir }))
}

/// A picture at `url`: an image type (by the answer's type, or its first bytes), not too big.
pub(crate) async fn get_image(url: &str) -> Result<Icon> {
    let (_, status, mime, body) = get(url, 4, ICONS).await?;
    if !(200..300).contains(&status) || body.is_empty() {
        bail!("{status}");
    }
    if body.len() > MAX_BYTES {
        bail!("too big");
    }
    let mime = sniff(&body).map(str::to_string).or_else(|| mime.starts_with("image/").then_some(mime)).ok_or_else(|| anyhow!("not an image"))?;
    Ok(Icon { mime, data: body })
}

/// Most a picture in a message may weigh.
const MAIL_IMAGE_MAX: usize = 15 * 1024 * 1024;

/// A picture a message shows from a plain `http://` address, fetched by the app (the reader's
/// `mailimg:` scheme). The webview upgrades such a picture to https, as any secure page does,
/// and a server without a working certificate there then shows a broken image; the frame asks
/// for it here instead, only when it failed that way and the message may load remote pictures.
/// Only public addresses are reached (never this machine or the local network), and only
/// pictures are handed back.
pub async fn mail_image(url: &str) -> Result<Icon> {
    if !url.starts_with("http://") {
        bail!("not an http address");
    }
    // A few at a time: each may hold up to MAIL_IMAGE_MAX while it comes in, and a newsletter
    // can have dozens.
    static AT_ONCE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);
    let _turn = AT_ONCE.acquire().await?;
    let (_, status, mime, body) = get(url, 5, MAIL_IMAGES).await?;
    if !(200..300).contains(&status) || body.is_empty() {
        bail!("{status}");
    }
    let mime = sniff(&body).map(str::to_string).or_else(|| mime.starts_with("image/").then_some(mime)).ok_or_else(|| anyhow!("not an image"))?;
    Ok(Icon { mime, data: body })
}

/// The address in a `mailimg:` request's path (`/` and the address, percent-encoded).
pub fn mail_image_url(path: &str) -> Option<String> {
    let enc = path.strip_prefix('/').unwrap_or(path).as_bytes();
    let mut out = Vec::with_capacity(enc.len());
    let mut i = 0;
    while i < enc.len() {
        if enc[i] == b'%' {
            let hex = std::str::from_utf8(enc.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(enc[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The image type its first bytes say.
fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG") {
        Some("image/png")
    } else if b.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF8") {
        Some("image/gif")
    } else if b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else if b.starts_with(&[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else {
        let head = String::from_utf8_lossy(&b[..b.len().min(512)]).to_ascii_lowercase();
        (head.contains("<svg")).then_some("image/svg+xml")
    }
}

/// How a GET may go: whether plain HTTP is allowed, the most the answer may weigh, and
/// whether only public addresses may be reached.
#[derive(Clone, Copy)]
struct Fetch {
    plain_http: bool,
    limit: usize,
    public_only: bool,
}

/// Sender pictures: HTTPS only, to the sender's own domain, and never on this machine or the
/// local network (a domain's name can point anywhere).
const ICONS: Fetch = Fetch { plain_http: false, limit: 4 * 1024 * 1024, public_only: true };
/// Pictures in messages (`mail_image`).
const MAIL_IMAGES: Fetch = Fetch { plain_http: true, limit: MAIL_IMAGE_MAX, public_only: true };

/// GET over HTTPS (or plain HTTP, if `how` allows), following up to `hops` redirects:
/// (final URL, status, content type, body).
async fn get(url: &str, hops: u32, how: Fetch) -> Result<(String, u16, String, Vec<u8>)> {
    let mut url = url.to_string();
    for _ in 0..=hops {
        // Written into the request as it is: no control characters, spaces or other text that
        // could end its line and add to it (a message's address, or a server's redirect).
        if !url.bytes().all(|b| (0x21..0x7f).contains(&b)) {
            bail!("not a plain address");
        }
        let (tls, rest) = if let Some(rest) = url.strip_prefix("https://") {
            (true, rest)
        } else if let Some(rest) = url.strip_prefix("http://")
            && how.plain_http
        {
            (false, rest)
        } else {
            bail!("not https");
        };
        let (hostport, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, "/"),
        };
        let path = path.split('#').next().unwrap_or("/");
        let default_port = if tls { 443 } else { 80 };
        let (host, port) = match hostport.rsplit_once(':') {
            Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) => (h, p.parse().unwrap_or(default_port)),
            _ => (hostport, default_port),
        };
        // A name (letters, digits, dots, dashes), or an address; nothing else (no user@ part).
        if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '[' | ']' | ':')) {
            bail!("not a host name: {host}");
        }
        let (status, headers, body) = request(host, port, path, tls, how).await?;
        if (300..400).contains(&status)
            && let Some(loc) = header(&headers, "location")
        {
            let next = if how.plain_http { redirect_target(&loc, &url) } else { absolute(&loc, &url) };
            url = next.ok_or_else(|| anyhow!("redirect to {loc}"))?;
            continue;
        }
        let mime = header(&headers, "content-type").unwrap_or_default().split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        return Ok((url, status, mime, body));
    }
    bail!("too many redirects")
}

/// A redirect's `Location` resolved against the URL that answered (http or https).
fn redirect_target(loc: &str, base: &str) -> Option<String> {
    let loc = loc.trim();
    if loc.starts_with("https://") || loc.starts_with("http://") {
        return Some(loc.to_string());
    }
    let (scheme, rest) = base.split_once("://")?;
    if let Some(r) = loc.strip_prefix("//") {
        return Some(format!("{scheme}://{r}"));
    }
    let host = rest.split(['/', '?', '#']).next()?;
    if loc.starts_with('/') {
        return Some(format!("{scheme}://{host}{loc}"));
    }
    let path = rest[host.len()..].split(['?', '#']).next().unwrap_or("");
    let dir = &path[..path.rfind('/').map(|i| i + 1).unwrap_or(0)];
    Some(format!("{scheme}://{host}{}{loc}", if dir.is_empty() { "/" } else { dir }))
}

/// An address on the internet: not this machine, the local network, link-local or the like.
fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(v.is_loopback()
                || v.is_private()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || v.is_documentation()
                || v.is_multicast()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xc0) == 64)
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)
                || (o[0] == 198 && (o[1] & 0xfe) == 18)
                || o[0] >= 240)
        }
        IpAddr::V6(v) => {
            if let Some(v4) = v.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let seg = v.segments();
            let embedded = |hi: u16, lo: u16| IpAddr::V4(std::net::Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8));
            // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 address: check that one.
            if seg[0] == 0x64 && seg[1] == 0xff9b && seg[2..6] == [0, 0, 0, 0] {
                return is_public(embedded(seg[6], seg[7]));
            }
            if seg[0] == 0x2002 {
                return is_public(embedded(seg[1], seg[2]));
            }
            let s = seg[0];
            !(v.is_loopback()
                || v.is_unspecified()
                || v.is_multicast()
                || (s & 0xfe00) == 0xfc00
                || (s & 0xffc0) == 0xfe80
                || (s & 0xffc0) == 0xfec0
                || (s == 0x2001 && seg[1] == 0x0db8)
                || seg[..6] == [0, 0, 0, 0, 0, 0])
        }
    }
}

/// A connection to `host`; with `public_only`, to one of its public addresses (the address
/// checked is the one connected to, so a name can't change its answer in between).
async fn connect(host: &str, port: u16, public_only: bool) -> Result<TcpStream> {
    if !public_only {
        return Ok(TcpStream::connect((host, port)).await?);
    }
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port)).await?.collect();
    let addr = addrs.into_iter().find(|a| is_public(a.ip())).ok_or_else(|| anyhow!("{host} isn't a public address"))?;
    Ok(TcpStream::connect(addr).await?)
}

fn header(head: &str, name: &str) -> Option<String> {
    head.lines().skip(1).find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim().to_string())
    })
}

/// One GET: status, the response head, and the body (chunked or not), at most `how.limit`.
async fn request(host: &str, port: u16, path: &str, tls: bool, how: Fetch) -> Result<(u16, String, Vec<u8>)> {
    let tcp = tokio::time::timeout(Duration::from_secs(6), connect(host, port, how.public_only))
        .await
        .map_err(|_| anyhow!("connecting to {host} timed out"))?
        .with_context(|| format!("connecting to {host}"))?;
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nAccept: text/html,image/*;q=0.9,*/*;q=0.5\r\nAccept-Encoding: identity\r\nConnection: close\r\nUser-Agent: Mozilla/5.0 (compatible; Email)\r\n\r\n"
    );
    let raw = if tls {
        let name = tokio_rustls::rustls::pki_types::ServerName::try_from(host.to_string())?;
        let mut tls = tokio_rustls::TlsConnector::from(crate::imap::tls_config()).connect(name, tcp).await?;
        exchange(&mut tls, &req, how.limit, host).await?
    } else {
        let mut tcp = tcp;
        exchange(&mut tcp, &req, how.limit, host).await?
    };
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or_else(|| anyhow!("incomplete answer"))?;
    let head = String::from_utf8_lossy(&raw[..split]).to_string();
    let status: u16 = head.split(' ').nth(1).and_then(|s| s.parse().ok()).ok_or_else(|| anyhow!("no HTTP status"))?;
    let mut body = raw[split + 4..].to_vec();
    if header(&head, "transfer-encoding").is_some_and(|v| v.to_ascii_lowercase().contains("chunked")) {
        let mut out = Vec::new();
        let mut rest = &body[..];
        while let Some(eol) = rest.windows(2).position(|w| w == b"\r\n") {
            let Ok(size) = usize::from_str_radix(String::from_utf8_lossy(&rest[..eol]).split(';').next().unwrap_or("").trim(), 16) else {
                break;
            };
            rest = &rest[eol + 2..];
            if size == 0 || rest.len() < size {
                break;
            }
            out.extend_from_slice(&rest[..size]);
            rest = rest.get(size + 2..).unwrap_or(&[]);
        }
        body = out;
    }
    Ok((status, head, body))
}

/// Send `req` and read the whole answer (refused past `limit`, or after 10 s).
async fn exchange<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S, req: &str, limit: usize, host: &str) -> Result<Vec<u8>> {
    s.write_all(req.as_bytes()).await?;
    let mut raw = Vec::new();
    let read = async {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match s.read(&mut buf).await {
                Ok(0) | Err(_) => return Ok(()),
                Ok(n) => {
                    raw.extend_from_slice(&buf[..n]);
                    if raw.len() > limit {
                        bail!("too big");
                    }
                }
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(10), read).await.map_err(|_| anyhow!("{host} took too long"))??;
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domains() {
        assert_eq!(icon_domain("noreply@email.stackoverflow.com").as_deref(), Some("stackoverflow.com"));
        assert_eq!(icon_domain("Jane <jane@shop.example.co.uk>").as_deref(), Some("example.co.uk"));
        assert_eq!(icon_domain("a@papercut.com").as_deref(), Some("papercut.com"));
        assert_eq!(icon_domain("someone@gmail.com"), None, "shared");
        assert_eq!(icon_domain("someone@hotmail.co.uk"), None, "shared");
        assert_eq!(icon_domain("no-domain"), None);
        assert_eq!(icon_domain("x@localhost"), None);
    }

    #[test]
    fn bimi_records() {
        assert_eq!(bimi_location("v=BIMI1; l=https://x.com/logo.svg; a=https://x.com/vmc.pem").as_deref(), Some("https://x.com/logo.svg"));
        assert_eq!(bimi_location("v=BIMI1; l=; a=;"), None, "declined");
        assert_eq!(bimi_location("v=spf1 include:x"), None);
    }

    #[test]
    fn icons_on_a_page() {
        let html = r#"<head><link rel="icon" href="/favicon-16.png" sizes="16x16"><link rel='icon' type='image/png' sizes='192x192' href='icons/big.png?v=2&amp;x=1'>
            <link rel="apple-touch-icon" href="https://cdn.x.com/touch.png"><link rel="stylesheet" href="/a.css"><LINK REL="shortcut icon" HREF="//cdn.x.com/f.ico"></head>"#;
        assert_eq!(
            page_icons(html, "https://www.x.com/en/index.html"),
            vec![
                "https://cdn.x.com/touch.png".to_string(),
                "https://www.x.com/en/icons/big.png?v=2&x=1".to_string(),
                "https://www.x.com/favicon-16.png".to_string(),
                "https://cdn.x.com/f.ico".to_string(),
            ]
        );
    }

    #[test]
    fn sniffing() {
        assert_eq!(sniff(b"\x89PNG\r\n"), Some("image/png"));
        assert_eq!(sniff(b"<?xml version='1.0'?><svg xmlns=..."), Some("image/svg+xml"));
        assert_eq!(sniff(b"<html>"), None);
    }

    #[test]
    fn mail_image_addresses() {
        assert_eq!(mail_image_url("/http%3A%2F%2Fx.com%2Fa.png%3Ftxt%3D1%26y%3D2").as_deref(), Some("http://x.com/a.png?txt=1&y=2"));
        assert_eq!(mail_image_url("/http%3A%2F%2Fx.com%2F%C3%A6.png").as_deref(), Some("http://x.com/æ.png"));
        assert_eq!(mail_image_url("/%zz"), None);
        assert_eq!(mail_image_url("/%4"), None);
    }

    #[test]
    fn redirects() {
        assert_eq!(redirect_target("https://y.com/b", "http://x.com/a").as_deref(), Some("https://y.com/b"));
        assert_eq!(redirect_target("//y.com/b", "http://x.com/a").as_deref(), Some("http://y.com/b"));
        assert_eq!(redirect_target("/b?q=1", "http://x.com/d/a?z").as_deref(), Some("http://x.com/b?q=1"));
        assert_eq!(redirect_target("b.png", "http://x.com/d/a.png?z=/q").as_deref(), Some("http://x.com/d/b.png"));
        assert_eq!(redirect_target("b.png", "http://x.com").as_deref(), Some("http://x.com/b.png"));
    }

    #[test]
    fn public_addresses() {
        for ip in ["8.8.8.8", "203.0.114.1", "2606:4700::1111", "64:ff9b::808:808", "2002:808:808::1"] {
            assert!(is_public(ip.parse().unwrap()), "{ip}");
        }
        for ip in [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "198.18.0.1", "192.0.0.8",
            "240.0.0.1", "::1", "fd00::1", "fe80::1", "fec0::1", "2001:db8::1", "::ffff:192.168.1.1", "::127.0.0.1",
            "64:ff9b::7f00:1", "64:ff9b::c0a8:101", "2002:c0a8:0101::1", "2002:7f00:1::",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    /// A one-shot HTTP server on this machine answering `answer` to whatever it's asked.
    async fn serve(answer: Vec<u8>) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let _ = s.read(&mut buf).await;
            s.write_all(&answer).await.unwrap();
        });
        port
    }

    #[tokio::test]
    async fn plain_http() {
        let mut answer = b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n\x89PNG\r\n\r\n0\r\n\r\n".to_vec();
        let port = serve(answer.clone()).await;
        let how = Fetch { plain_http: true, limit: 1024, public_only: false };
        let (_, status, mime, body) = get(&format!("http://127.0.0.1:{port}/a.png"), 0, how).await.unwrap();
        assert_eq!((status, mime.as_str(), &body[..]), (200, "image/png", &b"\x89PNG\r\n"[..]));

        // Past the limit: refused, not cut short.
        answer.extend(std::iter::repeat_n(b'x', 2000));
        let port = serve(answer).await;
        assert!(get(&format!("http://127.0.0.1:{port}/a.png"), 0, how).await.is_err());

        // Sender pictures stay on HTTPS; messages' pictures never reach this machine.
        assert!(get(&format!("http://127.0.0.1:{port}/a.png"), 0, ICONS).await.is_err());
        let err = mail_image(&format!("http://127.0.0.1:{port}/a.png")).await.unwrap_err();
        assert!(format!("{err:#}").contains("isn't a public address"), "{err:#}");
        assert!(mail_image("https://example.com/a.png").await.is_err());
        // Nothing that could add to the request's lines, in the address or the host.
        for bad in ["http://x.com/a.png\nX-Extra: 1", "http://x.com/a b.png", "http://x.com\r\n/a.png", "http://user@x.com/a.png", "http://x.com/\u{7f}"] {
            let err = mail_image(bad).await.unwrap_err();
            assert!(format!("{err:#}").contains("not a"), "{bad:?}: {err:#}");
        }
    }

    /// Real lookups (network): `cargo test -p mail-core icons::tests::live -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live() {
        for d in ["github.com", "stackoverflow.com", "google.com"] {
            let icon = fetch(d).await.unwrap();
            println!("{d}: {:?}", icon.as_ref().map(|i| (i.mime.clone(), i.data.len())));
            assert!(icon.is_some(), "{d}");
        }
    }
}
