import { createSignal, type Accessor } from 'solid-js';
import { api } from '../api';
import { loadPref, savePref } from './format';

// Sender pictures (eM Client's): the logo or website icon of the sender's domain, looked up
// and kept by the core (crate::icons). Asked for once per domain per run; until it's known (or
// when there's none) the avatar shows initials.

const [senderPictures, setSenderPicturesSig] = createSignal(loadPref<boolean>('ui.senderPictures', true) !== false);
export { senderPictures };
export function setSenderPictures(on: boolean): void {
  setSenderPicturesSig(on);
  savePref('ui.senderPictures', on);
}

const byDomain = new Map<string, Accessor<string | null>>();

/** The picture for an address (a data: URL), once known; null meanwhile or when there's none. */
export function senderIcon(addr: string): string | null {
  const domain = addr.split('@')[1]?.trim().toLowerCase().replace(/>$/, '');
  if (!domain) return null;
  let got = byDomain.get(domain);
  if (!got) {
    const [value, set] = createSignal<string | null>(null);
    byDomain.set(domain, value);
    void api.senderIcon(addr).then(set, () => {});
    got = value;
  }
  return got();
}
