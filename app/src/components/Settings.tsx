import { createEffect, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { AiAppsSection } from './AiApps';
import { GoogleClientNote, GoogleContactsField } from './GoogleContacts';
import { BrowserSignIn, SwitchToGoogle } from './AccountSignIn';
import { pictureLevel, setPictureLevel, type PictureLevel } from '../lib/senderIcons';
import { attachmentSearch, domainRules, httpPictures, setAttachmentSearch, setDomainRules, setHttpPictures } from '../lib/privacy';
import { setTheme, theme, THEMES } from '../lib/theme';
import { pinFavorites, setPinFavorites } from '../lib/favorites';
import { accountLogo, logoFromFile, setAccountLogo } from '../lib/accountLogos';
import {
  bindKey,
  COMMANDS,
  isDefault,
  keysOf,
  label,
  MOD,
  preset,
  presetName,
  PRESETS,
  recordKey,
  resetKeys,
  setPreset,
  unbindKey,
  type Command,
} from '../lib/shortcuts';
import { ChevronIcon, CloseIcon } from './Icons';
import { api, errorMessage, events, type Account, type AccountDetails, type AccountStorage, type AttachmentCounts } from '../api';
import { accountMark, accounts, notifyDetails, notifyInUse, notifyNewMail, reloadAccounts, setAddingAccount, setNotifyDetails, setNotifyInUse, setNotifyNewMail, folderById, selectedFolderId } from '../state';
import { MARK_COLORS } from '../lib/accountMarks';
import { AccountTools } from './AccountTools';
import { fmtNum, fmtSize, loadPref, savePref, smartDate } from '../lib/format';
import { AccountDot } from './FolderSwitcher';
import { SignaturesSection } from './SignatureSettings';
import { SendAsGroup } from './SendAs';
import { autoUpdates, checkForUpdate, restartToUpdate, setAutoUpdates, updateStatus } from '../lib/updates';
import { AiSection } from './AiSettings';
import { platform } from '../lib/platform';
import { Modal } from './Modal';

// Settings: sections on the left, the chosen one on the right (each with its own heading,
// scrolling and buttons). Fixed size, so switching sections never moves the dialog.

export type SettingsSection = 'general' | 'accounts' | 'signatures' | 'ai' | 'aiapps' | 'notifications' | 'keyboard' | 'troubleshooting';
const SECTIONS: { id: SettingsSection; title: string }[] = [
  { id: 'general', title: 'General' },
  { id: 'accounts', title: 'Accounts' },
  { id: 'signatures', title: 'Signatures' },
  { id: 'ai', title: 'AI' },
  { id: 'aiapps', title: 'AI apps' },
  { id: 'notifications', title: 'Notifications' },
  { id: 'keyboard', title: 'Keyboard' },
  { id: 'troubleshooting', title: 'Troubleshooting' },
];

const [open, setOpen] = createSignal(false);
const [section, setSectionSig] = createSignal<SettingsSection>(loadPref<SettingsSection>('ui.settingsSection', 'accounts'));
const setSection = (s: SettingsSection) => {
  setSectionSig(s);
  savePref('ui.settingsSection', s);
};
let returnFocus: HTMLElement | null = null;
/** Settings › Accounts: the account whose page is shown (each has one, listed under Accounts
 *  in the sidebar); null: the list of them. Opening Settings starts at the account viewed. */
const [accountPage, setAccountPage] = createSignal<number | null>(null);

/** Open Settings (at `at`, else where it was last). */
export function openSettings(at?: SettingsSection): void {
  if (at) setSection(at);
  if (open()) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setAccountPage(folderById(selectedFolderId())?.accountId ?? (accounts()?.length === 1 ? accounts()![0]!.id : null));
  setOpen(true);
}
function close() {
  setPresetMenu(false);
  setRecording(null);
  setStatus(null);
  setOpen(false);
  queueMicrotask(() => returnFocus?.focus({ preventScroll: true }));
}

// ------------------------------------------------------------- keyboard

/** Commands whose keys are part of something else (tag positions, popups, attachment list). */
const LOCKED = new Set(['tag-n', 'tag-clear', 'escape', 'search-help', 'search-clear', 'att-open', 'att-save', 'att-save-all']);

const descOf = (id: string) => COMMANDS.flatMap((s) => s.items).find((c) => c.id === id)?.desc ?? id;

/** Command waiting for a key press. */
const [recording, setRecording] = createSignal<string | null>(null);
/** One line under the shortcut list: what the last change did, or why a key was refused. */
const [status, setStatus] = createSignal<{ text: string; error?: boolean } | null>(null);

function Keycaps(props: { k: string }) {
  return (
    <span class="sc-combo">
      <For each={label(props.k)}>{(cap) => <kbd>{cap}</kbd>}</For>
    </span>
  );
}

/** While recording, the next key press is the new shortcut. Returns true if handled. */
function recordKeyPress(e: KeyboardEvent, refocus: () => void): boolean {
  const id = recording();
  if (!id) return false;
  e.preventDefault();
  if (e.key === 'Escape') {
    setRecording(null);
    setStatus(null);
    return true;
  }
  const r = recordKey(e);
  if (!r) return true; // a modifier on its own: keep waiting
  if (!r.ok) {
    setStatus({ text: r.reason, error: true });
    return true;
  }
  const from = bindKey(id, r.key);
  setRecording(null);
  refocus();
  const keys = label(r.key).join(' ');
  setStatus({ text: from ? `${keys} now does “${descOf(id)}” (removed from “${descOf(from)}”)` : `${keys} added to “${descOf(id)}”` });
  return true;
}

function ShortcutRow(p: { cmd: Command }) {
  const locked = LOCKED.has(p.cmd.id);
  return (
    <div class="st-row" classList={{ recording: recording() === p.cmd.id }}>
      <span class="st-desc">
        {p.cmd.desc}
        {/* beside the name (not in a column of its own): no empty space when unchanged, and
            the keys don't move when it appears */}
        <Show when={!isDefault(p.cmd.id)}>
          <button
            class="link-btn st-default"
            onClick={() => {
              resetKeys(p.cmd.id);
              setStatus({ text: `“${p.cmd.desc}” back to ${presetName()}’s keys` });
            }}
          >
            Default
          </button>
        </Show>
      </span>
      <span class="st-keys">
        <For each={keysOf(p.cmd.id)}>
          {(k) => (
            <span class="st-key">
              <Keycaps k={k} />
              <Show when={!locked}>
                <button
                  class="st-x"
                  aria-label={`Remove ${label(k).join(' ')}`}
                  title="Remove"
                  onClick={() => {
                    unbindKey(p.cmd.id, k);
                    setStatus({ text: `${label(k).join(' ')} removed from “${p.cmd.desc}”` });
                  }}
                >
                  <CloseIcon size={8} />
                </button>
              </Show>
            </span>
          )}
        </For>
        <For each={p.cmd.fixed ?? []}>
          {(k) => (
            <span class="st-key fixed" title="Fixed">
              <Keycaps k={k} />
            </span>
          )}
        </For>
        <Show when={!locked}>
          <Show
            when={recording() === p.cmd.id}
            fallback={
              <button
                class="st-add"
                title="Add a key"
                aria-label={`Add a key for ${p.cmd.desc}`}
                onClick={() => {
                  setRecording(p.cmd.id);
                  setStatus({ text: `Press a key for “${p.cmd.desc}” · Esc to cancel` });
                }}
              >
                +
              </button>
            }
          >
            <span class="st-listen">Press a key…</span>
          </Show>
        </Show>
      </span>
    </div>
  );
}

/** The footer's "Restore defaults" menu: which client's keys to start over from. */
const [presetMenu, setPresetMenu] = createSignal(false);

/** The search over the shortcut list: words that must all be in a command's name, its
 *  section's or its keys (as shown: "⌘ K", "Shift"). */
const [keySearch, setKeySearch] = createSignal('');
const keyWords = () => keySearch().toLowerCase().split(/\s+/).filter(Boolean);
function keyMatches(sec: { title: string }, cmd: Command): boolean {
  const words = keyWords();
  if (!words.length) return true;
  const hay = [cmd.desc, sec.title, ...keysOf(cmd.id).flatMap((k) => label(k))].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

function KeyboardSection() {
  let menuEl: HTMLDivElement | undefined;
  createEffect(() => {
    if (!presetMenu()) return;
    const onDown = (e: MouseEvent) => {
      if (!menuEl?.contains(e.target as Node)) setPresetMenu(false);
    };
    document.addEventListener('mousedown', onDown, true);
    onCleanup(() => document.removeEventListener('mousedown', onDown, true));
  });
  return (
    <>
      <div class="st-body st-keys-body">
        <p class="st-note">
          Based on {presetName()}’s keys. Click + to add a key (on its own or with {MOD}) and × to remove one.
          Dimmed keys are fixed.
        </p>
        <input
          class="st-input st-keys-search"
          type="search"
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
          value={keySearch()}
          // (Esc empties it first, then closes Settings: Settings' own key handler.)
          onInput={(e) => setKeySearch(e.currentTarget.value)}
        />
        <For each={COMMANDS}>
          {(sec) => (
            <Show when={sec.items.some((c) => keyMatches(sec, c))}>
              <section class="st-section">
                <h4>{sec.title}</h4>
                <For each={sec.items.filter((c) => keyMatches(sec, c))}>{(cmd) => <ShortcutRow cmd={cmd} />}</For>
              </section>
            </Show>
          )}
        </For>
        <Show when={!COMMANDS.some((sec) => sec.items.some((c) => keyMatches(sec, c)))}>
          <p class="st-muted">No shortcuts match “{keySearch().trim()}”.</p>
        </Show>
      </div>
      <div class="st-foot">
        <span class="st-status" classList={{ error: !!status()?.error }} aria-live="polite">
          {status()?.text ?? ''}
        </span>
        <div class="st-restore" ref={menuEl}>
          <button
            class="btn secondary"
            aria-haspopup="menu"
            aria-expanded={presetMenu()}
            onClick={() => setPresetMenu((v) => !v)}
          >
            Restore defaults
            <ChevronIcon size={11} />
          </button>
          <Show when={presetMenu()}>
            <div class="view-menu st-restore-menu" role="menu" aria-label="Restore defaults">
              <div class="vm-section">Start over with</div>
              <For each={PRESETS}>
                {(p) => (
                  <button
                    role="menuitemradio"
                    aria-checked={preset() === p.id}
                    class="vm-item"
                    onClick={() => {
                      setPreset(p.id);
                      resetKeys();
                      setRecording(null);
                      setPresetMenu(false);
                      setStatus({ text: `All shortcuts set to ${p.name}’s keys` });
                    }}
                  >
                    <span class="vm-check" classList={{ on: preset() === p.id, radio: true }} aria-hidden="true">
                      <Show when={preset() === p.id}>
                        <span class="vm-dot" />
                      </Show>
                    </span>
                    <span class="vm-label">{p.name}’s keys</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------- accounts

const PROVIDER: Record<string, string> = { gmail: 'Gmail', outlook: 'Outlook', imap: 'IMAP' };

/** The account's marker: a letter and a colour, each automatic unless set; saved as changed. */
/** The marker's color: one swatch, the chosen color, that opens a panel of the others. */
function MarkColor(props: { account: Account; onPick: (color: string | null) => void }) {
  const [open, setOpen] = createSignal(false);
  const [at, setAt] = createSignal({ top: 0, left: 0 });
  let btn!: HTMLButtonElement;
  let panel: HTMLDivElement | undefined;
  const mark = () => accountMark(props.account);
  const chosen = () => MARK_COLORS.find((c) => c.name === props.account.markColor);
  const colorOf = (c: (typeof MARK_COLORS)[number]) => `hsl(${c.hue} ${c.sat}% 52%)`;
  const toggle = () => {
    const r = btn.getBoundingClientRect();
    setAt({ top: r.bottom + 6, left: r.left });
    setOpen((v) => !v);
  };
  const choose = (color: string | null) => {
    setOpen(false);
    props.onPick(color);
    btn.focus();
  };
  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => panel?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel?.contains(t) && !btn.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the panel closes, not Settings.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.focus();
    };
    const close = () => setOpen(false);
    // A scroll closes it only if it moved the button away from the panel: a scroll reported
    // late, from before it opened, leaves it be.
    const onScroll = () => {
      const r = btn.getBoundingClientRect();
      if (Math.abs(r.bottom + 6 - at().top) > 1 || Math.abs(r.left - at().left) > 1) setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', onScroll, true);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', onScroll, true);
    });
  });
  return (
    <>
      <button
        ref={btn}
        type="button"
        class="st-color-btn"
        aria-haspopup="true"
        aria-expanded={open()}
        aria-label={`Marker color: ${chosen()?.label ?? 'Automatic'}`}
        title={`Marker color: ${chosen()?.label ?? 'Automatic'}`}
        onClick={toggle}
      >
        <span class="st-swatch big" classList={{ auto: !chosen() }} style={{ background: chosen() ? colorOf(chosen()!) : mark().autoColor }}>
          {chosen() ? '' : 'A'}
        </span>
        <ChevronIcon size={10} />
      </button>
      <Show when={open()}>
        <Portal>
          <div ref={panel} class="st-color-panel" style={{ top: `${at().top}px`, left: `${at().left}px` }} role="radiogroup" aria-label="Marker color">
            <button
              class="st-swatch auto"
              role="radio"
              aria-checked={!props.account.markColor}
              title="Automatic: a color unlike the other accounts'"
              aria-label="Automatic"
              style={{ background: mark().autoColor }}
              onClick={() => choose(null)}
            >
              A
            </button>
            <For each={MARK_COLORS}>
              {(c) => (
                <button
                  class="st-swatch"
                  role="radio"
                  aria-checked={props.account.markColor === c.name}
                  title={c.label}
                  aria-label={c.label}
                  style={{ background: colorOf(c) }}
                  onClick={() => choose(c.name)}
                />
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}

function MarkField(props: { account: Account; onError: (text: string) => void }) {
  const mark = () => accountMark(props.account);
  const save = async (letter: string | null, color: string | null) => {
    try {
      await api.setAccountMark(props.account.id, letter, color);
      await reloadAccounts();
    } catch (err) {
      props.onError(errorMessage(err));
    }
  };
  const pick = (color: string | null) => void save(props.account.markLetter, color);
  let picInput!: HTMLInputElement;
  return (
    <Field label="Marker">
      <input
        class="st-input st-mark-letter"
        type="text"
        maxLength={1}
        spellcheck={false}
        aria-label="Marker letter (empty: automatic)"
        title="The marker's letter; leave empty for the automatic one"
        placeholder={mark().autoLetter}
        value={props.account.markLetter ?? ''}
        onInput={(e) => {
          const el = e.currentTarget;
          const l = [...el.value.trim()].pop()?.toUpperCase() ?? '';
          el.value = l;
          void save(l || null, props.account.markColor);
        }}
      />
      <MarkColor account={props.account} onPick={pick} />
      {/* or a picture of its own, in the same marker */}
      <span class="st-mark-pic st-field-action">
        <Show when={accountLogo(props.account.id)}>
          <AccountDot account={props.account} size={22} />
        </Show>
        <button class="link-btn" onClick={() => picInput.click()}>
          {accountLogo(props.account.id) ? 'Change picture…' : 'Use a picture…'}
        </button>
        <Show when={accountLogo(props.account.id)}>
          <button class="link-btn" onClick={() => void setAccountLogo(props.account.id, null).catch((e) => props.onError(errorMessage(e)))}>
            Remove
          </button>
        </Show>
        <input
          ref={picInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          hidden
          aria-label={`Picture for ${props.account.email}`}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (!f) return;
            void logoFromFile(f)
              .then((url) => setAccountLogo(props.account.id, url))
              .catch((err) => props.onError(errorMessage(err)));
          }}
        />
      </span>
    </Field>
  );
}

/** Microsoft accounts: tags and snooze through Microsoft Graph (Exchange keeps no keywords). */
function GraphField(props: { account: Account; onMessage: (m: { text: string; error?: boolean } | null) => void }) {
  const [waiting, setWaiting] = createSignal(false);
  const turnOn = async () => {
    props.onMessage(null);
    setWaiting(true);
    try {
      await api.enableGraph(props.account.id);
      await reloadAccounts();
      props.onMessage({ text: 'Tags and snooze are on: tags show as Outlook categories.' });
    } catch (err) {
      props.onMessage({ text: errorMessage(err), error: true });
    } finally {
      setWaiting(false);
    }
  };
  const turnOff = async () => {
    props.onMessage(null);
    try {
      await api.disableGraph(props.account.id);
      await reloadAccounts();
    } catch (err) {
      props.onMessage({ text: errorMessage(err), error: true });
    }
  };
  return (
    <Field label="Tags & snooze">
      <Show
        when={props.account.graph}
        fallback={
          <>
            <span class="st-muted" title="Outlook doesn't keep other programs' tags over IMAP; with your permission they go through Microsoft Graph instead. A work account may need your administrator's approval.">
              {waiting() ? 'Waiting for Microsoft’s sign-in page…' : 'Off: Outlook needs your permission'}
            </span>
            <Show
              when={!waiting()}
              fallback={
                <button class="link-btn st-field-action" onClick={() => void api.cancelSignIn()}>
                  Cancel
                </button>
              }
            >
              <button class="link-btn st-field-action" onClick={() => void turnOn()}>
                Turn on…
              </button>
            </Show>
          </>
        }
      >
        <span>On, as Outlook categories</span>
        <button class="link-btn st-field-action" onClick={() => void turnOff()}>
          Turn off
        </button>
      </Show>
    </Field>
  );
}

/** A checkbox with a line under it saying what it means. */
function Choice(props: { checked: boolean; onChange: (on: boolean) => void; label: string; note: string }) {
  return (
    <label class="st-level">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span>
        {props.label}
        <span class="st-level-note">{props.note}</span>
      </span>
    </label>
  );
}

function Field(props: { label: string; class?: string; children: JSX.Element }) {
  return (
    <div class={props.class ? `st-field ${props.class}` : 'st-field'}>
      <span class="st-field-label">{props.label}</span>
      <span class="st-field-value">{props.children}</span>
    </div>
  );
}

// Space per account: counted the first time Settings › Accounts is shown in a session (seconds
// on a cold disk, so in the background), kept for the session, recounted on request.
const [storage, setStorage] = createSignal<AccountStorage[] | null>(null);
const [counting, setCounting] = createSignal(false);
const [storageError, setStorageError] = createSignal(false);
function countStorage() {
  if (counting()) return;
  setCounting(true);
  setStorageError(false);
  api
    .accountStorage()
    .then(setStorage, () => setStorageError(true))
    .finally(() => setCounting(false));
}

// Messages with attachments per account, counted when Settings › Accounts opens and again as
// downloads progress (at most once a second while it's open).
const [attachmentCounts, setAttachmentCounts] = createSignal<AttachmentCounts[] | null>(null);
function recountAttachments() {
  api.attachmentCounts().then(setAttachmentCounts, (e) => console.warn('attachment_counts', e));
}
let recountTimer: ReturnType<typeof setTimeout> | undefined;
function recountSoon() {
  if (recountTimer) return;
  recountTimer = setTimeout(() => {
    recountTimer = undefined;
    recountAttachments();
  }, 1000);
}

/** An account's page in Settings › Accounts: who you are (marker, addresses), how it connects,
 *  what's kept on this computer, what it's connected to; Export and Remove at the foot. */
function AccountPage(props: { d: AccountDetails }) {
  const stored = () => storage()?.find((s) => s.accountId === props.d.id);
  const [keep, setKeep] = createSignal(props.d.keepAttachments);
  const counts = () => attachmentCounts()?.find((x) => x.accountId === props.d.id);
  const [removing, setRemoving] = createSignal(false);
  /** After "Keep attachments", in brackets: what keeping costs, what's coming down, or what's
   *  here; nothing while counting or when no message has attachments. */
  const offlineSize = () => {
    const c = counts();
    if (!c) return '';
    if (removing()) return 'removing…';
    if (keep()) return c.missing > 0 ? `downloading ${fmtSize(c.missingBytes)}` : c.kept > 0 ? `${fmtSize(c.keptBytes)} here` : '';
    // Not kept: what's here can be removed (a separate step); otherwise what keeping would cost.
    if (c.kept > 0) return `${fmtSize(c.keptBytes)} here`;
    return c.missing > 0 ? `about ${fmtSize(c.missingBytes)}` : '';
  };
  const remove = () => {
    setRemoving(true);
    setMsg(null);
    api
      .removeAttachments(props.d.id)
      // Done shows in place: the note turns to "Enable to download…" and Storage recounts (no
      // extra line under the card).
      .catch((err) => setMsg({ text: errorMessage(err), error: true }))
      .finally(() => {
        setRemoving(false);
        recountAttachments();
        countStorage();
      });
  };
  const account = () => (accounts() ?? []).find((a) => a.id === props.d.id);
  const [editing, setEditing] = createSignal(false);
  const [pw, setPw] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<{ text: string; error?: boolean } | null>(null);
  const save = async (e: Event) => {
    e.preventDefault();
    if (!pw() || busy()) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.updatePassword(props.d.id, pw());
      setEditing(false);
      setPw('');
      setMsg({ text: 'Password updated; reconnecting.' });
    } catch (err) {
      setMsg({ text: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  };
  // The name mail from the account's own address is sent under (edited in Send as); the
  // address alone is stored as the address itself.
  const [name, setName] = createSignal(props.d.displayName === props.d.email ? '' : props.d.displayName);
  const connected = () => account()?.provider === 'gmail' || account()?.auth === 'microsoft';
  const tabs = () => ACCOUNT_TABS.filter((t) => t.id !== 'connected' || connected());
  // The tab picked last (on any account's page), or the first when this one hasn't it.
  const tab = () => (tabs().some((t) => t.id === accountTab()) ? accountTab() : 'identity');
  let bar!: HTMLDivElement;
  const onTabKey = (e: KeyboardEvent) => {
    const list = tabs();
    const i = list.findIndex((t) => t.id === tab());
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    const next = list[(to + list.length) % list.length]!;
    setAccountTab(next.id);
    bar.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div class="st-acct">
      <div class="st-tabs" role="tablist" aria-label="Account settings" ref={bar} onKeyDown={onTabKey}>
        <For each={tabs()}>
          {(t) => (
            <button
              class="st-tab"
              role="tab"
              data-tab={t.id}
              aria-selected={tab() === t.id}
              tabIndex={tab() === t.id ? 0 : -1}
              classList={{ on: tab() === t.id }}
              onClick={() => setAccountTab(t.id)}
            >
              {t.title}
            </button>
          )}
        </For>
      </div>
      <div class="st-tab-panel" role="tabpanel" aria-label={tabs().find((t) => t.id === tab())?.title}>
        <Switch>
          <Match when={tab() === 'identity'}>
            <Show when={account()}>{(a) => <MarkField account={a()} onError={(text) => setMsg({ text, error: true })} />}</Show>
            <SendAsGroup accountId={props.d.id} email={props.d.email} name={name()} onRename={setName} />
          </Match>
          <Match when={tab() === 'connection'}>
            <Field label="Incoming (IMAP)">
              {props.d.imapHost}:{props.d.imapPort}
            </Field>
            <Field label="Outgoing (SMTP)">
              <Show when={props.d.smtpHost} fallback={<span class="st-muted">not set</span>}>
                {props.d.smtpHost}:{props.d.smtpPort}
              </Show>
            </Field>
            <Show when={account()?.auth !== 'password' ? account() : undefined}>
              {(a) => (
                <Field label="Sign-in">
                  <BrowserSignIn account={a()} onMessage={setMsg} />
                </Field>
              )}
            </Show>
            <Show when={(account()?.auth ?? 'password') === 'password'}>
            <Field label="Password">
              <Show
                when={editing()}
                fallback={
                  <span class="st-signin">
                    <button class="link-btn" onClick={() => (setEditing(true), setMsg(null))}>
                      Update password…
                    </button>
                    <Show when={props.d.provider === 'gmail' ? account() : undefined}>{(a) => <SwitchToGoogle account={a()} onMessage={setMsg} />}</Show>
                  </span>
                }
              >
                <form class="st-pw" onSubmit={save}>
                  <input
                    class="st-input"
                    type="password"
                    placeholder="App password"
                    autocomplete="current-password"
                    value={pw()}
                    ref={(el) => queueMicrotask(() => el.focus())}
                    onInput={(e) => setPw(e.currentTarget.value)}
                  />
                  <button class="btn primary st-pw-save" type="submit" disabled={!pw() || busy()}>
                    Save
                  </button>
                  <button class="btn secondary" type="button" onClick={() => (setEditing(false), setPw(''))}>
                    Cancel
                  </button>
                </form>
              </Show>
            </Field>
            </Show>
          </Match>
          <Match when={tab() === 'computer'}>
            <Field label="Storage">
              {/* the row is there from the start; its text arrives when counted */}
              <span class="st-oneline">
                <Show
                  when={stored()}
                  fallback={<span class="st-muted">{storageError() ? 'Couldn’t count' : 'Counting…'}</span>}
                >
                  {(s) => (
                    <>
                      {fmtNum(s().messages)} {s().messages === 1 ? 'message' : 'messages'} · {fmtSize(s().localBytes)} local
                      <span class="st-muted"> · {fmtSize(s().serverBytes)} on the server</span>
                    </>
                  )}
                </Show>
              </span>
              {/* same label while counting (the old figures stay until the new ones are in) */}
              <button class="link-btn st-field-action" disabled={counting()} onClick={countStorage}>
                Recount
              </button>
            </Field>
            <Field label="Offline">
              <label class="st-check">
                <input
                  type="checkbox"
                  checked={keep()}
                  disabled={removing()}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setKeep(on);
                    api.setKeepAttachments(props.d.id, on).then(recountAttachments, (err) => {
                      setKeep(!on);
                      setMsg({ text: errorMessage(err), error: true });
                    });
                  }}
                />
                Keep attachments on this computer
                <Show when={offlineSize()}>
                  <span class="st-muted">({offlineSize()})</span>
                </Show>
              </label>
              {/* removing is its own step, offered only once attachments aren't kept */}
              <Show when={!keep() && !removing() && (counts()?.kept ?? 0) > 0}>
                <button class="link-btn st-field-action" onClick={remove}>
                  Remove
                </button>
              </Show>
            </Field>
          </Match>
          <Match when={tab() === 'connected'}>
            <Show when={account()?.provider === 'gmail' ? account() : undefined}>
              {(a) => (
                <Field label="Google Contacts">
                  <GoogleContactsField account={a()} />
                </Field>
              )}
            </Show>
            <Show when={account()?.auth === 'microsoft' ? account() : undefined}>
              {(a) => <GraphField account={a()} onMessage={setMsg} />}
            </Show>
          </Match>
        </Switch>
      </div>
      <Show when={msg()}>{(m) => <p class="st-acct-msg" classList={{ error: !!m().error }}>{m().text}</p>}</Show>
      <div class="st-acct-foot">
        <AccountTools account={props.d} />
      </div>
    </div>
  );
}

/** An account page's tabs. */
type AccountTab = 'identity' | 'connection' | 'computer' | 'connected';
const ACCOUNT_TABS: { id: AccountTab; title: string }[] = [
  { id: 'identity', title: 'Identity' },
  { id: 'connection', title: 'Connection' },
  { id: 'computer', title: 'On this computer' },
  // Gmail's and Microsoft's accounts only
  { id: 'connected', title: 'Connected' },
];
/** The tab shown: the same one as you go from account to account. */
const [accountTab, setAccountTab] = createSignal<AccountTab>('identity');

/** What an account holds, for its row in the overview ("" until counted). */
function storedSummary(id: number): string {
  const st = storage()?.find((s) => s.accountId === id);
  return st ? `${fmtNum(st.messages)} ${st.messages === 1 ? 'message' : 'messages'} · ${fmtSize(st.localBytes)} local` : '';
}

function AccountsSection() {
  const [details] = createResource(() => api.accountDetails());
  if (storage() == null) countStorage();
  recountAttachments();
  // Sync progress (bodies coming down) changes the counts: follow it while shown.
  const unlisten = events.onSyncStatus(recountSoon);
  onCleanup(() => {
    clearTimeout(recountTimer);
    recountTimer = undefined;
    void unlisten.then((un) => un());
  });
  // in the user's order (as in the sidebar)
  const ordered = () => {
    const d = details() ?? [];
    return (accounts() ?? []).map((a) => d.find((x) => x.id === a.id)).filter((x): x is AccountDetails => !!x);
  };
  // The chosen account's page; none (or one since removed): the list of them.
  const current = () => ordered().find((d) => d.id === accountPage());
  return (
    <div class="st-body">
      <Show
        when={current()}
        keyed
        fallback={
          <>
            <div class="st-acct-list">
              <For each={ordered()}>
                {(d) => {
                  const account = () => (accounts() ?? []).find((a) => a.id === d.id);
                  return (
                    <button class="st-acct-row" onClick={() => setAccountPage(d.id)}>
                      <Show when={account()}>{(a) => <AccountDot account={a()} size={20} />}</Show>
                      <span class="st-acct-email">{d.email}</span>
                      <span class="st-acct-sum">{storedSummary(d.id)}</span>
                      <span class="st-acct-type">{PROVIDER[d.provider] ?? d.provider}</span>
                      <span class="st-acct-chev" aria-hidden="true">
                        <ChevronIcon size={12} />
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
            <GoogleClientNote />
          </>
        }
      >
        {(d) => <AccountPage d={d} />}
      </Show>
      <Show when={details.error}>
        <p class="st-acct-msg error">{errorMessage(details.error)}</p>
      </Show>
    </div>
  );
}

// ------------------------------------------------------------- troubleshooting

/** Settings › General › Sender pictures: each level, and what it looks up. */
const PICTURE_LEVELS: { id: PictureLevel; label: string; note: string }[] = [
  { id: 'off', label: 'Off', note: 'Initials only.' },
  { id: 'contacts', label: 'Your contacts’ photos', note: 'Your Google contacts’ own photos. No sender’s website is contacted.' },
  {
    id: 'known',
    label: 'And companies you write to',
    note: 'Also the logos of companies where you’ve written to someone, or have someone in your address book, from their own website, once.',
  },
  {
    id: 'all',
    label: 'All senders',
    note: 'Also any sender’s company logo (never for mail in Spam). Looking one up tells that company’s server your mail was shown.',
  },
];

/** A theme in miniature: its sidebar, its page, and a line in its accent. */
function ThemeSwatch(props: { colors: [string, string, string] }) {
  return (
    <span class="st-tp" style={{ background: props.colors[1] }}>
      <span class="st-tp-side" style={{ background: props.colors[0] }} />
      <span class="st-tp-sel" style={{ background: props.colors[2] }} />
    </span>
  );
}

/** A titled part of a settings page, with a line above it after the first. */
function SettingsGroup(props: { title: string; children: JSX.Element }) {
  return (
    <section class="st-sect">
      <h4 class="st-sect-title">{props.title}</h4>
      {props.children}
    </section>
  );
}

function GeneralSection() {
  const [status, { refetch }] = createResource(() => api.defaultMailStatus().catch(() => null));
  const [msg, setMsg] = createSignal<string | null>(null);
  const make = async () => {
    setMsg(null);
    try {
      await api.makeDefaultMail();
    } catch (e) {
      setMsg(errorMessage(e));
    }
    await refetch();
  };
  // Starting at login: asked of the system each time the page opens.
  const [atLogin, { mutate: setAtLogin }] = createResource(() => api.startAtLogin().catch(() => false));
  const [loginMsg, setLoginMsg] = createSignal<string | null>(null);
  const changeAtLogin = async (on: boolean) => {
    setLoginMsg(null);
    setAtLogin(on);
    try {
      await api.setStartAtLogin(on);
    } catch (e) {
      setAtLogin(!on);
      setLoginMsg(errorMessage(e));
    }
  };
  return (
    <div class="st-body">
      <SettingsGroup title="Startup">
        <Field label="At login" class="st-field-top">
          <Choice
            checked={!!atLogin()}
            onChange={(on) => void changeAtLogin(on)}
            label="Open Email when you log in"
            note={
              platform === 'macos'
                ? 'It starts out of sight, in the Dock: mail comes in and notifications show as usual.'
                : 'Mail comes in and notifications show from the start.'
            }
          />
        </Field>
        <Show when={loginMsg()}>
          <Field label="">
            <span class="st-status error">{loginMsg()}</span>
          </Field>
        </Show>
      </SettingsGroup>
      <SettingsGroup title="Appearance">
        <div class="st-field st-field-top">
          <span class="st-field-label">Theme</span>
          <div class="st-themes" role="radiogroup" aria-label="Theme">
            <For each={THEMES}>
              {(t) => (
                <button
                  type="button"
                  role="radio"
                  class="st-theme"
                  classList={{ on: theme() === t.id }}
                  aria-checked={theme() === t.id}
                  onClick={() => setTheme(t.id)}
                >
                  <span class="st-theme-preview" classList={{ split: !!t.darkSwatch }} aria-hidden="true">
                    <ThemeSwatch colors={t.swatch} />
                    <Show when={t.darkSwatch}>{(d) => <ThemeSwatch colors={d()} />}</Show>
                  </span>
                  <span class="st-theme-label">{t.label}</span>
                </button>
              )}
            </For>
          </div>
        </div>
        <Field label="Favorites">
          <label class="st-check">
            <input type="checkbox" checked={pinFavorites()} onChange={(e) => setPinFavorites(e.currentTarget.checked)} />
            Keep them at the top of the sidebar while the folders scroll
          </label>
        </Field>
      </SettingsGroup>
      <SettingsGroup title="Privacy">
        {/* How far pictures may be looked up: each level contacts more senders' websites. View
            options switches between Off and the level chosen here. */}
        <div class="st-field st-field-top">
          <span class="st-field-label">Sender pictures</span>
          <div class="st-levels" role="radiogroup" aria-label="Sender pictures">
            <For each={PICTURE_LEVELS}>
              {(l) => (
                <label class="st-level">
                  <input type="radio" name="picture-level" checked={pictureLevel() === l.id} onChange={() => setPictureLevel(l.id)} />
                  <span>
                    {l.label}
                    <span class="st-level-note">{l.note}</span>
                  </span>
                </label>
              )}
            </For>
          </div>
        </div>
        <RemoteSenders />
        <Field label="Insecure pictures" class="st-field-top st-divided">
          <Choice
            checked={httpPictures()}
            onChange={(on) => void setHttpPictures(on)}
            label="Load pictures from insecure (http) addresses"
            note="Only in mail whose pictures you allow, when a picture doesn’t load securely. Others on your network can see its address."
          />
        </Field>
        <Field label="Search" class="st-field-top st-divided">
          <Choice
            checked={attachmentSearch()}
            onChange={(on) => void setAttachmentSearch(on)}
            label="Search the text in attachments (PDFs and text files)"
            note="Attachments on this computer are read here, in a separate process; nothing is downloaded for it and nothing leaves the computer. It makes the search index larger."
          />
        </Field>
        <Field label="Notifications" class="st-field-top st-divided">
          <Choice
            checked={notifyDetails()}
            onChange={setNotifyDetails}
            label="Show who new mail is from and its subject"
            note="Off: notifications only say there’s new mail, for screens others can see."
          />
        </Field>
        <Show when={updateStatus()?.supported}>
          <Field label="Updates" class="st-field-top st-divided">
            <Choice
              checked={autoUpdates()}
              onChange={setAutoUpdates}
              label="Look for new versions and download them"
              note="Each look asks GitHub, where Email’s releases are published, which tells it your IP address."
            />
          </Field>
        </Show>
      </SettingsGroup>
      <SettingsGroup title="Email links">
        <Field label="Default mail app">
          <Show when={status()} fallback={<span class="st-muted">…</span>}>
            {(s) => (
              <Show when={s().supported} fallback={<span class="st-muted">Set it in your system’s settings.</span>}>
                <Show
                  when={s().isDefault}
                  fallback={
                    <>
                      <span class="st-muted">Email links (mailto:) open another program.</span>
                      <button class="btn secondary st-field-action" onClick={() => void make()}>
                        Make Email the default
                      </button>
                    </>
                  }
                >
                  <span>Email opens email links (mailto:).</span>
                </Show>
              </Show>
            )}
          </Show>
        </Field>
      <Show when={msg()}>
          <Field label="">
            <span class="st-status error">{msg()}</span>
          </Field>
        </Show>
      </SettingsGroup>
    </div>
  );
}

/** Senders (and "@domain"s) whose remote images always load ("Always load…" in the reader). */
function RemoteSenders() {
  const [list, { refetch }] = createResource(() => api.remoteSenders().catch(() => [] as string[]));
  return (
    <Field label="Remote images" class="st-field-top st-divided">
      <div class="st-remote">
        <Choice
          checked={domainRules()}
          onChange={(on) => void setDomainRules(on)}
          label="Allow “Always load…” for everyone at a company"
          note="Where your mail service checks who mail is from (Gmail and Microsoft do), only mail that passes counts. Elsewhere, someone pretending to be from that company could see when you open their message."
        />
        <Show when={(list() ?? []).length > 0} fallback={<span class="st-muted">No one yet. “Always load…” over a message’s blocked images adds someone here.</span>}>
          <ul class="st-remote-senders">
            <li class="st-muted">Always loaded in mail from:</li>
            <For each={list()}>
              {(addr) => (
                <li>
                  <span>
                    {addr}
                    <Show when={addr.startsWith('@') && !domainRules()}>
                      <span class="st-muted" title="Rules for everyone at a company are off"> (off)</span>
                    </Show>
                  </span>
                  <button class="link-btn" aria-label={`Stop loading images from ${addr}`} onClick={() => void api.setRemoteSender(addr, false).then(refetch)}>
                    Remove
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Field>
  );
}

function NotificationsSection() {
  const [testSent, setTestSent] = createSignal(false);
  return (
    <div class="st-body">
      <Field label="New mail">
        <label class="st-check">
          <input type="checkbox" checked={notifyNewMail()} onChange={(e) => setNotifyNewMail(e.currentTarget.checked)} />
          Show a notification when mail arrives in an Inbox
        </label>
      </Field>
      <Field label="">
        <label class="st-check">
          <input
            type="checkbox"
            checked={notifyInUse()}
            disabled={!notifyNewMail()}
            onChange={(e) => setNotifyInUse(e.currentTarget.checked)}
          />
          Also while Email is the window you’re using
        </label>
      </Field>
      <Field label="">
        <label class="st-check">
          <input
            type="checkbox"
            checked={notifyDetails()}
            disabled={!notifyNewMail()}
            onChange={(e) => setNotifyDetails(e.currentTarget.checked)}
          />
          Show who it’s from and the subject
        </label>
      </Field>
      <Field label="">
        <span class="st-muted">Click one to open the message.</span>
      </Field>
      <Field label="">
        <span class="st-muted">{testSent() ? 'Sent. Nothing showed? Look for Email in your system’s notification settings.' : 'See that they come through.'}</span>
        <button
          class="link-btn st-field-action"
          onClick={() => api.testNotification().then(() => setTestSent(true), () => setTestSent(true))}
        >
          Send a test notification
        </button>
      </Field>
    </div>
  );
}

function updateText(): string {
  const s = updateStatus();
  if (!s) return '';
  if (s.checking) return 'Looking for a new version…';
  if (s.ready) return `Version ${s.ready} is downloaded. It’s used once Email restarts.`;
  if (s.error) return `Couldn’t look for a new version: ${s.error}`;
  if (s.checked) return `Up to date (looked ${smartDate(s.checked)}).`;
  return 'Looks shortly after Email starts, then every six hours.';
}

function TroubleshootingSection() {
  const [version] = createResource(() => api.appVersion().catch(() => ''));
  const [msg, setMsg] = createSignal<string | null>(null);
  const act = (f: () => Promise<void>) => () => void f().catch((e) => setMsg(errorMessage(e)));
  return (
    <div class="st-body">
      <Field label="Version">{version() ?? ''}</Field>
      <Field label="Updates">
        <Show
          when={updateStatus()?.supported}
          fallback={<span class="st-muted">This copy doesn’t update itself: it was built on this computer, or before updates were turned on. Copies installed from the GitHub releases now do.</span>}
        >
          <label class="st-check">
            <input type="checkbox" checked={autoUpdates()} onChange={(e) => setAutoUpdates(e.currentTarget.checked)} />
            Look for new versions and download them
          </label>
        </Show>
      </Field>
      <Show when={updateStatus()?.supported}>
        <Field label="">
          <span class="st-muted st-update-state">{updateText()}</span>
          <Show
            when={updateStatus()?.ready}
            fallback={
              <button class="link-btn st-field-action" disabled={!!updateStatus()?.checking} onClick={() => void checkForUpdate()}>
                Check now
              </button>
            }
          >
            <button class="link-btn st-field-action" onClick={act(() => restartToUpdate())}>
              Restart to update
            </button>
          </Show>
        </Field>
      </Show>
      <Field label="App log">
        <span class="st-muted">Connections, sync, sending: what to look at when something misbehaves.</span>
        <button class="link-btn st-field-action" onClick={act(() => api.showLog())}>
          Show file
        </button>
      </Field>
      <Field label="Data folder">
        <span class="st-muted">Where mail is stored on this computer.</span>
        <button class="link-btn st-field-action" onClick={act(() => api.showDataDir())}>
          Show folder
        </button>
      </Field>
      <Field label="Developer tools">
        <span class="st-muted">The web inspector for this window.</span>
        <button class="link-btn st-field-action" onClick={act(() => api.openDevtools())}>
          Open
        </button>
      </Field>
      <Show when={msg()}>
        <p class="st-acct-msg error">{msg()}</p>
      </Show>
    </div>
  );
}

// ------------------------------------------------------------- the dialog

function Panel() {
  let card!: HTMLDivElement;
  onMount(() => {
    // (Not closed when the window loses focus: a file dialog — a picture for a marker or a
    // signature — takes it, and Settings must be there when it's chosen.)
    // Capture on the window: while a shortcut is being recorded the key is the shortcut (and
    // reaches nothing else, even with focus fallen out of the dialog). Other keys go where
    // they're typed (the password field…).
    const onKey = (e: KeyboardEvent) => {
      if (recordKeyPress(e, () => card.focus({ preventScroll: true }))) e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    onCleanup(() => window.removeEventListener('keydown', onKey, true));
  });

  // Esc, while Settings is the dialog on top: closes it, or what's open in it first.
  function onEscape(e: KeyboardEvent): boolean {
    // A shortcut being recorded takes the key (above).
    if (recording()) return false;
    // And a form that Esc empties first (an address being added), while something's typed.
    const esc = e.target instanceof Element ? e.target.closest('[data-esc-empties]') : null;
    if (esc && [...esc.querySelectorAll('input')].some((i) => i.value)) return false;
    if (presetMenu()) setPresetMenu(false);
    // The shortcuts' search empties first.
    else if (section() === 'keyboard' && keySearch()) setKeySearch('');
    else close();
    return true;
  }

  // The account whose page is shown (one since removed: the list again).
  const accountShown = () => (accounts() ?? []).find((a) => a.id === accountPage());
  const title = () => SECTIONS.find((s) => s.id === section())?.title ?? '';
  return (
    <Modal label="Settings" class="settings" ref={(el) => (card = el)} onClose={close} onEscape={onEscape} focusCard>
      <nav class="st-nav" aria-label="Settings sections">
        <h2>Settings</h2>
        <For each={SECTIONS}>
          {(s) => (
            <>
              <button
                class="st-nav-item"
                classList={{ on: section() === s.id && !(s.id === 'accounts' && accountShown()) }}
                aria-current={section() === s.id && !(s.id === 'accounts' && accountShown()) ? 'page' : undefined}
                onClick={() => {
                  setRecording(null);
                  setSection(s.id);
                  if (s.id === 'accounts') setAccountPage(null);
                }}
              >
                {s.title}
              </button>
              {/* Each account has a page of its own, listed under Accounts. */}
              <Show when={s.id === 'accounts'}>
                <For each={accounts() ?? []}>
                  {(a) => {
                    const on = () => section() === 'accounts' && accountShown()?.id === a.id;
                    return (
                      <button
                        class="st-nav-acct"
                        classList={{ on: on() }}
                        aria-current={on() ? 'page' : undefined}
                        title={a.email}
                        onClick={() => {
                          setRecording(null);
                          setSection('accounts');
                          setAccountPage(a.id);
                        }}
                      >
                        <AccountDot account={a} size={14} />
                        <span class="st-nav-acct-email">{a.email}</span>
                      </button>
                    );
                  }}
                </For>
              </Show>
            </>
          )}
        </For>
      </nav>
      <div class="st-pane">
        <header class="st-pane-head">
          <Show when={section() === 'accounts' ? accountShown() : undefined} fallback={<h3>{title()}</h3>}>
            {(a) => (
              <h3 class="st-acct-title">
                {a().email}
                <span class="st-acct-type">{PROVIDER[a().provider] ?? a().provider}</span>
              </h3>
            )}
          </Show>
          <div class="st-head-actions">
            {/* In the title bar, not after the accounts: there without scrolling past them. */}
            <Show when={section() === 'accounts'}>
              <button
                class="btn secondary"
                onClick={() => {
                  close();
                  setAddingAccount(true);
                }}
              >
                + Add account
              </button>
            </Show>
            <button class="icon-btn" onClick={close} aria-label="Close">
              <CloseIcon />
            </button>
          </div>
        </header>
        <Switch>
          <Match when={section() === 'general'}>
            <GeneralSection />
          </Match>
          <Match when={section() === 'accounts'}>
            <AccountsSection />
          </Match>
          <Match when={section() === 'signatures'}>
            <SignaturesSection />
          </Match>
          <Match when={section() === 'ai'}>
            <AiSection />
          </Match>
          <Match when={section() === 'aiapps'}>
            <AiAppsSection />
          </Match>
          <Match when={section() === 'notifications'}>
            <NotificationsSection />
          </Match>
          <Match when={section() === 'keyboard'}>
            <KeyboardSection />
          </Match>
          <Match when={section() === 'troubleshooting'}>
            <TroubleshootingSection />
          </Match>
        </Switch>
      </div>
    </Modal>
  );
}

export function SettingsHost() {
  return (
    <Show when={open()}>
      <Panel />
    </Show>
  );
}
