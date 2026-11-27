import { createEffect, createRoot, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { api, errorMessage, type Folder } from '../api';
import { favoriteFolders, favoriteIndex, isFavorite, moveFavorite, toggleFavorite } from '../lib/favorites';
import { fmtNum } from '../lib/format';
import { showToast } from './Toast';
import { CheckIcon } from './Icons';

// A right-click menu: the webview's own (Reload, Inspect…) is replaced by the app's, at the
// pointer. One at a time; any click elsewhere, Escape, scrolling or leaving the window closes it.

export interface MenuItem {
  label: string;
  disabled?: boolean;
  /** A line above it, starting a new group. */
  separatorBefore?: boolean;
  /** A choice: ticked when true (the items of a menu with any set leave room for the tick). */
  checked?: boolean;
  run: () => void;
}

const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);

/** What the open menu is about (a name in a header): marked `.menu-target` while it's open. */
let target: Element | null = null;
createRoot(() =>
  createEffect(() => {
    if (menu()) return;
    target?.classList.remove('menu-target');
    target = null;
  }),
);

export function openContextMenu(e: MouseEvent, items: MenuItem[], about?: Element | null): void {
  e.preventDefault();
  e.stopPropagation();
  target?.classList.remove('menu-target');
  target = about ?? null;
  target?.classList.add('menu-target');
  setMenu({ x: e.clientX, y: e.clientY, items });
}

export function closeContextMenu(): void {
  setMenu(null);
}

/** Mark everything in a folder read (its menu, or the key), saying how many. */
export function markFolderRead(f: Folder): void {
  void api.markFolderRead(f.id).then(
    (n) => showToast({ kind: 'ok', text: n === 0 ? 'Nothing unread' : `Marked ${fmtNum(n)} ${n === 1 ? 'message' : 'messages'} as read`, ms: 3000 }),
    (err) => showToast({ kind: 'error', text: errorMessage(err) }),
  );
}

/** A folder's menu (sidebar, rail). */
export function folderMenu(e: MouseEvent, f: Folder): void {
  openContextMenu(e, [
    {
      label: isFavorite(f) ? 'Remove from favorites' : 'Add to favorites',
      run: () => toggleFavorite(f),
    },
    ...(isFavorite(f) && favoriteFolders().length > 1
      ? [
          { label: 'Move up in favorites', disabled: favoriteIndex(f) <= 0, run: () => moveFavorite(f, favoriteIndex(f) - 1) },
          {
            label: 'Move down in favorites',
            disabled: favoriteIndex(f) >= favoriteFolders().length - 1,
            run: () => moveFavorite(f, favoriteIndex(f) + 1),
          },
        ]
      : []),
    {
      label: 'Mark all as read',
      disabled: f.unread === 0,
      run: () => markFolderRead(f),
    },
  ]);
}

export function ContextMenuHost() {
  let el: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal({ left: 0, top: 0 });
  createEffect(() => {
    const m = menu();
    if (!m) return;
    // Inside the window: flip left / up when it would run off the edge.
    queueMicrotask(() => {
      const r = el?.getBoundingClientRect();
      const w = r?.width ?? 200;
      const h = r?.height ?? 40;
      setPos({
        left: m.x + w > window.innerWidth - 4 ? Math.max(4, m.x - w) : m.x,
        top: m.y + h > window.innerHeight - 4 ? Math.max(4, m.y - h) : m.y,
      });
      el?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    });
    setPos({ left: m.x, top: m.y });
    const onDown = (e: MouseEvent) => {
      if (!el?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMenu(null);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const items = [...(el?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    const close = () => setMenu(null);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    });
  });
  return (
    <Show when={menu()}>
      {(m) => (
        <Portal>
          <div
            ref={el}
            class="view-menu ctx-menu"
            role="menu"
            style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <For each={m().items}>
              {(it) => (
                <>
                  <Show when={it.separatorBefore}>
                    <div class="vm-sep" role="separator" />
                  </Show>
                  <button
                    role={it.checked != null ? 'menuitemradio' : 'menuitem'}
                    aria-checked={it.checked != null ? it.checked : undefined}
                    class="vm-item"
                    classList={{ disabled: !!it.disabled }}
                    disabled={it.disabled}
                    onClick={() => {
                      setMenu(null);
                      it.run();
                    }}
                  >
                    <Show when={m().items.some((x) => x.checked != null)}>
                      <span class="vm-check" aria-hidden="true">
                        <Show when={it.checked}>
                          <CheckIcon size={12} />
                        </Show>
                      </span>
                    </Show>
                    <span class="vm-label">{it.label}</span>
                  </button>
                </>
              )}
            </For>
          </div>
        </Portal>
      )}
    </Show>
  );
}
