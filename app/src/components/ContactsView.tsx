import { Select } from './Select';
import { batch, createEffect, createMemo, createResource, createSignal, For, Index, on, onCleanup, onMount, Show } from 'solid-js';
import { api, errorMessage, type Card, type ContactDay, type Labeled } from '../api';
import { cards, emptyCard, loadCards, reloadCards } from '../lib/addressBook';
import { newMessageTo } from '../lib/compose';
import { chipsOf as chips, contactLinks, inSource, STARRED, where } from '../lib/contactSources';
import { sidebarMode } from '../lib/layout';
import { hint } from '../lib/shortcuts';
import { accounts, setMainView, setSearchQuery, setSearchScope } from '../state';
import { senderPictures } from '../lib/senderIcons';
import { Avatar } from './Avatar';
import { googleStatus, reloadGoogleStatus, syncGoogle, syncGoogleSoon } from '../lib/googleContacts';
import { confirmDialog } from './Actions';
import { ContactSources } from './ContactSources';
import { CloseIcon, PeopleIcon, PlusIcon } from './Icons';
import { focusSearch } from './SearchBar';

// The address book: everyone kept, searchable, on the left; the one chosen on the right, to
// change, write to, or see their mail. With Google Contacts linked, the sidebar chooses whose
// (lib/contactSources): everyone, one account's, one of its groups (as in Google Contacts), or
// the contacts kept only on this computer.

/** A contact to show when the view opens (e.g. "In contacts" in the sender panel), or a new one
 *  prefilled (name, address). */
const [opening, setOpening] = createSignal<{ id: number } | { name: string; email: string } | null>(null);
export function openContacts(at?: { id: number } | { name: string; email: string }): void {
  setOpening(at ?? null);
  setMainView('contacts');
}

