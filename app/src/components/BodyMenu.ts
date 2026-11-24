import { openContextMenu, type MenuItem } from './ContextMenu';
import { openSource } from './SourceView';
import { addressMenuItems } from './AddressMenu';

// The right-click menu over a message's body (the app's own, as elsewhere, instead of the
// webview's Reload / Inspect): Copy what's selected, Copy link address over a link, and Show
// source. An HTML body is a frame of its own, whose events don't reach the page: its menu is
// opened from inside it, at the same spot in the window.

function copy(text: string, doc: Document) {
  void navigator.clipboard.writeText(text).catch(() => doc.execCommand('copy'));
}

function items(messageId: number, doc: Document, target: EventTarget | null): MenuItem[] {
  const list: MenuItem[] = [];
  const selected = doc.getSelection()?.toString() ?? '';
  if (selected.trim()) list.push({ label: 'Copy', run: () => copy(selected, doc) });
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
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
  list.push({ label: 'Show source…', run: () => openSource(messageId) });
  return list;
}

/** The menu for an HTML body: call once its frame's document has loaded. */
export function watchFrameMenu(frame: HTMLIFrameElement, messageId: number): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.addEventListener('contextmenu', (e) => {
    const r = frame.getBoundingClientRect();
    e.preventDefault();
    openContextMenu(new MouseEvent('contextmenu', { clientX: r.left + e.clientX, clientY: r.top + e.clientY }), items(messageId, doc, e.target));
  });
}

/** The menu for a plain-text body (in the page itself). */
export function bodyMenu(e: MouseEvent, messageId: number): void {
  openContextMenu(e, items(messageId, document, e.target));
}
