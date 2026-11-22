import { For, Show, type JSX } from 'solid-js';
import { contactLinks, MY_CONTACTS, setSource, sourceCount, sourceKey, STARRED, where, type Source } from '../lib/contactSources';
import { CloudIcon, FolderIcon, PeopleIcon, StarIcon, TagIcon } from './Icons';

/** Whose contacts the address book lists: all, each linked Google account and its groups,
 *  this computer's. In the sidebar while the address book is open, or (sidebar as a rail) as
 *  a column of the address book. */
export function ContactSources(props: { class?: string }) {
  function Row(p: { label: string; icon: JSX.Element; s: Source; heading?: boolean; nested?: boolean }) {
    const on = () => sourceKey(where()) === sourceKey(p.s);
    return (
      <button
        class="ct-source"
        classList={{ on: on(), heading: !!p.heading, nested: !!p.nested }}
        aria-current={on() ? 'true' : undefined}
        title={p.label}
        onClick={() => setSource(p.s)}
      >
        <span class="ct-source-icon">{p.icon}</span>
        <span class="ct-source-name">{p.label}</span>
        <span class="ct-source-count">{sourceCount(p.s)}</span>
      </button>
    );
  }
  return (
    <nav class={`ct-sources${props.class ? ` ${props.class}` : ''}`} aria-label="Contact groups">
      <Row label="All contacts" icon={<PeopleIcon size={14} />} s={{ kind: 'all' }} />
      <For each={contactLinks()}>
        {(l) => (
          <>
            <Row label={l.googleEmail} icon={<CloudIcon size={14} />} s={{ kind: 'account', id: l.accountId }} heading />
            <For each={l.groups ?? []}>
              {(g) => (
                <Row
                  label={g.name}
                  icon={g.resource === STARRED ? <StarIcon size={13} /> : g.resource === MY_CONTACTS ? <PeopleIcon size={13} /> : <TagIcon size={13} />}
                  s={{ kind: 'group', id: l.accountId, group: g.resource }}
                  nested
                />
              )}
            </For>
          </>
        )}
      </For>
      <Show when={contactLinks().length > 0}>
        <Row label="This computer" icon={<FolderIcon size={14} />} s={{ kind: 'local' }} heading />
      </Show>
    </nav>
  );
}
