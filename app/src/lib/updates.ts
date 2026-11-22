import { createSignal } from 'solid-js';
import { api, type UpdateStatus } from '../api';
import { loadPref, savePref } from './format';

// Updates (app/src-tauri/src/updater.rs): a copy installed from the GitHub releases asks for a
// newer version at start and every few hours (unless turned off in Settings), downloads it in
// the background, and offers Restart to update. A copy built on this computer doesn't update
// itself (`supported` false).

const FIRST_CHECK_MS = 20_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

const [status, setStatus] = createSignal<UpdateStatus | null>(null);
export { status as updateStatus };

const [autoUpdates, setAutoSig] = createSignal(loadPref<boolean>('updates.auto', true) !== false);
export { autoUpdates };
export function setAutoUpdates(on: boolean): void {
  setAutoSig(on);
  savePref('updates.auto', on);
  if (on) void checkForUpdate();
}

/** Ask now (Settings' Check now, and the timer); the status after. */
export async function checkForUpdate(): Promise<void> {
  if (status()?.supported === false) return;
  setStatus((s) => (s ? { ...s, checking: true } : s));
  try {
    setStatus(await api.checkForUpdate());
  } catch {
    setStatus(await api.updateStatus().catch(() => null));
  }
}

/** Install the downloaded version and start it; a message when it can't. */
export async function restartToUpdate(): Promise<void> {
  await api.installUpdate();
}

let started = false;
/** The main window, once: learn whether this copy updates itself, then look now and then. */
export function startUpdateChecks(): void {
  if (started) return;
  started = true;
  void api
    .updateStatus()
    .then((s) => {
      setStatus(s);
      if (!s.supported) return;
      const tick = () => {
        if (autoUpdates()) void checkForUpdate();
      };
      setTimeout(tick, FIRST_CHECK_MS);
      setInterval(tick, EVERY_MS);
    })
    .catch(() => {});
}
