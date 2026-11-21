import { createSignal } from 'solid-js';
import { api, type Card } from '../api';
import { broadcast, onBroadcast } from './windows';

// The address book (kept by the core), shared by every window.

const [cards, setCards] = createSignal<Card[]>([]);
export { cards };

let loaded: Promise<Card[]> | null = null;

export function loadCards(): Promise<Card[]> {
  loaded ??= api.listCards().then(
    (c) => (setCards(c), c),
    (e) => {
      loaded = null;
      throw e;
    },
  );
  return loaded;
}

/** Fetch them again (after a change), here and in the other windows. */
export async function reloadCards(tell = true): Promise<void> {
  loaded = null;
  await loadCards();
  if (tell) broadcast('cards-changed', {});
}
onBroadcast('cards-changed', () => void reloadCards(false).catch(() => {}));

/** The card holding this address (any case), if any. */
export function cardFor(addr: string): Card | undefined {
  const a = addr.trim().toLowerCase();
  return cards().find((c) => c.emails.some((e) => e.toLowerCase() === a));
}

export const emptyCard = (): Card => ({ id: 0, name: '', emails: [''], phones: [], company: '', notes: '', google: null });
