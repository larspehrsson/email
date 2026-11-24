import type { Addr } from '../api';
import { newMessageTo } from '../lib/compose';
import { openContextMenu, type MenuItem } from './ContextMenu';

// The right-click menu over a person in a message's header (the sender, To, Cc): write to
// them, or copy their address.

function copy(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {});
}

/** "Ann Lee <ann@example.com>", the name quoted when it has characters an address list uses. */
export function nameAndAddress(a: Addr): string {
  if (!a.name) return a.addr;
  const name = /[",;:<>@()[\]\\]/.test(a.name) ? `"${a.name.replace(/(["\\])/g, '\\$1')}"` : a.name;
  return `${name} <${a.addr}>`;
}

export function addressMenuItems(a: Addr): MenuItem[] {
  const items: MenuItem[] = [
    { label: `New message to ${a.name || a.addr}`, run: () => newMessageTo([a]) },
    { label: 'Copy address', separatorBefore: true, run: () => copy(a.addr) },
  ];
  if (a.name) items.push({ label: 'Copy name and address', run: () => copy(nameAndAddress(a)) });
  return items;
}

/** Open it at the pointer; the header under it (a conversation card's toggles) sees nothing. */
export function addressMenu(e: MouseEvent, a: Addr): void {
  e.stopPropagation();
  // The name it's about stays highlighted while the menu is open.
  openContextMenu(e, addressMenuItems(a), e.currentTarget as Element | null);
}
