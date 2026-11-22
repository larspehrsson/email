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
  const mine: Promise<void> = (running ?? Promise.resolve()).then(go, go).finally(() => {
    // Only the last one queued clears it: one still waiting behind this keeps its place.
    if (running === mine) running = null;
  });
  running = mine;
  return mine;
}

/** After a card of a linked account is saved or deleted: send it soon (edits in a row, once
 * for each account edited). */
let soon: ReturnType<typeof setTimeout> | undefined;
const soonFor = new Set<number>();
export function syncGoogleSoon(accountId: number): void {
  soonFor.add(accountId);
  clearTimeout(soon);
  soon = setTimeout(() => {
    const ids = [...soonFor];
    soonFor.clear();
    for (const id of ids) void syncGoogle(id);
  }, 1500);
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
