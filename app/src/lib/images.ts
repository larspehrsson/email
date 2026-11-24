// Pictures in mail keep their shape. An image declared at a fixed size (width and height, as
// attributes or inline style, often in inches from Outlook) is shrunk to the reader's width by
// `max-width:100%`, but its height stays fixed: the picture squishes. Each such image gets its
// declared shape as an aspect ratio instead, so its height follows its width. (A plain
// `height:auto` would lose to the inline style, and would make a 600×1 spacer a 600×600
// square: its own pixels are 1×1.)

const PX: Record<string, number> = { px: 1, in: 96, pt: 96 / 72, pc: 16, cm: 96 / 2.54, mm: 96 / 25.4 };

/** A length from inline style ("5.35in", "514px"), in CSS pixels; null for anything else. */
function styleLength(style: string, prop: 'width' | 'height'): number | null {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([\\d.]+)\\s*(px|in|pt|pc|cm|mm)\\s*(?:!important\\s*)?(?:;|$)`, 'i').exec(style);
  return m?.[1] && m[2] ? Number(m[1]) * (PX[m[2].toLowerCase()] ?? NaN) : null;
}

/** A width or height attribute ("514", "514px"); null for a percentage or nonsense. */
function attrLength(v: string | null): number | null {
  const m = v == null ? null : /^\s*([\d.]+)\s*(px)?\s*$/i.exec(v);
  return m?.[1] ? Number(m[1]) : null;
}

/**
 * The size an image is declared at, in CSS pixels (inline style wins, as it does on screen),
 * or null when it doesn't declare both.
 */
export function declaredSize(width: string | null, height: string | null, style: string | null): { w: number; h: number } | null {
  const w = styleLength(style ?? '', 'width') ?? attrLength(width);
  const h = styleLength(style ?? '', 'height') ?? attrLength(height);
  return w && h && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null;
}

/** The message's HTML with each fixed-size image keeping its shape when shrunk. */
export function keepImageShapes(html: string): string {
  if (typeof DOMParser === 'undefined' || !/<img/i.test(html)) return html;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return html;
  }
  let changed = false;
  for (const img of Array.from(doc.images)) {
    const size = declaredSize(img.getAttribute('width'), img.getAttribute('height'), img.getAttribute('style'));
    if (!size) continue;
    img.style.setProperty('aspect-ratio', `${size.w} / ${size.h}`);
    img.style.setProperty('height', 'auto', 'important');
    changed = true;
  }
  // Keep head styles and <body> attributes (the outer srcdoc parser merges them).
  return changed ? doc.head.innerHTML + doc.body.outerHTML : html;
}

/**
 * A picture from a plain `http://` address gets a second try through the app when it fails.
 * The webview upgrades such pictures to https (as any secure page does), so one whose server
 * has no working certificate there shows broken, though it loads fine over http (as it does in
 * other mail apps). `proxy` gives the app's address for it, or null (the browser preview).
 * Only for a message allowed to load remote pictures. Call on each load of the frame.
 */
export function rescueHttpImages(doc: Document, proxy: (url: string) => string | null): void {
  const plain = (img: HTMLImageElement) => /^\s*http:\/\//i.test(img.getAttribute('src') ?? '');
  const retry = (img: HTMLImageElement) => {
    const via = proxy((img.getAttribute('src') ?? '').trim().replace(/^http:/i, 'http:'));
    if (!via || img.dataset.mailRetried) return;
    img.dataset.mailRetried = '1';
    img.removeAttribute('srcset');
    img.src = via;
  };
  for (const img of Array.from(doc.images)) {
    if (!plain(img)) continue;
    if (img.complete && img.naturalWidth === 0) retry(img);
    else if (!img.complete) img.addEventListener('error', () => retry(img), { once: true });
  }
}

/** Styles for `zoomableImages` (in the message's own document). */
export const ZOOM_CSS = `img.mail-zoom{cursor:zoom-in}img.mail-zoom.mail-full{max-width:none!important;cursor:zoom-out}`;

/**
 * Pictures the reader shrank to fit can be clicked to see them at their actual size (scrolling
 * sideways), and clicked again to fit, like Thunderbird. Linked pictures follow their link.
 * Call on each load of a message frame's document; `changed` runs after each click.
 */
export function zoomableImages(doc: Document, changed?: () => void): void {
  const mark = () => {
    for (const img of Array.from(doc.images)) {
      if (img.classList.contains('mail-full') || img.closest('a')) continue;
      const size = declaredSize(img.getAttribute('width'), img.getAttribute('height'), img.getAttribute('style'));
      const full = size?.w ?? img.naturalWidth;
      img.classList.toggle('mail-zoom', full > img.getBoundingClientRect().width + 1);
    }
  };
  mark();
  for (const img of Array.from(doc.images)) if (!img.complete) img.addEventListener('load', mark, { once: true });
  doc.defaultView?.addEventListener('resize', mark);
  doc.addEventListener('click', (e) => {
    const img = e.target as HTMLImageElement | null;
    if (img?.tagName !== 'IMG' || !img.classList.contains('mail-zoom')) return;
    e.preventDefault();
    img.classList.toggle('mail-full');
    changed?.();
  });
}
