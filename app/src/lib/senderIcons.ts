import { createSignal, type Accessor } from 'solid-js';
import { api } from '../api';
import { loadPref, savePref } from './format';

// Sender pictures (eM Client's): the sender's own photo when they're a Google contact with one,
// else the logo or website icon of their domain, looked up and kept by the core (crate::icons).
// Asked for once per address per run; until it's known (or when there's none) the avatar shows
// initials.

// Off until turned on (View options): looking a domain's picture up contacts it. And then only
// for domains the user corresponds with (`Core::sender_icon`), never in Spam.
const [senderPictures, setSenderPicturesSig] = createSignal(loadPref<boolean>('ui.senderPictures', false) === true);
export { senderPictures };
export function setSenderPictures(on: boolean): void {
  setSenderPicturesSig(on);
  savePref('ui.senderPictures', on);
}

const byAddr = new Map<string, Accessor<string | null>>();

/** The picture for an address (a data: URL), once known; null meanwhile or when there's none. */
export function senderIcon(addr: string): string | null {
  const key = addr.trim().toLowerCase().replace(/^<|>$/g, '');
  if (!key.includes('@')) return null;
  let got = byAddr.get(key);
  if (!got) {
    const [value, set] = createSignal<string | null>(null);
    byAddr.set(key, value);
    void api.senderIcon(key).then(set, () => {});
    got = value;
  }
  return got();
}
