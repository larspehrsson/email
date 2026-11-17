import { createSignal } from 'solid-js';
import { api, errorMessage, events, type ExportResult, type ExportStatus } from '../api';
import { showToast } from '../components/Toast';
import { confirmDialog } from '../components/Actions';
import { accounts } from '../state';
import { fmtNum } from './format';

// An account's mail exported to mbox files (Settings › Accounts › Export…): one at a time, run
// by the core in the background; its progress shows in the sync status row and in Settings.

const [exportNow, setExportNow] = createSignal<ExportStatus | null>(null);
/** The export under way, if any. */
export { exportNow };

const email = (id: number) => accounts()?.find((a) => a.id === id)?.email ?? 'the account';
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const plural = (n: number, one: string) => `${fmtNum(n)} ${one}${n === 1 ? '' : 's'}`;

/** Text for the status row while an export runs. */
export function exportLabel(s: ExportStatus): string {
  const who = email(s.accountId);
  return s.total > 0 ? `Exporting ${who} · ${fmtNum(s.done)} / ${fmtNum(s.total)}` : `Exporting ${who}…`;
}

function finished(r: ExportResult) {
  setExportNow(null);
  if (r.error) {
    showToast({ kind: 'error', text: `The export of ${email(r.accountId)} failed: ${r.error}` });
    return;
  }
  const path = r.path ?? undefined;
  if (r.cancelled) {
    showToast({ kind: 'ok', text: `Export stopped: ${plural(r.written, 'message')} in “${baseName(r.path ?? '')}”`, path, ms: 10000 });
    return;
  }
  let text = `Exported ${plural(r.written, 'message')} to “${baseName(r.path ?? '')}”`;
  if (r.partial + r.failed > 0) text += ` · ${fmtNum(r.partial + r.failed)} incomplete (see its README)`;
  showToast({ kind: r.partial + r.failed > 0 ? 'error' : 'ok', text, path, ms: 10000 });
}

/** Start exporting an account into a new folder in `dir`. */
export async function startExport(accountId: number, dir: string): Promise<void> {
  await api.exportAccount(accountId, dir);
  setExportNow((cur) => cur ?? { accountId, done: 0, total: 0 });
}

export function cancelExport(): void {
  void api.cancelExport().catch((e) => showToast({ kind: 'error', text: errorMessage(e) }));
}

/** Main window: follow exports (one may be running already), and ask before closing one. */
export function initExports(): void {
  api.exportStatus().then((s) => s && setExportNow(s), () => {});
  void events.onExportProgress((s) => setExportNow(s));
  void events.onExportFinished(finished);
  void events.onConfirmClose(async ({ status: s, quit }) => {
    const written = s.total > 0 ? ` (${fmtNum(s.done)} of ${fmtNum(s.total)} messages)` : '';
    const stop = await confirmDialog(
      `An export of ${email(s.accountId)} is still running${written}. ${quit ? 'Quitting' : 'Closing Email’s window'} stops it; what’s written so far is kept, in a folder marked “incomplete”.`,
      quit ? 'Stop export and quit' : 'Stop export and close',
      'Keep exporting',
    );
    if (stop) await api.closeAnyway(quit);
  });
}