/** "14 May 1971", or "14 May" for a birthday without a year (in the user's language). */
function dayText(d: ContactDay): string {
  const date = new Date(Date.UTC(d.year ?? 2000, d.month - 1, d.day));
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', ...(d.year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

export function ContactsView() {
  const [query, setQuery] = createSignal('');
  const [form, setForm] = createSignal<Card | null>(null);
  const [saved, setSaved] = createSignal<string>('');
  const [msg, setMsg] = createSignal<string | null>(null);
  let search!: HTMLInputElement;
  let nameInput: HTMLInputElement | undefined;

  onMount(() => {
    // Opening it brings in what changed in Google meanwhile.
    void reloadGoogleStatus().then(() => syncGoogle());
    void loadCards().then(() => {
      const o = opening();
      setOpening(null);
      if (o && 'id' in o) choose(cards().find((c) => c.id === o.id) ?? null);
      else if (o) startNew(o.name, o.email);
      else if (cards().length) choose(cards()[0]!);
      else search.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) {
        e.preventDefault();
        setMainView('mail');
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  // Whose contacts (lib/contactSources): chosen in the sidebar, or here when it's a rail.
  const links = contactLinks;
  const ownColumn = () => sidebarMode() === 'rail' && links().length > 0;

  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    const s = where();
    return cards().filter(
      (c) => inSource(c, s) && (!q || [c.name, c.company, c.notes, ...c.emails, ...c.phones].some((f) => f.toLowerCase().includes(q))),
    );
  });

  const key = (c: Card | null) => JSON.stringify(c);
  const dirty = () => !!form() && key(form()) !== saved();
  function choose(c: Card | null) {
    const copy = c ? { ...c, emails: c.emails.length ? [...c.emails] : [''], phones: [...c.phones] } : null;
    batch(() => {
      setForm(copy);
      setSaved(key(copy));
      setMsg(null);
    });
  }
  /** Where a new contact goes: the account being looked at, else the last place chosen, if
   *  still linked. */
  const lastPlace = () => {
    const s = where();
    if (s.kind === 'account' || s.kind === 'group') return s.id;
    if (s.kind === 'local') return null;
    const g = Number(localStorage.getItem('contacts.saveIn') ?? 0);
    return googleStatus()?.links.some((l) => l.accountId === g) ? g : null;
  };
  function startNew(name = '', email = '') {
    choose({ ...emptyCard(), name, emails: [email], google: lastPlace() });
    setSaved('');
    queueMicrotask(() => nameInput?.focus());
  }
  async function newContact() {
    if (dirty() && !(await confirmDialog('Leave without saving your changes?', 'Leave'))) return;
    startNew();
  }
  async function pick(c: Card) {
    if (dirty() && !(await confirmDialog('Leave without saving your changes?', 'Leave'))) return;
    choose(c);
  }

  const set = (patch: Partial<Card>) => form() && setForm({ ...form()!, ...patch });

  // What Google has beyond these fields (photo, title, addresses, birthday…), for a Google
  // contact: shown, and edited in Google. Fetched again only when another contact is chosen.
  const [details] = createResource(
    () => (form()?.google != null && form()!.id ? form()!.id : null),
    (id) => api.contactDetails(id).catch(() => null),
  );
  /** Google's kind ("Mobile", "Work") for an address or number as typed here. */
  const kindOf = (list: Labeled[] | undefined, value: string) => {
    const v = value.trim().toLowerCase();
    const plain = (s: string) => s.replace(/[^\d+]/g, '');
    return list?.find((l) => l.value.toLowerCase() === v || (plain(v).length > 4 && plain(l.value) === plain(v)))?.label ?? '';
  };
  const role = () => [details()?.title, details()?.department].filter(Boolean).join(' · ');
  const googleExtras = () => {
    const d = details();
    return !!d && (d.addresses.length > 0 || !!d.birthday || d.events.length > 0 || d.websites.length > 0 || d.relations.length > 0 || d.chat.length > 0);
  };

  async function save() {
    const f = form();
    if (!f) return;
    try {
      const id = await api.saveCard({ ...f, emails: f.emails.filter((e) => e.trim()), phones: f.phones.filter((p) => p.trim()) });
      if (f.id === 0) {
        try {
          localStorage.setItem('contacts.saveIn', String(f.google ?? 0));
        } catch {
          /* only a convenience */
        }
      }
      if (f.google != null) syncGoogleSoon(f.google);
      await reloadCards();
      choose(cards().find((c) => c.id === id) ?? null);
      setMsg('Saved.');
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  async function remove() {
    const f = form();
    if (!f) return;
    const who = f.name || f.company || f.emails[0] || 'this contact';
    const there = f.google != null ? googleEmail(f.google) : null;
    const text = there ? `Delete ${who}? They're deleted from Google Contacts (${there}) too.` : `Delete ${who} from the address book?`;
    if (f.id && !(await confirmDialog(text, 'Delete'))) return;
    try {
      if (f.id) await api.deleteCard(f.id);
      if (f.id && f.google != null) syncGoogleSoon(f.google);
      await reloadCards();
      choose(shown()[0] ?? null);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const addresses = () => (form()?.emails ?? []).map((e) => e.trim()).filter(Boolean);
  const googleEmail = (accountId: number) =>
    googleStatus()?.links.find((l) => l.accountId === accountId)?.googleEmail ?? accounts()?.find((a) => a.id === accountId)?.email ?? 'Google';
  // The browser may be signed in to several Google accounts: open the contact in the one it's in.
  const googleHref = (href: string) => {
    const g = form()?.google;
    if (g == null) return href;
    const email = googleEmail(g);
    return email.includes('@') ? `${href}?authuser=${encodeURIComponent(email)}` : href;
  };
  function write() {
    const f = form();
    if (!f || !addresses().length) return;
    newMessageTo([{ name: f.name || null, addr: addresses()[0]! }]);
  }
  function showMail() {
    const a = addresses()[0];
    if (!a) return;
    setMainView('mail');
    setSearchScope('all');
    setSearchQuery(`from:${a}`);
    queueMicrotask(() => focusSearch());
  }

  // Another source: the first of its contacts, unless the one chosen is in it (or being edited).
  createEffect(
    on(where, () => {
      const f = form();
      if (dirty() || (f?.id && shown().some((c) => c.id === f.id))) return;
      choose(shown()[0] ?? null);
    }, { defer: true }),
  );

  // Keep the list's choice in view when cards change underneath (another window saved).
  createEffect(
    on(cards, () => {
      const f = form();
      if (f?.id && !dirty() && !cards().some((c) => c.id === f.id)) choose(cards()[0] ?? null);
    }, { defer: true }),
  );

  return (
    <section class="contacts" classList={{ 'has-sources': ownColumn() }} aria-label="Address book">
      <Show when={ownColumn()}>
        <ContactSources class="ct-sources-column" />
      </Show>
      <div class="ct-list">
        <header class="ct-head">
          <span class="ct-title">
            <PeopleIcon /> Address book
          </span>
          <button class="icon-btn" title="New contact" aria-label="New contact" onClick={() => void newContact()}>
            <PlusIcon />
          </button>
          <button class="icon-btn" title={`Back to mail (Esc · ${hint('contacts')})`} aria-label="Back to mail" onClick={() => setMainView('mail')}>
            <CloseIcon />
          </button>
        </header>
        <input
          ref={search}
          class="st-input ct-search"
          type="search"
          placeholder="Search names, addresses, companies…"
          aria-label="Search the address book"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="ct-rows" role="listbox" aria-label="Contacts">
          <For
            each={shown()}
            fallback={
              <p class="ct-empty">
                {query().trim() ? 'No one matches.' : where().kind !== 'all' ? 'No one here.' : cards().length ? 'No one matches.' : 'No contacts yet. Add one with +, or from the Sender panel (⌘2) while reading.'}
              </p>
            }
          >
            {(c) => (
              <button
                role="option"
                aria-selected={form()?.id === c.id}
                class="ct-row"
                classList={{ on: form()?.id === c.id }}
                onClick={() => void pick(c)}
              >
                <Show when={senderPictures()}>
                  <Avatar name={c.name || c.company || null} addr={c.emails[0] ?? ''} size={32} class="ct-avatar" lazy />
                </Show>
                <span class="ct-row-text">
                  <span class="ct-name">
                    {c.name || c.company || c.emails[0]}
                  </span>
                  <span class="ct-sub">
                    <For each={chips(c)}>{(g) => <span class="ct-chip" classList={{ star: g.resource === STARRED }}>{g.name}</span>}</For>
                    {c.emails[0] ?? c.company}
                  </span>
                </span>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="ct-detail">
        <Show when={form()} fallback={<p class="ct-empty ct-none">Choose someone, or add a contact with +.</p>}>
          {(f) => (
            <div class="ct-form">
              <div class="ct-head" classList={{ 'has-photo': !!details()?.photo }}>
                <Show when={details()?.photo}>{(src) => <img class="ct-photo" src={src()} alt="" />}</Show>
                <div class="ct-head-text">
                  <input
                    ref={(el) => (nameInput = el)}
                    class="ct-big"
                    type="text"
                    placeholder="Name"
                    aria-label="Name"
                    value={f().name}
                    onInput={(e) => set({ name: e.currentTarget.value })}
                  />
                  <Show when={role() || details()?.nicknames.length}>
                    <div class="ct-role">
                      {role()}
                      <Show when={details()?.nicknames.length}>
                        <span class="ct-nick">
                          {role() ? ' · ' : ''}“{details()!.nicknames.join('”, “')}”
                        </span>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
              <div class="ct-field ct-where">
                <span>Saved in</span>
                <Show
                  when={f().id === 0 && (googleStatus()?.links.length ?? 0) > 0}
                  fallback={<span class="ct-where-text">{f().google != null ? `Google Contacts · ${googleEmail(f().google!)}` : 'This computer'}</span>}
                >
                  <Select
                    class="ct-save-in"
                    label="Save in"
                    value={f().google ?? null}
                    options={[
                      { value: null, label: 'This computer' },
                      ...(googleStatus()?.links ?? []).map((l) => ({ value: l.accountId as number | null, label: `Google Contacts · ${l.googleEmail}` })),
                    ]}
                    onChange={(google) => set({ google })}
                  />
                </Show>
              </div>
              <label class="ct-field">
                <span>Company</span>
                <input class="st-input" type="text" value={f().company} onInput={(e) => set({ company: e.currentTarget.value })} />
              </label>
              <div class="ct-field">
                <span>Email</span>
                <div class="ct-multi">
                  <Index each={f().emails}>
                    {(e, i) => (
                      <div class="ct-line">
                        <input
                          class="st-input"
                          type="email"
                          aria-label={`Email ${i + 1}`}
                          value={e()}
                          onInput={(ev) => set({ emails: f().emails.map((x, j) => (j === i ? ev.currentTarget.value : x)) })}
                        />
                        <Show when={kindOf(details()?.emails, e())}>{(k) => <span class="ct-kind">{k()}</span>}</Show>
                        <Show when={f().emails.length > 1}>
                          <button class="icon-btn" aria-label={`Remove email ${i + 1}`} onClick={() => set({ emails: f().emails.filter((_, j) => j !== i) })}>
                            <CloseIcon size={11} />
                          </button>
                        </Show>
                      </div>
                    )}
                  </Index>
                  <button class="link-btn ct-add" onClick={() => set({ emails: [...f().emails, ''] })}>
                    + Add an address
                  </button>
                </div>
              </div>
              <div class="ct-field">
                <span>Phone</span>
                <div class="ct-multi">
                  <Index each={f().phones}>
                    {(p, i) => (
                      <div class="ct-line">
                        <input
                          class="st-input"
                          type="tel"
                          aria-label={`Phone ${i + 1}`}
                          value={p()}
                          onInput={(ev) => set({ phones: f().phones.map((x, j) => (j === i ? ev.currentTarget.value : x)) })}
                        />
                        <Show when={kindOf(details()?.phones, p())}>{(k) => <span class="ct-kind">{k()}</span>}</Show>
                        <button class="icon-btn" aria-label={`Remove phone ${i + 1}`} onClick={() => set({ phones: f().phones.filter((_, j) => j !== i) })}>
                          <CloseIcon size={11} />
                        </button>
                      </div>
                    )}
                  </Index>
                  <button class="link-btn ct-add" onClick={() => set({ phones: [...f().phones, ''] })}>
                    + Add a phone number
                  </button>
                </div>
              </div>
              <Show when={googleExtras() && details()}>
                {(d) => (
                  <div class="ct-google-more" aria-label="From Google Contacts">
                    <For each={d().addresses}>
                      {(a) => (
                        <div class="ct-field ct-ro">
                          <span>Address</span>
                          <div class="ct-ro-value ct-address">
                            {a.value}
                            <Show when={a.label}>
                              <span class="ct-kind ct-kind-after">{a.label}</span>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                    <Show when={d().birthday}>
                      {(b) => (
                        <div class="ct-field ct-ro">
                          <span>Birthday</span>
                          <div class="ct-ro-value">{dayText(b())}</div>
                        </div>
                      )}
                    </Show>
                    <For each={d().events}>
                      {([day, kind]) => (
                        <div class="ct-field ct-ro">
                          <span>{kind || 'Date'}</span>
                          <div class="ct-ro-value">{dayText(day)}</div>
                        </div>
                      )}
                    </For>
                    <For each={d().websites}>
                      {(w) => (
                        <div class="ct-field ct-ro">
                          <span>Website</span>
                          <div class="ct-ro-value">
                            <Show when={/^https?:\/\//i.test(w.value)} fallback={w.value}>
                              <a href={w.value} target="_blank" rel="noopener noreferrer">
                                {w.value.replace(/^https?:\/\//i, '')}
                              </a>
                            </Show>
                            <Show when={w.label}>
                              <span class="ct-kind ct-kind-after">{w.label}</span>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                    <For each={d().relations}>
                      {(r) => (
                        <div class="ct-field ct-ro">
                          <span>{r.label || 'Related'}</span>
                          <div class="ct-ro-value">{r.value}</div>
                        </div>
                      )}
                    </For>
                    <For each={d().chat}>
                      {(c) => (
                        <div class="ct-field ct-ro">
                          <span>{c.label || 'Chat'}</span>
                          <div class="ct-ro-value">{c.value}</div>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </Show>
              <Show when={details()?.link}>
                {(href) => (
                  <div class="ct-field ct-ro">
                    <span />
                    <a class="ct-google-link" href={googleHref(href())} target="_blank" rel="noopener noreferrer">
                      Edit more in Google Contacts ↗
                    </a>
                  </div>
                )}
              </Show>
              <label class="ct-field">
                <span>Notes</span>
                <textarea class="st-input ct-notes" rows={4} value={f().notes} onInput={(e) => set({ notes: e.currentTarget.value })} />
              </label>
              <div class="ct-actions">
                <button class="btn secondary" disabled={!addresses().length} onClick={write}>
                  Write
                </button>
                <button class="btn secondary" disabled={!addresses().length} onClick={showMail}>
                  Show mail
                </button>
                <span class="ct-fill" />
                <span class="ct-msg">{msg() ?? ''}</span>
                <Show when={f().id || dirty()}>
                  <button class="link-btn ct-delete" onClick={() => void remove()}>
                    {f().id ? 'Delete' : 'Discard'}
                  </button>
                </Show>
                <button class="btn primary" disabled={!dirty()} onClick={() => void save()}>
                  Save
                </button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}
