import { createSignal, Show } from 'solid-js';
import { api, errorMessage, type Account } from '../api';
import { reloadAccounts } from '../state';
import { googleReady, googleStatus, reloadGoogleStatus } from '../lib/googleContacts';
import { GoogleClientForm } from './GoogleContacts';

// Settings › Accounts › Server: how an account signs in, for one that signs in in the browser
// (Microsoft, Google): which, and signing in again. A Gmail account on an app password can switch
// to signing in with Google here (`SwitchToGoogle`); the password row stays as it was.

/** "Google · Sign in again…" (or "Microsoft · …"), with the browser sign-in under way. */
export function BrowserSignIn(props: { account: Account; onMessage: (m: { text: string; error?: boolean } | null) => void }) {
  const [busy, setBusy] = createSignal(false);
  const who = () => (props.account.auth === 'google' ? 'Google' : 'Microsoft');
  const signIn = async () => {
    setBusy(true);
    props.onMessage(null);
    try {
      await (props.account.auth === 'google' ? api.googleSignIn(props.account.id) : api.microsoftSignInAgain(props.account.id));
      props.onMessage({ text: 'Signed in; reconnecting.' });
    } catch (err) {
      props.onMessage({ text: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span class="st-signin">
      With {who()}
      <span class="dot-sep">·</span>
      <Show
        when={busy()}
        fallback={
          <button class="link-btn" onClick={() => void signIn()}>
            Sign in again…
          </button>
        }
      >
        <span class="st-muted">Finish in your browser…</span>
        <button class="link-btn" onClick={() => void api.cancelSignIn()}>
          Cancel
        </button>
      </Show>
    </span>
  );
}

/** A Gmail account on an app password: sign in with Google instead (asks for the user's own
 *  Google client first, in a build without the app's when there isn't one yet). */
export function SwitchToGoogle(props: { account: Account; onMessage: (m: { text: string; error?: boolean } | null) => void }) {
  const [busy, setBusy] = createSignal(false);
  const [askClient, setAskClient] = createSignal(false);
  const signIn = async () => {
    setAskClient(false);
    setBusy(true);
    props.onMessage(null);
    try {
      await api.googleSignIn(props.account.id);
      await reloadAccounts();
      props.onMessage({ text: 'Signed in with Google; the app password is no longer used.' });
    } catch (err) {
      props.onMessage({ text: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    const s = googleStatus() ?? (await reloadGoogleStatus());
    if (googleReady(s)) void signIn();
    else setAskClient(true);
  };
  return (
    <>
      <span class="dot-sep">·</span>
      <Show
        when={busy()}
        fallback={
          <button class="link-btn" onClick={() => void start()}>
            Sign in with Google instead…
          </button>
        }
      >
        <span class="st-muted">Finish in your browser…</span>
        <button class="link-btn" onClick={() => void api.cancelSignIn()}>
          Cancel
        </button>
      </Show>
      <Show when={askClient()}>
        <GoogleClientForm onDone={() => void signIn()} onCancel={() => setAskClient(false)} />
      </Show>
    </>
  );
}
