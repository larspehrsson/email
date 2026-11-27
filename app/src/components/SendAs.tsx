import { createSignal, For, onMount, Show } from 'solid-js';
import { api, errorMessage, type Identity } from '../api';
import { accountIdentities, identities, loadIdentities, reloadIdentities } from '../lib/identities';
import { loadSignatures, reloadSignatures, setDefaultsHere, sigs } from '../lib/signatures';
import { Select } from './Select';
import { reloadAccounts } from '../state';

/** An account's addresses to send as (Settings › Accounts): its own and its others (an alias,
 *  a catch-all domain's), each with a name and its signatures for new messages and for replies
 *  and forwards, and which one mail goes out from unless chosen otherwise in the composer. */
export function SendAsGroup(props: { accountId: number; email: string; name: string; onRename: (name: string) => void }) {
  onMount(() => {
    void loadIdentities().catch(() => {});
    void loadSignatures().catch(() => {});
  });
  const list = () => accountIdentities(props.accountId, identities());
  const [msg, setMsg] = createSignal<string | null>(null);
  const [adding, setAdding] = createSignal(false);
  const [email, setEmail] = createSignal('');
  const [name, setName] = createSignal('');

  const run = async (f: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await f();
      await reloadIdentities();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  const save = (i: Identity, change: Partial<Identity>) => run(() => api.saveIdentity({ ...i, ...change }));
  const makeDefault = (id: number | null) =>
    run(async () => {
      if (id == null) {
        const cur = list().find((i) => i.isDefault);
        if (cur) await api.saveIdentity({ ...cur, isDefault: false });
      } else {
        const i = list().find((x) => x.id === id);
        if (i) await api.saveIdentity({ ...i, isDefault: true });
      }
    });
  const add = (e: Event) => {
    e.preventDefault();
    void run(async () => {
      await api.saveIdentity({
        id: 0,
        accountId: props.accountId,
        email: email(),
        name: name(),
        newSignatureId: null,
        replySignatureId: null,
        // The first one added: what the account sends as from now on, as it's why it's added.
        isDefault: list().length === 0,
      });
      setEmail('');
      setName('');
      setAdding(false);
    });
  };
  const noDefault = () => !list().some((i) => i.isDefault);

  // The account's own address: its signatures are the account's defaults.
  const own = () => sigs().defaults.find((d) => d.accountId === props.accountId);
  const setOwn = async (which: 'newId' | 'replyId', id: number | null) => {
    const next = { newId: own()?.newId ?? null, replyId: own()?.replyId ?? null, [which]: id };
    setDefaultsHere(props.accountId, next.newId, next.replyId);
    setMsg(null);
    try {
      await api.setSignatureDefaults(props.accountId, next.newId, next.replyId);
      await reloadSignatures();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  const sigList = () => sigs().signatures.map((s) => ({ value: s.id, label: s.name }));
  const ownOptions = () => [{ value: 0, label: 'None' }, ...sigList()];
  // Another address: its own, or the account's (whatever that is then).
  const aliasOptions = () => [{ value: 0, label: 'As the account' }, ...sigList()];
  const sigSelect = (label: string, value: number | null, options: { value: number; label: string }[], set: (id: number | null) => void) => (
    <Select variant="plain" class="sa-sig" label={label} value={value ?? 0} options={options} onChange={(v) => set(v || null)} />
  );

  return (
    <div class="sa-list">
      <div class="sa-head st-muted">
        <span />
        <span>Address</span>
        <span>Name</span>
        <span title="Signature for new messages">New messages</span>
        <span title="Signature for replies and forwards">Replies</span>
        <span />
      </div>
      <div class="sa-row">
        <input
          type="radio"
          name={`send-as-${props.accountId}`}
          checked={noDefault()}
          onChange={() => void makeDefault(null)}
          title="Send from this address unless you choose another"
          aria-label={`Send from ${props.email} by default`}
        />
        <span class="sa-email">{props.email}</span>
        <input
          class="st-input sa-name"
          type="text"
          placeholder="Your name"
          value={props.name}
          aria-label={`Name for ${props.email}`}
          onChange={(e) => {
            const v = e.currentTarget.value.trim();
            setMsg(null);
            void api.setDisplayName(props.accountId, v).then(
              () => (props.onRename(v), void reloadAccounts()),
              (err) => setMsg(errorMessage(err)),
            );
          }}
        />
        {sigSelect(`Signature for new messages from ${props.email}`, own()?.newId ?? null, ownOptions(), (id) => void setOwn('newId', id))}
        {sigSelect(`Signature for replies from ${props.email}`, own()?.replyId ?? null, ownOptions(), (id) => void setOwn('replyId', id))}
        <span />
      </div>
      <For each={list()}>
        {(i) => (
          <div class="sa-row">
            <input
              type="radio"
              name={`send-as-${props.accountId}`}
              checked={i.isDefault}
              onChange={() => void makeDefault(i.id)}
              title="Send from this address unless you choose another"
              aria-label={`Send from ${i.email} by default`}
            />
            <span class="sa-email">{i.email}</span>
            <input
              class="st-input sa-name"
              type="text"
              placeholder={props.name || 'Name'}
              value={i.name}
              aria-label={`Name for ${i.email}`}
              onChange={(e) => void save(i, { name: e.currentTarget.value })}
            />
            {sigSelect(`Signature for new messages from ${i.email}`, i.newSignatureId, aliasOptions(), (id) => void save(i, { newSignatureId: id }))}
            {sigSelect(`Signature for replies from ${i.email}`, i.replySignatureId, aliasOptions(), (id) => void save(i, { replySignatureId: id }))}
            <button class="link-btn" aria-label={`Remove ${i.email}`} onClick={() => void run(() => api.deleteIdentity(i.id))}>
              Remove
            </button>
          </div>
        )}
      </For>
      <Show
        when={adding()}
        fallback={
          <button class="link-btn sa-add" onClick={() => (setAdding(true), setMsg(null))}>
            + Add an address
          </button>
        }
      >
        <form class="st-pw sa-new" noValidate onSubmit={add}>
          <input
            class="st-input"
            type="email"
            placeholder="you@example.com"
            value={email()}
            ref={(el) => queueMicrotask(() => el.focus())}
            onInput={(e) => setEmail(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAdding(false))}
          />
          <input class="st-input" type="text" placeholder={props.name || 'Name'} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          <button class="btn primary" type="submit" disabled={!email().trim()}>
            Add
          </button>
          <button class="btn secondary" type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      </Show>
      <p class="st-muted sa-note">
        The radio button marks the address mail goes out from unless you choose another. The account’s mail server must allow sending as the other addresses (in Gmail: Settings › Accounts › “Send mail as”).
      </p>
      <Show when={msg()}>
        <span class="st-status error">{msg()}</span>
      </Show>
    </div>
  );
}
