import { createSignal } from 'solid-js';
/** Platform class on <html> ("macos" | "windows" | "linux") for platform-specific chrome.
 *  `?mac` forces macOS (browser mock / design checks). */
export type Platform = 'macos' | 'windows' | 'linux';

function detect(): Platform {
  try {
    if (new URLSearchParams(location.search).has('mac')) return 'macos';
  } catch {
    /* ignore */
  }
  const ua = navigator.userAgent;
  const plat = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  if (/Mac OS X|Macintosh/i.test(ua) || /^Mac/i.test(plat)) return 'macos';
  if (/Windows/i.test(ua) || /^Win/i.test(plat)) return 'windows';
  return 'linux';
}

export const platform: Platform = detect();
document.documentElement.classList.add(platform);

/**
 * Value for `data-tauri-drag-region`. Only macOS drags the window from pane tops (its title
 * bar is an overlay); elsewhere the native title bar does that, and "false" stops Tauri's drag
 * script from swallowing mouse presses (and with them text selection) in those areas.
 */
export const DRAG: 'true' | 'false' = platform === 'macos' ? 'true' : 'false';

// A window in the background doesn't animate: its continuous animations (sync spinner and
// progress bar, loading shimmer) pause while another window, like a compose window, has
// focus. In WebKitGTK every window draws on one thread, so they'd steal the frames the focused
// window needs; it also saves battery.
//
// It also shows it: in the background its selection and folder icons turn from blue to grey
// (keys go elsewhere). Set as variables on the page itself, which everything inherits, rather
// than by a selector on `html.inactive`: WebKitGTK sometimes misses restyling for those.
const [windowActive, setWindowActive] = createSignal(true);
/** This window has the focus (keys come here). */
export { windowActive };
const AWAY: Record<string, string> = {
  '--away-sel-folder-bg': 'var(--sel-bg-away)',
  '--away-sel-folder-fg': 'var(--text)',
  '--away-accent-icon': 'var(--text-3)',
};
const setActive = (active: boolean) => {
  const root = document.documentElement;
  root.classList.toggle('inactive', !active);
  for (const [k, v] of Object.entries(AWAY)) {
    if (active) root.style.removeProperty(k);
    else root.style.setProperty(k, v);
  }
  setWindowActive(active);
};
window.addEventListener('focus', () => setActive(true));
// A click into a message body (its own frame, its own document) blurs this page too, but the
// window still has the focus: only another window taking it puts this one in the background.
window.addEventListener('blur', () => setActive(document.activeElement?.tagName === 'IFRAME'));
setActive(document.hasFocus());

/**
 * Follow the focus in a message frame (call on each load): coming back to the window by
 * clicking into a message body focuses only the frame, and leaving it from there blurs only
 * the frame.
 */
export function watchFrameFocus(frame: HTMLIFrameElement): void {
  const win = frame.contentWindow;
  if (!win) return;
  win.addEventListener('focus', () => setActive(true));
  // Focus moving back to the page brings its own 'focus'; nothing focused: another window.
  win.addEventListener('blur', () => setTimeout(() => setActive(document.hasFocus())));
}
