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

/** The longest side a picture in a signature is kept at (pixels): sharp on a Retina screen at
 *  the sizes signatures use, small enough to send with every message. */
const PICTURE_MAX = 800;
/** Bigger than this (bytes of data: URL) and it's sent as a JPEG instead. */
const PICTURE_BUDGET = 200_000;

/** A picture (pasted, dropped or chosen) as a data: URL for a signature: scaled down to
 *  `PICTURE_MAX`, PNG (keeping transparency) unless that's too big, and the width to show it
 *  at (CSS pixels: a Retina screenshot shows at the size it was on screen, at most 300). */
export async function pictureForSignature(file: Blob, dpr = window.devicePixelRatio || 1): Promise<{ src: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, PICTURE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    let src = canvas.toDataURL('image/png');
    if (src.length > PICTURE_BUDGET) {
      // A photo: JPEG on white (no transparency there).
      const flat = document.createElement('canvas');
      flat.width = w;
      flat.height = h;
      const ctx = flat.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(canvas, 0, 0);
      src = flat.toDataURL('image/jpeg', 0.85);
    }
    const shown = Math.min(300, Math.round(img.naturalWidth / dpr));
    return { src, width: shown, height: Math.round((shown * h) / w) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
