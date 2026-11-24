import { createMemo, For, Show } from 'solid-js';
import { accountLogo } from '../lib/accountLogos';
import { folderMenu } from './ContextMenu';
import { hint } from '../lib/shortcuts';
import type { Account, Folder } from '../api';
import { fmtNum } from '../lib/format';
import { flyout, setFlyout, toggleSidebar } from '../lib/layout';
import { DRAG } from '../lib/platform';
import { accountMark, accounts, folderById, foldersByAccount, mainView, selectedFolderId, selectFolder, setMainView } from '../state';
import { FoldersIcon, PeopleIcon, RoleIcon, SidebarIcon } from './Icons';
import { pinFavorites } from '../lib/favorites';
import { badgeFor, favoriteFolders, isAccountCollapsed, isInboxPath, roleFolders, SyncFooter, toggleAccount } from './Sidebar';
import { msgDrag } from '../lib/messageDrag';

const compact = (n: number) => (n > 99 ? '99+' : String(n));

function RailFolder(props: { f: Folder; acct?: string }) {
  const n = () => badgeFor(props.f);
  const tip = () => {
    const f = props.f;
    const parts = [f.displayName];
    if (f.unread > 0) parts.push(`${fmtNum(f.unread)} unread`);
    parts.push(`${fmtNum(f.total)} total`);
    if (props.acct) parts.push(props.acct);
    return parts.join(' · ');
  };
  return (
    <button
      class="rail-btn"
      classList={{ selected: selectedFolderId() === props.f.id, 'drop-target': msgDrag()?.targetId === props.f.id }}
      data-folder-id={props.f.id}
      data-account-id={props.f.accountId}
      title={tip()}
      aria-label={tip()}
      aria-current={selectedFolderId() === props.f.id ? 'page' : undefined}
      onClick={() => selectFolder(props.f.id)}
      onContextMenu={(e) => folderMenu(e, props.f)}
    >
      <RoleIcon role={props.f.role ?? (isInboxPath(props.f) ? 'inbox' : null)} size={17} />
      <Show when={n() > 0}>
        <span class="rail-badge">{compact(n())}</span>
      </Show>
    </button>
  );
}

/** An account: its marker (click to fold it away, as in the sidebar), then its main folders. */
function RailAccount(props: { account: Account }) {
  const roles = createMemo(() => roleFolders(foldersByAccount[props.account.id] ?? []));
  const collapsed = () => isAccountCollapsed(props.account.id);
  // Folded: the Inbox's unread badge moves onto the marker (placed as on the Inbox icon), and
  // the marker is selected if the open folder is in this account.
  const inboxUnread = () => roles().find((f) => f.role === 'inbox' || isInboxPath(f))?.unread ?? 0;
  const holdsSelection = () => folderById(selectedFolderId())?.accountId === props.account.id;
  const tip = () => `${props.account.email}\n${collapsed() ? 'Show' : 'Hide'} its folders`;
  return (
    <div class="rail-acct">
      <button
        class="rail-marker"
        classList={{ selected: collapsed() && holdsSelection() }}
        title={tip()}
        aria-label={`${props.account.email}: ${collapsed() ? 'show' : 'hide'} folders`}
        aria-expanded={!collapsed()}
        onClick={() => toggleAccount(props.account.id)}
      >
        <span
          class="rail-letter"
          classList={{ 'has-logo': !!accountLogo(props.account.id) }}
          style={{ background: accountLogo(props.account.id) ? '#fff' : accountMark(props.account).color }}
        >
          <Show when={accountLogo(props.account.id)} fallback={accountMark(props.account).letter}>
            {(src) => <img src={src()} alt="" draggable={false} />}
          </Show>
        </span>
        <Show when={collapsed() && inboxUnread() > 0}>
          <span class="rail-badge">{compact(inboxUnread())}</span>
        </Show>
      </button>
      <Show when={!collapsed()}>
        <For each={roles()}>{(f) => <RailFolder f={f} />}</For>
      </Show>
    </div>
  );
}

/**
 * 48px sidebar: per-account role folders with badges, sync glyph at the bottom. The full tree
 * opens only on request: the folders button or Ctrl/⌘+Shift+1.
 */
export function Rail() {
  return (
    <nav class="rail" aria-label="Mailboxes">
      <div class="rail-top" data-tauri-drag-region={DRAG}>
        <button class="rail-btn" title={`Expand sidebar (${hint('rail')})`} aria-label="Expand sidebar" onClick={() => toggleSidebar()}>
          <SidebarIcon size={17} />
        </button>
        <button
          class="rail-btn"
          title={`All folders (${hint('flyout')})`}
          aria-label="Show all folders"
          onClick={(e) => {
            if (flyout()) {
              setFlyout(false);
              return;
            }
            setFlyout(e.detail === 0 ? 'keyboard' : 'click');
          }}
        >
          <FoldersIcon size={17} />
        </button>
        <button
          class="rail-btn"
          classList={{ on: mainView() === 'contacts' }}
          title={`Address book (${hint('contacts')})`}
          aria-label="Address book"
          aria-pressed={mainView() === 'contacts'}
          onClick={() => setMainView(mainView() === 'contacts' ? 'mail' : 'contacts')}
        >
          <PeopleIcon size={17} />
        </button>
      </div>
      <div class="rail-scroll">
        <Show when={favoriteFolders().length > 0}>
          <div class="rail-favs" classList={{ pinned: pinFavorites() }} aria-label="Favorite folders">
            <For each={favoriteFolders()}>
              {(f) => <RailFolder f={f} acct={(accounts() ?? []).find((a) => a.id === f.accountId)?.email} />}
            </For>
          </div>
        </Show>
        <For each={accounts() ?? []}>{(a) => <RailAccount account={a} />}</For>
      </div>
      <SyncFooter compact />
    </nav>
  );
}
