// Pictures put into what's written (a signature's logo, a screenshot pasted into a message):
// scaled down, as a data: URL — sending makes each an inline part the HTML refers to by cid:
// (the core's compose::inline_images).

/** `file` as a data: URL at most `max` px on its longest side: PNG (keeping transparency)
 *  unless that's over `budget` bytes, then JPEG on white. With the width to show it at (CSS
 *  pixels: a Retina screenshot at the size it was on screen, at most `showMax`). */
export async function scalePicture(
  file: Blob,
  o: { max: number; budget: number; showMax: number; dpr?: number },
): Promise<{ src: string; width: number; height: number }> {
  const dpr = o.dpr ?? (window.devicePixelRatio || 1);
  const img = await loadPicture(file);
  const scale = Math.min(1, o.max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  let src = canvas.toDataURL('image/png');
  if (src.length > o.budget) {
    const flat = document.createElement('canvas');
    flat.width = w;
    flat.height = h;
    const ctx = flat.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0);
    src = flat.toDataURL('image/jpeg', 0.85);
  }
  const shown = Math.min(o.showMax, Math.round(img.naturalWidth / dpr));
  return { src, width: shown, height: Math.round((shown * h) / w) };
}

/** A file as a loaded picture. Read as a data: URL: the app's content policy allows pictures
 *  from data: (not blob:, which a browser tab would take but the app's window refuses). */
export async function loadPicture(file: Blob): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Couldn’t read the picture.'));
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

/** The pictures a paste carries: its files, or (WebKit fills only these for a screenshot on
 *  the clipboard) its items that are files. */
export function pastedPictures(data: DataTransfer | null | undefined): File[] {
  const files = picturesIn(data?.files);
  if (files.length) return files;
  return [...(data?.items ?? [])]
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
}

/** The pictures among pasted or dropped files. */
export const picturesIn = (list: FileList | null | undefined): File[] => [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
