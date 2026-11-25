import { createEffect, onCleanup } from 'solid-js';
import { forwardFrameKeys } from '../lib/frameKeys';
import { rescueHttpImages, zoomableImages } from '../lib/images';
import { httpPictures } from '../lib/privacy';
import { mailImageUrl } from '../api';
import { watchFrameLinks } from './LinkPeek';
import { watchFrameMenu } from './BodyMenu';

/**
 * Sandboxed HTML body that grows to its content height.
 * `allow-same-origin` lets the parent read the inner document to measure it; with
 * `allow-scripts` the app's own listeners run in it under WebKit (keys, quote toggles). The
 * email can't run code: it's sanitised and the document's CSP has script-src 'none' (see
 * `buildSrcdoc`). Built imperatively so sandbox + srcdoc are set before attachment.
 */
export function AutoHeightFrame(props: { doc: string; sender?: string; messageId?: number; remote?: boolean }) {
  let host!: HTMLDivElement;
  createEffect(() => {
    const f = document.createElement('iframe');
    f.className = 'card-frame';
    f.title = 'Message body';
    f.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox');
    f.setAttribute('referrerpolicy', 'no-referrer');
    // Until its images are in (they give most HTML mail its height), the frame keeps at least
    // the room left in the pane: a long message opens at about its size instead of growing from
    // a strip as each image arrives; a short one shrinks once, at the end.
    let floor = 160;
    const pane = host.closest('.conv-scroll, .reader-scroll');
    if (pane) floor = Math.max(floor, Math.floor(pane.getBoundingClientRect().bottom - host.getBoundingClientRect().top - 16));
    let settled = false;
    f.style.height = `${floor}px`;
    f.srcdoc = props.doc;

    // A message wider than the pane (a picture at its actual size, a too-wide email) widens its
    // card (or the reader's page), and the pane scrolls sideways: one scrollbar, at the bottom of
    // the pane, not one at the end of a long message. Its width is measured at the pane's width (so a
    // picture fitted again lets the card narrow back).
    let wide = false;
    const widen = (de: HTMLElement) => {
      const card = host.closest<HTMLElement>('.card-msg, .reader-page');
      if (!card || (!wide && de.scrollWidth <= de.clientWidth + 1)) return;
      card.style.width = '';
      const extra = de.scrollWidth - de.clientWidth;
      wide = extra > 1;
      if (wide) card.style.width = `${card.offsetWidth + extra}px`;
    };
    let ro: ResizeObserver | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let last = -1;
    const measure = () => {
      const doc = f.contentDocument;
      const de = doc?.documentElement;
      const body = doc?.body;
      if (!doc || !de || !body) return;
      const cs = doc.defaultView?.getComputedStyle(body);
      const margins = cs ? parseFloat(cs.marginTop) + parseFloat(cs.marginBottom) : 0;
      // The html box's own height shrinks with content (unlike scrollHeight, which is floored
      // at the viewport); body.scrollHeight catches overflowing children.
      widen(de);
      const h = Math.ceil(Math.max(de.getBoundingClientRect().height, body.scrollHeight + margins, settled ? 24 : floor));
      if (Math.abs(h - last) > 1) {
        last = h;
        f.style.height = `${h}px`;
      }
    };
    f.addEventListener('load', () => {
      const doc = f.contentDocument;
      if (!doc) return;
      forwardFrameKeys(f);
      watchFrameLinks(f, props.sender ?? null);
      if (props.messageId != null) watchFrameMenu(f, props.messageId);
      zoomableImages(doc, () => measure());
      if (props.remote && httpPictures()) rescueHttpImages(doc, mailImageUrl);
      last = -1;
      measure();
      ro?.disconnect();
      ro = new ResizeObserver(() => measure());
      ro.observe(doc.documentElement);
      if (doc.body) ro.observe(doc.body);
      ro.observe(f); // width changes (pane resize) reflow the content
      // Expanding/collapsing quoted history (native <details>): 'toggle' doesn't bubble, so capture.
      doc.addEventListener('toggle', measure, true);
      // Settled once every image has loaded (or failed), or after a while regardless.
      let pending = 0;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(settleTimer);
        measure();
      };
      const imageDone = () => {
        measure();
        if (--pending === 0) settle();
      };
      doc.querySelectorAll('img').forEach((img) => {
        if (!img.complete) {
          pending++;
          img.addEventListener('load', imageDone, { once: true });
          img.addEventListener('error', imageDone, { once: true });
        }
      });
      if (pending === 0) settle();
      else settleTimer = setTimeout(settle, 2500);
      void doc.fonts?.ready.then(measure);
    });
    host.replaceChildren(f);
    onCleanup(() => {
      ro?.disconnect();
      clearTimeout(settleTimer);
    });
  });
  return <div class="card-frame-wrap" ref={host} />;
}
