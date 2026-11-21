import { createSignal } from 'solid-js';
import { api, type GoogleStatus } from '../api';
import { reloadCards } from './addressBook';

// Google Contacts (crate::gcontacts): which accounts are linked, and syncing them — when the
// address book opens, after a change to one of their cards, and every quarter of an hour.

const [googleStatus, setGoogleStatus] = createSignal<GoogleStatus | null>(null);
export { googleStatus };

export async function reloadGoogleStatus(): Promise<GoogleStatus | null> {
  const s = await api.googleStatus().catch(() => null);
  setGoogleStatus(s);
  return s;
}

export const googleLink = (accountId: number) => googleStatus()?.links.find((l) => l.accountId === accountId) ?? null;

let running: Promise<void> | null = null;
/** Sync (one account, or all linked), then show what came in. One at a time. */
export function syncGoogle(accountId?: number): Promise<void> {
  const go = async () => {
    const s = googleStatus() ?? (await reloadGoogleStatus());
    if (!s || s.links.length === 0) return;
    const changed = await api.googleSync(accountId ?? null).catch(() => false);
    if (changed) await reloadCards();
    await reloadGoogleStatus();
  };
  running = (running ?? Promise.resolve()).then(go, go).finally(() => (running = null));
  return running;
}

/** After a card of a linked account is saved or deleted: send it soon (edits in a row, once). */
let soon: ReturnType<typeof setTimeout> | undefined;
export function syncGoogleSoon(accountId: number): void {
  clearTimeout(soon);
  soon = setTimeout(() => void syncGoogle(accountId), 1500);
}

let timer: ReturnType<typeof setInterval> | undefined;
/** The main window keeps them in step every 15 minutes. */
export function startGoogleSync(): void {
  if (timer) return;
  void reloadGoogleStatus().then((s) => {
    if (s?.links.length) void syncGoogle();
  });
  timer = setInterval(() => void syncGoogle(), 15 * 60 * 1000);
}
