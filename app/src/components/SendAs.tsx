import { createSignal, For, onMount, type JSX } from 'solid-js';
import { CloseIcon, PlusIcon } from './Icons';
import { api, errorMessage, type Identity } from '../api';
import { accountIdentities, identities, loadIdentities, reloadIdentities } from '../lib/identities';
import { loadSignatures, reloadSignatures, setDefaultsHere, sigs } from '../lib/signatures';
import { Select, type SelectOption } from './Select';
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
  const ownSelect = (label: string, value: number | null, set: (id: number | null) => void) => (
    <Select variant="plain" class="sa-sig" label={label} value={value ?? 0} options={ownOptions()} onChange={(v) => set(v || null)} />
  );
  // Another address: the account's own address's signature (whatever that is then: shown greyed,
  // by name), None, or one of its own. Stored as null, 0 and the signature's id; -1 here.
  const aliasSelect = (label: string, value: number | null, which: 'newId' | 'replyId', set: (id: number | null) => void) => {
    const inherited = () => sigs().signatures.find((x) => x.id === own()?.[which])?.name ?? 'None';
    const options = (): SelectOption<number>[] => [
      { value: -1, label: `Same as ${props.email}`, short: inherited(), title: `Same as ${props.email}`, muted: true },
      { value: 0, label: 'None' },
      ...sigList(),
    ];
    return <Select variant="plain" class="sa-sig" label={label} value={value ?? -1} options={options()} onChange={(v) => set(v === -1 ? null : v)} />;
  };

  const remove = (i: Identity) => run(() => api.deleteIdentity(i.id));
  /** The column after the signatures: × on another address's row, + on the row that adds one. */
  const iconBtn = (label: string, onClick: (() => void) | undefined, icon: JSX.Element, disabled = false) => (
    <button class="icon-btn sa-act" type={onClick ? 'button' : 'submit'} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );

  // One table: the account's own address, its others, and a last row that adds one, all in the
  // same columns. The adding row is always there (typing in it is how one is added), so nothing
  // moves or changes shape to add an address.
  return (
    <div class="sa-wrap">
      <div class="sa-list" role="table" aria-label="Addresses to send as">
        <div class="sa-head" role="row">
          <span role="columnheader" class="sa-def" title="The address mail is from unless you choose another">
            Default
          </span>
          <span role="columnheader">Address</span>
          <span role="columnheader">Name</span>
          <span role="columnheader" title="Signature for new messages">
            Signature
          </span>
          <span role="columnheader" title="Signature for replies and forwards">
            Reply signature
          </span>
          <span />
        </div>
        <span class="sa-rule" aria-hidden="true" />
        <div class="sa-row" role="row">
          <span class="sa-def">
            <input
              type="radio"
              name={`send-as-${props.accountId}`}
              checked={noDefault()}
              onChange={() => void makeDefault(null)}
              title="Send from this address unless you choose another"
              aria-label={`Send from ${props.email} by default`}
            />
          </span>
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
          {ownSelect(`Signature for new messages from ${props.email}`, own()?.newId ?? null, (id) => void setOwn('newId', id))}
          {ownSelect(`Signature for replies from ${props.email}`, own()?.replyId ?? null, (id) => void setOwn('replyId', id))}
          <span />
        </div>
        <For each={list()}>
          {(i) => (
            <div class="sa-row" role="row">
              <span class="sa-def">
                <input
                  type="radio"
                  name={`send-as-${props.accountId}`}
                  checked={i.isDefault}
                  onChange={() => void makeDefault(i.id)}
                  title="Send from this address unless you choose another"
                  aria-label={`Send from ${i.email} by default`}
                />
              </span>
              <span class="sa-email">{i.email}</span>
              <input
                class="st-input sa-name"
                type="text"
                placeholder={props.name || 'Name'}
                value={i.name}
                aria-label={`Name for ${i.email}`}
                onChange={(e) => void save(i, { name: e.currentTarget.value })}
              />
              {aliasSelect(`Signature for new messages from ${i.email}`, i.newSignatureId, 'newId', (id) => void save(i, { newSignatureId: id }))}
              {aliasSelect(`Signature for replies from ${i.email}`, i.replySignatureId, 'replyId', (id) => void save(i, { replySignatureId: id }))}
              {iconBtn(`Remove ${i.email}`, () => void remove(i), <CloseIcon size={12} />)}
            </div>
          )}
        </For>
        <form class="sa-row sa-new" role="row" noValidate data-esc-empties onSubmit={add}>
          <span />
          <input
            class="st-input sa-addr"
            type="email"
            placeholder="Add an address…"
            aria-label="Another address to send as"
            value={email()}
            onInput={(e) => (setEmail(e.currentTarget.value), setMsg(null))}
            onKeyDown={(e) => {
              // Esc empties it first (Settings leaves it this one: data-esc-empties), then closes
              // Settings, as anywhere.
              if (e.key === 'Escape' && (email() || name())) {
                setEmail('');
                setName('');
                setMsg(null);
              }
            }}
          />
          <input
            class="st-input sa-name"
            type="text"
            placeholder={props.name || 'Name'}
            aria-label="Name for the address to add"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <span />
          <span />
          {iconBtn('Add address', undefined, <PlusIcon size={13} />, !email().trim())}
        </form>
      </div>
      {/* one reserved line: an error comes and goes without moving anything */}
      <span class="st-status error sa-msg" role="status">
        {msg() ?? ''}
      </span>
      <p class="st-muted sa-note">
        The mail server must allow sending as other addresses (in Gmail: Settings › Accounts › “Send mail as”).
      </p>
    </div>
  );
}
