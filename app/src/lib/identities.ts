import { createSignal } from 'solid-js';
import { api, type Identity } from '../api';
import { broadcast, onBroadcast } from './windows';

// The other addresses accounts send as (kept by the core), shared by every window: Settings
// edits them, the composer's From picks from them.

const [identities, setIdentities] = createSignal<Identity[]>([]);
export { identities };

let loaded: Promise<Identity[]> | null = null;

export function loadIdentities(): Promise<Identity[]> {
  loaded ??= api.identities().then(
    (l) => (setIdentities(l), l),
    (e) => {
      loaded = null;
      throw e;
    },
  );
  return loaded;
}

export async function reloadIdentities(tell = true): Promise<void> {
  loaded = null;
  await loadIdentities();
  if (tell) broadcast('identities-changed', {});
}
onBroadcast('identities-changed', () => void reloadIdentities(false).catch(() => {}));

export const accountIdentities = (accountId: number, list = identities()) => list.filter((i) => i.accountId === accountId);

/** What an account sends as unless told otherwise: its default identity, else its own (null). */
export function defaultIdentity(accountId: number, list = identities()): number | null {
  return list.find((i) => i.accountId === accountId && i.isDefault)?.id ?? null;
}

export const identityById = (id: number | null | undefined, list = identities()) => (id == null ? undefined : list.find((i) => i.id === id));
