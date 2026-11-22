// Whose contacts the address book lists: everyone, a linked Google account's, one of its
// groups (as in Google Contacts), or the ones kept only on this computer. Chosen in the
// sidebar while the address book is open (or, with the sidebar as a rail, in a column of the
// address book), and kept between visits.

import { createMemo, createRoot, createSignal } from 'solid-js';
import type { Card, ContactGroup } from '../api';
import { cards } from './addressBook';
import { googleStatus } from './googleContacts';

export type Source = { kind: 'all' } | { kind: 'local' } | { kind: 'account'; id: number } | { kind: 'group'; id: number; group: string };

export const MY_CONTACTS = 'contactGroups/myContacts';
export const STARRED = 'contactGroups/starred';

export const sourceKey = (s: Source) =>
  s.kind === 'account' ? `account:${s.id}` : s.kind === 'group' ? `group:${s.id}:${s.group}` : s.kind;

function sourceFrom(key: string | null): Source {
  const [kind, id, ...group] = (key ?? '').split(':');
  if (kind === 'local') return { kind: 'local' };
  if (kind === 'account' && id) return { kind: 'account', id: Number(id) };
  if (kind === 'group' && id && group.length) return { kind: 'group', id: Number(id), group: group.join(':') };
  return { kind: 'all' };
}

const KEY = 'contacts.source';
function saved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const [source, setSourceRaw] = createSignal<Source>(sourceFrom(saved()));

export function setSource(s: Source): void {
  setSourceRaw(s);
  try {
    localStorage.setItem(KEY, sourceKey(s));
  } catch {
    /* only a convenience */
  }
}

/** The Google accounts linked to their contacts (with their groups). */
export const contactLinks = () => googleStatus()?.links ?? [];

/** The source chosen, if it's still there (an account unlinked, a group deleted in Google: all). */
export const where = createRoot(() =>
  createMemo<Source>(() => {
    const s = source();
    if (s.kind === 'account' || s.kind === 'group') {
      const l = contactLinks().find((x) => x.accountId === s.id);
      if (!l || (s.kind === 'group' && !(l.groups ?? []).some((g) => g.resource === s.group))) return { kind: 'all' };
    }
    return s;
  }),
);

export const inSource = (c: Card, s: Source) =>
  s.kind === 'all' ||
  (s.kind === 'local' && c.google == null) ||
  (s.kind === 'account' && c.google === s.id) ||
  (s.kind === 'group' && c.google === s.id && (c.groups ?? []).includes(s.group));

export const sourceCount = (s: Source) => cards().filter((c) => inSource(c, s)).length;

/** Each group's name by account and resource, for the chips on a row. */
const groupNames = createRoot(() =>
  createMemo(() => {
    const m = new Map<string, string>();
    for (const l of contactLinks()) for (const g of l.groups ?? []) m.set(`${l.accountId}:${g.resource}`, g.name);
    return m;
  }),
);

/** The groups a contact's row shows: all but My Contacts (nearly everyone is in it), Starred
 *  first. */
export function chipsOf(c: Card): ContactGroup[] {
  if (c.google == null) return [];
  return (c.groups ?? [])
    .filter((r) => r !== MY_CONTACTS)
    .flatMap((r) => {
      const name = groupNames().get(`${c.google}:${r}`);
      return name ? [{ resource: r, name }] : [];
    })
    .sort((a, b) => Number(b.resource === STARRED) - Number(a.resource === STARRED) || a.name.localeCompare(b.name));
}
