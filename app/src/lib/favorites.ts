import { createSignal } from 'solid-js';
import { loadPref, savePref } from './format';
import { accounts, foldersByAccount } from '../state';
import type { Folder } from '../types';

// Folders pinned above the accounts (right-click → Add to favorites), in the order they were
// added, remembered between runs. Kept by account address and folder path, not the folder's row
// id: ids are reused (an account removed and another added can get them), and a folder that
// comes back (an account added again) gets a new one. One that's gone isn't shown, and keeps its
// place should it come back.

const PREF = 'ui.favoriteFolders';

/** Favorites stay at the top of the sidebar and rail while the folders under them scroll
 *  (Settings › General › Appearance); on unless turned off. */
const PIN_PREF = 'ui.pinFavorites';
const [pinFavorites, setPinSig] = createSignal<boolean>(loadPref<boolean>(PIN_PREF, true) !== false);
export { pinFavorites };
export function setPinFavorites(on: boolean): void {
  setPinSig(on);
  savePref(PIN_PREF, on);
}
const [keys, setKeys] = createSignal<string[]>(loadPref<unknown[]>(PREF, []).filter((k): k is string => typeof k === 'string'));

/** A folder's lasting name: its account's address and its path. */
function keyOf(f: Folder): string | null {
  const email = (accounts() ?? []).find((a) => a.id === f.accountId)?.email;
  return email ? `${email.toLowerCase()}\u0000${f.path.join('\u0001')}` : null;
}

export function isFavorite(f: Folder): boolean {
  const k = keyOf(f);
  return k != null && keys().includes(k);
}

export function toggleFavorite(f: Folder): void {
  const k = keyOf(f);
  if (k == null) return;
  setKeys((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  savePref(PREF, keys());
}

/** The pinned folders that exist, in the order they were pinned. */
export function favoriteFolders(): Folder[] {
  const byKey = new Map<string, Folder>();
  for (const list of Object.values(foldersByAccount)) {
    for (const f of list) {
      const k = keyOf(f);
      if (k != null && f.selectable) byKey.set(k, f);
    }
  }
  return keys().flatMap((k) => byKey.get(k) ?? []);
}
