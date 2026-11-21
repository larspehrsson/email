import { batch, createEffect, createMemo, createSignal, For, Index, on, onCleanup, onMount, Show } from 'solid-js';
import { api, errorMessage, type Card } from '../api';
import { cards, emptyCard, loadCards, reloadCards } from '../lib/addressBook';
import { newMessageTo } from '../lib/compose';
import { hint } from '../lib/shortcuts';
import { accounts, setMainView, setSearchQuery, setSearchScope } from '../state';
import { googleStatus, reloadGoogleStatus, syncGoogle, syncGoogleSoon } from '../lib/googleContacts';
import { confirmDialog } from './Actions';
import { CloseIcon, PeopleIcon, PlusIcon } from './Icons';
import { focusSearch } from './SearchBar';

// The address book: everyone kept, searchable, on the left; the one chosen on the right, to
// change, write to, or see their mail.

/** A contact to show when the view opens (e.g. "In contacts" in the sender panel), or a new one
 *  prefilled (name, address). */
const [opening, setOpening] = createSignal<{ id: number } | { name: string; email: string } | null>(null);
export function openContacts(at?: { id: number } | { name: string; email: string }): void {
  setOpening(at ?? null);
  setMainView('contacts');
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

  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return cards();
    return cards().filter((c) =>
      [c.name, c.company, c.notes, ...c.emails, ...c.phones].some((f) => f.toLowerCase().includes(q)),
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
  /** Where a new contact goes: the last place chosen, if still linked. */
  const lastPlace = () => {
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

  // Keep the list's choice in view when cards change underneath (another window saved).
  createEffect(
    on(cards, () => {
      const f = form();
      if (f?.id && !dirty() && !cards().some((c) => c.id === f.id)) choose(cards()[0] ?? null);
    }, { defer: true }),
  );

  return (
    <section class="contacts" aria-label="Address book">
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
          <For each={shown()} fallback={<p class="ct-empty">{cards().length ? 'No one matches.' : 'No contacts yet. Add one with +, or from the Sender panel (⌘2) while reading.'}</p>}>
            {(c) => (
              <button
                role="option"
                aria-selected={form()?.id === c.id}
                class="ct-row"
                classList={{ on: form()?.id === c.id }}
                onClick={() => void pick(c)}
              >
                <span class="ct-name">
                  {c.name || c.company || c.emails[0]}
                  <Show when={c.google != null}>
                    <span class="ct-google" title={`Google Contacts: ${googleEmail(c.google!)}`}>G</span>
                  </Show>
                </span>
                <span class="ct-sub">{c.emails[0] ?? c.company}</span>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="ct-detail">
        <Show when={form()} fallback={<p class="ct-empty ct-none">Choose someone, or add a contact with +.</p>}>
          {(f) => (
            <div class="ct-form">
              <input
                ref={(el) => (nameInput = el)}
                class="ct-big"
                type="text"
                placeholder="Name"
                aria-label="Name"
                value={f().name}
                onInput={(e) => set({ name: e.currentTarget.value })}
              />
              <div class="ct-field ct-where">
                <span>Saved in</span>
                <Show
                  when={f().id === 0 && (googleStatus()?.links.length ?? 0) > 0}
                  fallback={<span class="ct-where-text">{f().google != null ? `Google Contacts · ${googleEmail(f().google!)}` : 'This computer'}</span>}
                >
                  <select
                    class="st-input ct-save-in"
                    aria-label="Save in"
                    value={String(f().google ?? '')}
                    onChange={(e) => set({ google: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
                  >
                    <option value="">This computer</option>
                    <For each={googleStatus()?.links ?? []}>{(l) => <option value={String(l.accountId)}>Google Contacts · {l.googleEmail}</option>}</For>
                  </select>
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
