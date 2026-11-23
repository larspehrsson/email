import { createSignal, type Accessor } from 'solid-js';
import { api } from '../api';
import { loadPref, savePref } from './format';

// Sender pictures (eM Client's): the sender's own photo when they're a Google contact with one,
// else the logo or website icon of their domain, looked up and kept by the core (crate::icons).
// Asked for once per address per run; until it's known (or when there's none) the avatar shows
// initials.

/** How far pictures may be looked up (Settings › General): looking a domain's picture up
 *  contacts it, so each level lets more senders tell their mail was shown. Off until chosen. */
export type PictureLevel = 'off' | 'contacts' | 'known' | 'all';
const LEVELS: PictureLevel[] = ['off', 'contacts', 'known', 'all'];
const LEVEL_PREF = 'ui.senderPictureLevel';
/** The level View options' switch turns back on to. */
const LAST_PREF = 'ui.senderPictureLast';

function initialLevel(): PictureLevel {
  const saved = loadPref<string | null>(LEVEL_PREF, null);
  if (saved && (LEVELS as string[]).includes(saved)) return saved as PictureLevel;
  // Before levels: a plain on/off switch, on meaning "companies you write to".
  return loadPref<boolean>('ui.senderPictures', false) === true ? 'known' : 'off';
}
const [pictureLevel, setLevel] = createSignal<PictureLevel>(initialLevel());
export { pictureLevel };
export function setPictureLevel(l: PictureLevel): void {
  setLevel(l);
  savePref(LEVEL_PREF, l);
  if (l !== 'off') savePref(LAST_PREF, l);
}
/** Pictures shown at all (rows make room for them). */
export const senderPictures = () => pictureLevel() !== 'off';
/** View options' switch: off, or back to the level last chosen. */
export function setSenderPictures(on: boolean): void {
  const last = loadPref<string | null>(LAST_PREF, null);
  setPictureLevel(on ? (last && last !== 'off' && (LEVELS as string[]).includes(last) ? (last as PictureLevel) : 'known') : 'off');
}

const byAddr = new Map<string, Accessor<string | null>>();

/** The picture for an address (a data: URL), once known; null meanwhile or when there's none.
 *  Asked for again when the level changes (it's part of the key, and read here). */
export function senderIcon(addr: string): string | null {
  const level = pictureLevel();
  const a = addr.trim().toLowerCase().replace(/^<|>$/g, '');
  if (level === 'off' || !a.includes('@')) return null;
  const key = `${level}|${a}`;
  let got = byAddr.get(key);
  if (!got) {
    const [value, set] = createSignal<string | null>(null);
    byAddr.set(key, value);
    void api.senderIcon(a, level).then(set, () => {});
    got = value;
  }
  return got();
}
