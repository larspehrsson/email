// Where a link in a message really goes, for the address shown while the pointer is over it
// (components/LinkPeek.tsx), and the two things worth a warning there:
//  - the link's text is an address, and the link goes somewhere else ("www.facebook.com" that
//    leads to another site): the usual trick in phishing mail;
//  - the site's name has international letters, which can imitate another name (a Cyrillic "а"
//    in "fаcebook.com"); it's shown as the browser will see it, xn--….
// No imports: the unit tests run it as is.

export interface LinkInfo {
  /** What the link opens, in full. */
  url: string;
  /** The site (or, for mailto:, the address), shown in bold. */
  host: string;
  /** What's before the site (https://) and after it (/path?query). */
  before: string;
  after: string;
  /** Why to look twice, if there's a reason. */
  warning: string | null;
}

/** "www.Example.com." → "example.com"; the same for the link's site and the text's. */
function plainHost(h: string): string {
  return h.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

/** The site named by a link's text, if its whole text is an address ("facebook.com/help",
 *  "https://www.facebook.com"); null for words ("Click here", "Facebook"). */
export function textHost(text: string): string | null {
  const t = text.trim().replace(/^<|>$/g, '');
  if (!t || /\s/.test(t)) return null;
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]+@)?((?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,})\.?(?::\d+)?(?:[/?#].*)?$/iu.exec(t);
  if (!m) return null;
  try {
    return plainHost(new URL(`http://${m[1]}`).hostname);
  } catch {
    return null;
  }
}

/** One site is the other, or inside it (mail.facebook.com and facebook.com). */
function sameSite(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function describeLink(href: string, text: string): LinkInfo {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return { url: href, host: '', before: href, after: '', warning: null };
  }
  if (u.protocol === 'mailto:') {
    const to = decodeURIComponent(u.pathname);
    return { url: href, host: to, before: 'mailto:', after: u.search ? '?…' : '', warning: null };
  }
  const host = u.hostname;
  const at = href.toLowerCase().indexOf('//') + 2;
  const rest = u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname + u.search + u.hash;
  const info: LinkInfo = {
    url: u.href,
    host,
    before: at > 1 ? `${u.protocol}//` : '',
    after: (u.port ? `:${u.port}` : '') + rest,
    warning: null,
  };
  if (!host) return info;
  const shown = textHost(text);
  const goes = plainHost(host);
  if (shown && !sameSite(shown, goes)) {
    info.warning = `The text says ${shown}, but the link goes to ${goes}.`;
  } else if (/(^|\.)xn--/.test(host)) {
    info.warning = 'This name has international letters, which can imitate another site’s name.';
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) {
    info.warning = 'This goes to a bare internet address, not a named site.';
  }
  return info;
}
