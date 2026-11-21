import { createSignal } from 'solid-js';
import { api } from '../api';

// The accounts' own marker pictures (Settings › Accounts › Marker): shown instead of the
// letter wherever the marker is (sidebar, rail, folder switcher, sync status).

const [logos, setLogos] = createSignal<ReadonlyMap<number, string>>(new Map());

let loading: Promise<void> | null = null;
export function loadAccountLogos(): Promise<void> {
  if (!loading) {
    loading = api.accountLogos().then(
      (list) => {
        setLogos(new Map(list.map((l) => [l.accountId, l.dataUrl])));
      },
      () => {
        loading = null;
      },
    );
  }
  return loading;
}

/** An account's picture (data: URL), or null: its letter. */
export function accountLogo(accountId: number): string | null {
  void loadAccountLogos();
  return logos().get(accountId) ?? null;
}

export async function setAccountLogo(accountId: number, dataUrl: string | null): Promise<void> {
  await api.setAccountLogo(accountId, dataUrl);
  const next = new Map(logos());
  if (dataUrl) next.set(accountId, dataUrl);
  else next.delete(accountId);
  setLogos(next);
}

/** A chosen picture scaled to fit 128 px (PNG, keeping transparency), as a data: URL. */
export async function logoFromFile(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
