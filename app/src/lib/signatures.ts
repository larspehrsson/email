import { createSignal } from 'solid-js';
import { api, type Signature, type Signatures } from '../api';
import { broadcast, onBroadcast } from './windows';

// Signatures (kept by the core): the list Settings edits and the composer picks from, shared
// by every window (a change in Settings reaches open compose windows).

const [sigs, setSigs] = createSignal<Signatures>({ signatures: [], defaults: [] });
export { sigs };

let loaded: Promise<Signatures> | null = null;

/** The signatures, loaded once (then kept up to date by `reloadSignatures`). */
export function loadSignatures(): Promise<Signatures> {
  loaded ??= api.listSignatures().then(
    (s) => (setSigs(s), s),
    (e) => {
      loaded = null;
      throw e;
    },
  );
  return loaded;
}

/** Fetch them again (after a change), here and in the other windows. */
export async function reloadSignatures(tell = true): Promise<void> {
  loaded = null;
  await loadSignatures();
  if (tell) broadcast('signatures-changed', {});
}
onBroadcast('signatures-changed', () => void reloadSignatures(false).catch(() => {}));

/** An account's defaults as just chosen (before the core's copy comes back), so a second
 *  change right after builds on the first. */
export function setDefaultsHere(accountId: number, newId: number | null, replyId: number | null): void {
  const s = sigs();
  setSigs({ ...s, defaults: [...s.defaults.filter((d) => d.accountId !== accountId), { accountId, newId, replyId }] });
}

export function signatureById(id: number | null | undefined): Signature | undefined {
  return id == null ? undefined : sigs().signatures.find((s) => s.id === id);
}

/** The account's default signature for a new message (`reply` false) or a reply / forward. */
export function defaultSignature(s: Signatures, accountId: number, reply: boolean): Signature | undefined {
  const d = s.defaults.find((x) => x.accountId === accountId);
  const id = reply ? d?.replyId : d?.newId;
  return id == null ? undefined : s.signatures.find((x) => x.id === id);
}

/** The text, then the signature (a blank line between), for the message sent. */
export function withSignature(html: string, sig: string | null | undefined): string {
  if (!sig) return html;
  return `${html}<br><div class="signature">${sig}</div>`;
}
