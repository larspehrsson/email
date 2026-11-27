import { createResource, createSignal, Show, type JSX } from 'solid-js';
import { api, errorMessage } from '../api';
import { cancelExport, exportNow, startExport } from '../lib/exports';
import { fmtNum, fmtSize } from '../lib/format';
import { pickFolder } from '../lib/windows';
import { onAccountRemoved } from '../state';
import { CloseIcon } from './Icons';
import { showToast } from './Toast';
import { Modal } from './Modal';

// Settings › Accounts: exporting an account's mail, and removing an account from this computer.

type Acct = { id: number; email: string };

function Dialog(props: { title: string; onClose: () => void; children: JSX.Element }) {
  return (
    <Modal label={props.title} class="acct-dialog" onClose={props.onClose} focusCard>
      <div class="modal-head">
        <h2>{props.title}</h2>
        <button class="icon-btn" onClick={props.onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>
      {props.children}
    </Modal>
  );
}

/** What the export will do (download first?), then a folder to put it in. */
export function ExportDialog(props: { account: Acct; onClose: () => void }) {
  const [plan] = createResource(() => api.exportPlan(props.account.id));
  const [err, setErr] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const go = async () => {
    setErr(null);
    const dir = await pickFolder('Export to this folder');
    if (!dir) return;
    setBusy(true);
    try {
      await startExport(props.account.id, dir);
      props.onClose();
      showToast({ kind: 'ok', text: 'Exporting: its progress shows at the bottom of the sidebar.' });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Export ${props.account.email}`} onClose={props.onClose}>
      <div class="acct-dialog-body">
        <Show when={plan()} fallback={<p class="st-muted">{plan.error ? errorMessage(plan.error) : 'Counting…'}</p>}>
          {(p) => (
            <>
              <p>
                Its {fmtNum(p().messages)} messages, as one mbox file per folder in a new folder. Apple Mail,
                Thunderbird and other mail apps import them.
              </p>
              <Show
                when={p().toDownload > 0}
                fallback={<p>Everything is on this computer already: nothing to download.</p>}
              >
                <p>
                  <strong>
                    {fmtNum(p().toDownload)} {p().toDownload === 1 ? 'message isn’t' : 'messages aren’t'} complete on this
                    computer
                  </strong>{' '}
                  (attachments left on the server): they’re downloaded for the export first, about{' '}
                  {fmtSize(p().downloadBytes)}. Nothing extra stays on this computer.
                </p>
              </Show>
              <p class="st-muted">
                It runs in the background, so you can keep using Email. Closing Email’s window while it runs asks
                whether to stop it (what’s written so far is kept, in a folder marked “incomplete”).
              </p>
            </>
          )}
        </Show>
        <Show when={err()}>
          <p class="st-acct-msg error">{err()}</p>
        </Show>
      </div>
      <div class="form-actions">
        <button class="btn secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button class="btn primary" disabled={!plan() || busy() || !!exportNow()} onClick={() => void go()}>
          Choose folder and export…
        </button>
      </div>
    </Dialog>
  );
}

/** What removing takes away (and what it doesn't), with a way to export first. */
export function RemoveDialog(props: { account: Acct; onClose: () => void; onExport: () => void }) {
  const [plan] = createResource(() => api.exportPlan(props.account.id).catch(() => null));
  const [err, setErr] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const remove = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api.removeAccount(props.account.id);
      await onAccountRemoved(props.account.id);
      props.onClose();
      showToast({ kind: 'ok', text: `Removed ${props.account.email} from this computer` });
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Remove ${props.account.email}?`} onClose={props.onClose}>
      <div class="acct-dialog-body">
        <p>
          Everything Email keeps for this account on this computer is deleted
          {plan() ? `: its ${fmtNum(plan()!.messages)} messages and their downloads` : ''}.
        </p>
        <p>
          <strong>Nothing changes on the server.</strong> Your mail stays there, and you can add the account again
          later.
        </p>
        <p class="st-muted">
          To keep a copy of its mail,{' '}
          <button class="link-btn" onClick={props.onExport}>
            export it
          </button>{' '}
          first.
        </p>
        <Show when={err()}>
          <p class="st-acct-msg error">{err()}</p>
        </Show>
      </div>
      <div class="form-actions">
        <button class="btn secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button class="btn danger" disabled={busy()} onClick={() => void remove()}>
          Remove account
        </button>
      </div>
    </Dialog>
  );
}

/** The account card's action row, at its foot: Export (or an export's progress) and Remove. */
export function AccountTools(props: { account: Acct }) {
  const [dialog, setDialog] = createSignal<'export' | 'remove' | null>(null);
  const mine = () => (exportNow()?.accountId === props.account.id ? exportNow() : null);
  return (
    <>
      <div class="st-acct-actions">
        <Show
          when={mine()}
          fallback={
            <button
              class="link-btn"
              disabled={!!exportNow()}
              title="Its mail as mbox files, for other apps or a backup"
              onClick={() => setDialog('export')}
            >
              Export…
            </button>
          }
        >
          {(s) => (
            <span class="st-acct-exporting">
              <span class="st-muted">Exporting · {s().total > 0 ? `${fmtNum(s().done)} / ${fmtNum(s().total)}` : 'starting…'}</span>
              <button class="link-btn" onClick={cancelExport}>
                Stop
              </button>
            </span>
          )}
        </Show>
        <button class="link-btn danger-link" onClick={() => setDialog('remove')}>
          Remove account…
        </button>
      </div>
      <Show when={dialog() === 'export'}>
        <ExportDialog account={props.account} onClose={() => setDialog(null)} />
      </Show>
      <Show when={dialog() === 'remove'}>
        <RemoveDialog account={props.account} onClose={() => setDialog(null)} onExport={() => setDialog('export')} />
      </Show>
    </>
  );
}
