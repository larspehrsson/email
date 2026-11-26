import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { api, errorMessage, type Account, type Provider } from '../api';
import { AlertIcon, ChevronIcon, CloseIcon, MailIcon } from './Icons';
import { DRAG } from '../lib/platform';
import { googleReady, reloadGoogleStatus } from '../lib/googleContacts';
import { GoogleClientForm } from './GoogleContacts';

function isGmail(email: string) {
  const d = email.split('@')[1]?.trim().toLowerCase() ?? '';
  return d === 'gmail.com' || d === 'googlemail.com';
}

export function AddAccountForm(props: { onAdded: (a: Account) => void; onCancel?: () => void; autofocus?: boolean }) {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [host, setHost] = createSignal('');
  const [port, setPort] = createSignal('');
  const [advanced, setAdvanced] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  /** Whose service the address is on (asked a moment after typing stops). */
  const [provider, setProvider] = createSignal<Provider | null>(null);
  let detectTimer: ReturnType<typeof setTimeout> | undefined;
  let detectSeq = 0;
  onCleanup(() => clearTimeout(detectTimer));
  const onEmail = (v: string) => {
    setEmail(v);
    clearTimeout(detectTimer);
    const seq = ++detectSeq;
    const addr = v.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(addr)) {
      setProvider(null);
      return;
    }
    detectTimer = setTimeout(() => {
      api.detectProvider(addr).then(
        (p) => {
          if (seq !== detectSeq) return;
          // Detection lands after a pause, often once Tab has moved on to the password field:
          // if that field gives way to the Microsoft note, the cursor goes on to the next field.
          const inPassword = passwordEl != null && document.activeElement === passwordEl;
          setProvider(p);
          if (inPassword && browser()) displayNameEl.focus();
        },
        () => {},
      );
    }, 400);
  };
  let passwordEl: HTMLInputElement | undefined;
  let displayNameEl!: HTMLInputElement;
  /** Microsoft accounts sign in on Microsoft's page (unless a server is set by hand). */
  const microsoft = () => provider() === 'outlook' && !host().trim();
  /** Gmail and Google Workspace (by its MX records) can sign in on Google's page instead of with
   *  an app password: with the app's own Google client (release builds), else the user's, so
   *  in a build without the app's that's the way only once the user has one, unless they ask. */
  const gmail = () => (provider() === 'gmail' || isGmail(email())) && !host().trim();
  const [viaGoogle, setViaGoogle] = createSignal<boolean | null>(null);
  const hasClient = () => googleReady();
  const google = () => gmail() && (viaGoogle() ?? hasClient());
  /** signing in in the browser */
  const browser = () => microsoft() || google();
  onMount(() => void reloadGoogleStatus());

  const portNum = () => {
    const p = port().trim();
    if (!p) return null;
    const n = Number(p);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : NaN;
  };
  const canSubmit = () =>
    !busy() &&
    email().includes('@') &&
    (microsoft() || (google() ? hasClient() : password().length > 0)) &&
    !Number.isNaN(portNum());

  async function submit(e: Event) {
    e.preventDefault();
    if (!canSubmit()) return;
    setBusy(true);
    setError(null);
    try {
      if (microsoft()) {
        props.onAdded(await api.addMicrosoftAccount(email().trim(), displayName().trim() || null));
        return;
      }
      if (google()) {
        props.onAdded(await api.addGoogleAccount(email().trim(), displayName().trim() || null));
        return;
      }
      const acc = await api.addAccount({
        email: email().trim(),
        password: password(),
        displayName: displayName().trim() || null,
        imapHost: host().trim() || null,
        imapPort: portNum(),
      });
      props.onAdded(acc);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="form" onSubmit={submit} novalidate>
      <label class="field">
        <span class="field-label">Email</span>
        <input
          type="email"
          autocomplete="username"
          placeholder="you@example.com"
          value={email()}
          onInput={(e) => onEmail(e.currentTarget.value)}
          ref={(el) => props.autofocus && queueMicrotask(() => el.focus())}
          required
        />
      </label>
      {/* Microsoft, Google: the same slot says where the sign-in happens */}
      <Show
        when={!browser()}
        fallback={
          <div class="field">
            <span class="field-label">Sign-in</span>
            <Show
              when={google()}
              fallback={<div class="field-note">You’ll sign in on Microsoft’s page, in your browser.</div>}
            >
              <div class="field-note">You’ll sign in on Google’s page, in your browser.</div>
              <span class="field-help">
                <button type="button" class="link-btn" onClick={() => setViaGoogle(false)}>
                  Use an app password instead
                </button>
              </span>
              <Show when={!hasClient()}>
                <GoogleClientForm onDone={() => undefined} />
              </Show>
            </Show>
          </div>
        }
      >
        <label class="field">
          <span class="field-label">Password</span>
          <input
            ref={passwordEl}
            type="password"
            autocomplete="current-password"
            placeholder={gmail() ? 'App password' : 'Password'}
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            required
          />
          <Show when={gmail()}>
            <span class="field-help">
              Gmail needs an app password. Create one at{' '}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
                myaccount.google.com/apppasswords
              </a>
              , or{' '}
              <button type="button" class="link-btn" onClick={() => setViaGoogle(true)}>
                sign in with Google
              </button>
              .
            </span>
          </Show>
        </label>
      </Show>
      <label class="field">
        <span class="field-label">
          Display name <span class="optional">optional</span>
        </span>
        <input
          ref={displayNameEl}
          type="text"
          autocomplete="name"
          placeholder="Jane Appleseed"
          value={displayName()}
          onInput={(e) => setDisplayName(e.currentTarget.value)}
        />
      </label>

      <button type="button" class="advanced-toggle" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced()}>
        <span class="disclosure" classList={{ open: advanced() }}>
          <ChevronIcon size={12} />
        </span>
        Advanced
      </button>
      <Show when={advanced()}>
        <div class="field-row">
          <label class="field grow">
            <span class="field-label">IMAP host</span>
            <input
              type="text"
              placeholder="imap.example.com"
              autocapitalize="off"
              spellcheck={false}
              value={host()}
              onInput={(e) => setHost(e.currentTarget.value)}
            />
          </label>
          <label class="field port">
            <span class="field-label">Port</span>
            <input
              type="text"
              inputmode="numeric"
              placeholder="993"
              value={port()}
              classList={{ invalid: Number.isNaN(portNum()) }}
              onInput={(e) => setPort(e.currentTarget.value)}
            />
          </label>
        </div>
      </Show>

      <Show when={error()}>
        <div class="form-error" role="alert">
          <AlertIcon size={14} />
          <span>{error()}</span>
        </div>
      </Show>

      <div class="form-actions">
        {/* while the browser sign-in is open, Cancel stops waiting for it */}
        <Show when={props.onCancel || (busy() && browser())}>
          <button
            type="button"
            class="btn secondary"
            onClick={() => (busy() && browser() ? void api.cancelSignIn() : props.onCancel?.())}
            disabled={busy() && !browser()}
          >
            Cancel
          </button>
        </Show>
        <button type="submit" class="btn primary" disabled={!canSubmit()}>
          <Show when={busy()} fallback={microsoft() ? 'Continue with Microsoft' : google() ? 'Continue with Google' : 'Add Account'}>
            <span class="spinner small on-accent" /> {browser() ? 'Finish in your browser…' : 'Connecting…'}
          </Show>
        </button>
      </div>
    </form>
  );
}

export function Onboarding(props: { onAdded: (a: Account) => void }) {
  return (
    <div class="onboarding" data-tauri-drag-region={DRAG}>
      <div class="card">
        <div class="card-hero">
          <div class="hero-icon">
            <MailIcon size={28} />
          </div>
          <h1>Welcome to Email</h1>
          <p>Add your email account to get started. Your mail is synced and stored on this device.</p>
        </div>
        <AddAccountForm onAdded={props.onAdded} autofocus />
      </div>
    </div>
  );
}

export function AddAccountModal(props: { onAdded: (a: Account) => void; onClose: () => void }) {
  return (
    <div
      class="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
      onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
    >
      <div class="card modal" role="dialog" aria-modal="true" aria-label="Add account">
        <div class="modal-head">
          <h2>Add Account</h2>
          <button class="icon-btn" onClick={props.onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <AddAccountForm onAdded={props.onAdded} onCancel={props.onClose} autofocus />
      </div>
    </div>
  );
}
