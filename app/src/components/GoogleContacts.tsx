import { createSignal, Show } from 'solid-js';
import { api, errorMessage, type Account } from '../api';
import { reloadCards } from '../lib/addressBook';
import { googleLink, googleReady, googleStatus, reloadGoogleStatus, syncGoogle } from '../lib/googleContacts';
import { confirmDialog } from './Actions';

// Settings › Accounts › Google Contacts: connect a Gmail (or Workspace) account's contacts to
// the address book. Needs an OAuth client of the user's own the first time (docs/GOOGLE.md), the
// same one that signs in to Gmail (`GoogleClientForm`, also in the add-account form).

const ago = (t: number) => {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString();
};

/** The user's own Google OAuth client, asked for the first time it's needed. Not a <form>: it
 *  also sits inside the add-account form (Enter in a field saves it). */
export function GoogleClientForm(props: { onDone: () => void; onCancel?: () => void }) {
  const [id, setId] = createSignal('');
  const [secret, setSecret] = createSignal('');
  const [msg, setMsg] = createSignal<string | null>(null);
  const save = async (e: Event) => {
    e.preventDefault();
    if (!id().trim()) return;
    try {
      await api.setGoogleClient(id().trim(), secret().trim());
      await reloadGoogleStatus();
      props.onDone();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  };
  return (
    <div class="gc-client" onKeyDown={(e) => e.key === 'Enter' && e.target instanceof HTMLInputElement && void save(e)}>
      <p class="st-muted">
        For now, Google lets this app sign in to your mail or contacts only through an OAuth client of your own (free,
        made once in Google Cloud Console: a <b>Desktop app</b> client). One client serves all your Google accounts.{' '}
        <a href="https://github.com/rickhall/email/blob/main/docs/GOOGLE.md" target="_blank" rel="noreferrer">
          How to make one
        </a>
      </p>
      <input class="st-input" type="text" placeholder="Client ID (…apps.googleusercontent.com)" aria-label="Google client ID" spellcheck={false} value={id()} onInput={(e) => setId(e.currentTarget.value)} />
      <input class="st-input" type="password" placeholder="Client secret" aria-label="Google client secret" autocomplete="off" value={secret()} onInput={(e) => setSecret(e.currentTarget.value)} />
      <span class="gc-actions">
        <button class="btn primary" type="button" onClick={(e) => void save(e)} disabled={!id().trim()}>
          Save client
        </button>
        <Show when={props.onCancel}>
          <button class="btn secondary" type="button" onClick={() => props.onCancel?.()}>
            Cancel
          </button>
        </Show>
      </span>
      <Show when={msg()}>
        <span class="st-status error">{msg()}</span>
      </Show>
    </div>
  );
}

/** The account card's Google Contacts row (Gmail accounts). */
export function GoogleContactsField(props: { account: Account }) {
  const [busy, setBusy] = createSignal<string | null>(null);
  const [msg, setMsg] = createSignal<string | null>(null);
  const [askClient, setAskClient] = createSignal(false);
  if (!googleStatus()) void reloadGoogleStatus();
  const link = () => googleLink(props.account.id);

  async function connect() {
    if (!googleReady()) {
      setAskClient(true);
      return;
    }
    setBusy('Waiting for the sign-in in your browser…');
    setMsg(null);
    try {
      const email = await api.googleConnect(props.account.id);
      await reloadCards();
      await reloadGoogleStatus();
      if (email.toLowerCase() !== props.account.email.toLowerCase()) setMsg(`Connected as ${email}, not ${props.account.email}.`);
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  async function disconnect() {
    const l = link();
    if (!l) return;
    const ok = await confirmDialog(
      `Stop syncing ${l.googleEmail}'s contacts? Its ${l.count} contacts leave this address book; nothing changes in Google.`,
      'Disconnect',
    );
    if (!ok) return;
    await api.googleDisconnect(props.account.id).catch((e) => setMsg(errorMessage(e)));
    await reloadCards();
    await reloadGoogleStatus();
  }
  async function syncNow() {
    setBusy('Syncing…');
    setMsg(null);
    await syncGoogle(props.account.id);
    setBusy(null);
  }

  return (
    <div class="gc">
      <Show
        when={link()}
        fallback={
          <Show
            when={!askClient()}
            fallback={
              <GoogleClientForm
                onDone={() => {
                  setAskClient(false);
                  void connect();
                }}
                onCancel={() => setAskClient(false)}
              />
            }
          >
            <span class="gc-line">
              <span class="st-muted">Not connected</span>
              <button class="link-btn st-field-action" disabled={!!busy()} onClick={() => void connect()}>
                Connect…
              </button>
            </span>
          </Show>
        }
      >
        {(l) => (
          <span class="gc-linked">
            <span class="gc-line">
            <span class="st-oneline">
              {l().count} {l().count === 1 ? 'contact' : 'contacts'}
              <Show when={l().googleEmail.toLowerCase() !== props.account.email.toLowerCase()}> of {l().googleEmail}</Show>
              <Show when={l().synced && !l().error}>
                <span class="st-muted"> · synced {ago(l().synced!)}</span>
              </Show>
            </span>
            <span class="gc-actions st-field-action">
              <Show
                when={/connect again/i.test(l().error ?? '')}
                fallback={
                  <button class="link-btn" disabled={!!busy()} onClick={() => void syncNow()}>
                    Sync now
                  </button>
                }
              >
                <button class="link-btn" disabled={!!busy()} onClick={() => void connect()}>
                  Connect again…
                </button>
              </Show>
              <button class="link-btn" disabled={!!busy()} onClick={() => void disconnect()}>
                Disconnect
              </button>
            </span>
            </span>
            <Show when={l().error}>
              <span class="st-status error gc-error">{l().error}</span>
            </Show>
          </span>
        )}
      </Show>
      <Show when={busy()}>
        <span class="st-muted gc-busy">
          {busy()}
          <Show when={busy()!.startsWith('Waiting')}>
            {' '}
            <button class="link-btn" onClick={() => void api.cancelSignIn()}>
              Cancel
            </button>
          </Show>
        </span>
      </Show>
      <Show when={msg()}>
        <span class="st-status error">{msg()}</span>
      </Show>
    </div>
  );
}

/** The user's own Google client, to forget it (Settings › Accounts, under the accounts). */
export function GoogleClientNote() {
  if (!googleStatus()) void reloadGoogleStatus();
  const forget = async () => {
    if (
      !(await confirmDialog(
        `Forget your Google OAuth client? Accounts and contacts signed in with it keep working; new sign-ins use ${
          googleStatus()?.builtIn ? "the app's own client" : 'a client you add again'
        }.`,
        'Forget',
      ))
    )
      return;
    await api.setGoogleClient(null, null);
    await reloadGoogleStatus();
  };
  return (
    <Show when={googleStatus()?.clientId}>
      {(id) => (
        <p class="st-muted gc-client-note">
          Google sign-in uses your OAuth client {id().split('-')[0]}…{googleStatus()?.builtIn ? " instead of the app's" : ''}{' '}
          <button class="link-btn" onClick={() => void forget()}>
            Forget it
          </button>
        </p>
      )}
    </Show>
  );
}
