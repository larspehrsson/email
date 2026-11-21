import { createSignal, Show } from 'solid-js';
import { describeLink, type LinkInfo } from '../lib/linkCheck';

// Where a link goes, shown at the bottom of the message while the pointer is over it (or the
// link has the keyboard's focus), as a browser's status bar does: an email's link text can say
// anything, the address is what counts. Text that's an address for another site gets a warning
// (lib/linkCheck.ts).

interface Peek {
  info: LinkInfo;
  /** The message's area on screen (the frame, or the pane for a plain-text message). */
  area: DOMRect;
  /** The link itself, on screen: the bar moves right when it would cover it. */
  link: DOMRect;
}

const [peek, setPeek] = createSignal<Peek | null>(null);

function show(a: Element, area: DOMRect, offset = { x: 0, y: 0 }) {
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#')) return setPeek(null);
  // The resolved address, as a click would open it.
  const url = (a as HTMLAnchorElement).href || href;
  const r = a.getBoundingClientRect();
  const link = new DOMRect(r.left + offset.x, r.top + offset.y, r.width, r.height);
  setPeek({ info: describeLink(url, a.textContent ?? ''), area, link });
}

export function hidePeek() {
  setPeek(null);
}

/** The links inside a message frame: call once its document has loaded. */
export function watchFrameLinks(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const linkOf = (t: EventTarget | null) => (t && 'closest' in (t as Element) ? (t as Element).closest('a[href]') : null);
  const at = (a: Element) => {
    const area = frame.getBoundingClientRect();
    show(a, area, { x: area.left, y: area.top });
  };
  doc.addEventListener('mouseover', (e) => {
    const a = linkOf(e.target);
    if (a) at(a);
  });
  doc.addEventListener('mouseout', (e) => {
    const a = linkOf(e.target);
    if (a && !a.contains(e.relatedTarget as Node | null)) setPeek(null);
  });
  doc.addEventListener('focusin', (e) => {
    const a = linkOf(e.target);
    if (a) at(a);
  });
  doc.addEventListener('focusout', () => setPeek(null));
  // Scrolling moves the link away from the pointer; a new message replaces the frame.
  doc.addEventListener('scroll', () => setPeek(null), true);
  frame.contentWindow?.addEventListener('pagehide', () => setPeek(null));
}

/** For a link in the app's own page (a plain-text message's links); `area` selects the pane
 *  it's in, whose bottom the address is shown at. */
export function peekHandlers(area: string) {
  return {
    onMouseEnter: (e: MouseEvent) => {
      const a = e.currentTarget as Element;
      show(a, (a.closest(area) ?? a).getBoundingClientRect());
    },
    onMouseLeave: () => setPeek(null),
  };
}

export function LinkPeek() {
  return (
    <Show when={peek()}>
      {(p) => {
        const view = () => {
          const { area, link } = p();
          const top = Math.max(area.top, 0);
          const bottom = Math.min(area.bottom, window.innerHeight);
          const left = Math.max(area.left, 0);
          const right = Math.min(area.right, window.innerWidth);
          const width = Math.max(right - left - 16, 120);
          // Over the link itself (it's in the lower left corner): the lower right instead.
          const covers = link.bottom > bottom - 64 && link.left < left + width * 0.6;
          return {
            bottom: `${window.innerHeight - bottom + 8}px`,
            ...(covers ? { right: `${window.innerWidth - right + 8}px` } : { left: `${left + 8}px` }),
            'max-width': `${Math.min(width, 720)}px`,
            // Keep it inside the message if the message is very short.
            'max-height': `${Math.max(bottom - top - 16, 24)}px`,
          };
        };
        return (
          <div class="link-peek" classList={{ warn: !!p().info.warning }} style={view()} role="status" aria-live="polite">
            <div class="lp-url" title={p().info.url}>
              <span class="lp-dim">{p().info.before}</span>
              <span class="lp-host">{p().info.host}</span>
              <span class="lp-dim">{p().info.after}</span>
            </div>
            <Show when={p().info.warning}>{(w) => <div class="lp-warn">⚠︎ {w()}</div>}</Show>
          </div>
        );
      }}
    </Show>
  );
}
