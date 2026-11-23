import { createSignal } from 'solid-js';
import { loadPref, savePref } from './format';

// Folders pinned above the accounts (right-click → Add to favorites), in the order they were
// added, remembered between runs. An id whose folder is gone (account removed, folder deleted)
// is kept but not shown, so a folder that comes back keeps its place.

const [ids, setIds] = createSignal<number[]>(loadPref<number[]>('ui.favoriteFolders', []));
export { ids as favoriteIds };

export function isFavorite(id: number): boolean {
  return ids().includes(id);
}

export function toggleFavorite(id: number): void {
  setIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  savePref('ui.favoriteFolders', ids());
}