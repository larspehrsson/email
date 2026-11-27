import { openContextMenu, type MenuItem } from './ContextMenu';
import { openSource } from './SourceView';
import { addressMenuItems } from './AddressMenu';
import { api, errorMessage } from '../api';
import { showToast } from './Toast';

// The right-click menu over a message's body (the app's own, as elsewhere, instead of the
// webview's Reload / Inspect, whose Save Image does nothing here): Copy what's selected, Copy
// link address over a link, Save image as… and Copy image address over a picture, and Show
// source. An HTML body is a frame of its own, whose events don't reach the page: its menu is
// opened from inside it, at the same spot in the window.

function copy(text: string, doc: Document) {
  void navigator.clipboard.writeText(text).catch(() => doc.execCommand('copy'));
}

/** A name to save a picture under: the last part of its address, else its alt text. */
function pictureName(img: HTMLImageElement): string {
  const src = img.currentSrc || img.src;
  if (!src.startsWith('data:')) {
    try {
      // (A picture the app fetched itself: the address inside its own.)
      const u = new URL(src);
      const inner = u.protocol === 'mailimg:' || u.hostname === 'mailimg.localhost' ? new URL(decodeURIComponent(u.pathname.slice(1))) : u;
      const last = decodeURIComponent(inner.pathname.split('/').pop() ?? '');
      if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
    } catch {
      /* no name in it */
    }
  }
  const alt = img.alt.trim().replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60).trim();
  return alt || 'image';
}

async function saveImage(img: HTMLImageElement) {
  try {
    const path = await api.saveImageAs(img.currentSrc || img.src, pictureName(img));
    if (path) showToast({ kind: 'ok', text: `Saved ${path.split(/[\\/]/).pop() ?? path}`, path });
  } catch (e) {
    showToast({ kind: 'error', text: errorMessage(e) });
  }
}

function items(messageId: number | null, doc: Document, target: EventTarget | null): MenuItem[] {
  const list: MenuItem[] = [];
  const selected = doc.getSelection()?.toString() ?? '';
  if (selected.trim()) list.push({ label: 'Copy', run: () => copy(selected, doc) });
  // (A frame's nodes are of its own window's Element: `instanceof` here would never match.)
  const el = target && (target as Node).nodeType === Node.ELEMENT_NODE ? (target as Element) : null;
  const link = el?.closest<HTMLAnchorElement>('a[href]') ?? null;
  const href = link?.href ?? '';
  if (href.toLowerCase().startsWith('mailto:')) {
    // An email address in the message: write to it, or copy it.
    let addr = href.slice(7).split('?')[0] ?? '';
    try {
      addr = decodeURIComponent(addr);
    } catch {
      /* as written */
    }
    if (addr) list.push(...addressMenuItems({ name: null, addr }));
  } else if (href && !href.startsWith('about:') && !href.startsWith('#')) {
    list.push({ label: 'Copy link address', run: () => copy(href, doc) });
  }
  // A picture that's showing (not one blocked or still loading).
  const img = el?.closest('img') ?? null;
  if (img && img.complete && img.naturalWidth > 0) {
    list.push({ label: 'Save image as…', separatorBefore: list.length > 0, run: () => void saveImage(img) });
    const src = img.currentSrc || img.src;
    if (/^https?:/i.test(src) && !/^http:\/\/mailimg\.localhost/i.test(src)) list.push({ label: 'Copy image address', run: () => copy(src, doc) });
  }
  if (messageId != null) list.push({ label: 'Show source…', separatorBefore: !!img, run: () => openSource(messageId) });
  return list;
}

/** The menu for an HTML body: call once its frame's document has loaded. Without a message
 *  (the original quoted under a reply), no Show source. */
export function watchFrameMenu(frame: HTMLIFrameElement, messageId: number | null): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.addEventListener('contextmenu', (e) => {
    const r = frame.getBoundingClientRect();
    e.preventDefault();
    const list = items(messageId, doc, e.target);
    if (list.length) openContextMenu(new MouseEvent('contextmenu', { clientX: r.left + e.clientX, clientY: r.top + e.clientY }), list);
  });
}

/** The menu for a plain-text body (in the page itself). */
export function bodyMenu(e: MouseEvent, messageId: number): void {
  openContextMenu(e, items(messageId, document, e.target));
}
