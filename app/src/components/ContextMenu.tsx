import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { api, errorMessage, type Folder } from '../api';
import { isFavorite, toggleFavorite } from '../lib/favorites';
import { fmtNum } from '../lib/format';
import { showToast } from './Toast';

// A right-click menu: the webview's own (Reload, Inspect…) is replaced by the app's, at the
// pointer. One at a time; any click elsewhere, Escape, scrolling or leaving the window closes it.

export interface MenuItem {
  label: string;
  disabled?: boolean;
  run: () => void;
}

const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);

export function openContextMenu(e: MouseEvent, items: MenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
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
                <button
                  role="menuitem"
                  class="vm-item"
                  classList={{ disabled: !!it.disabled }}
                  disabled={it.disabled}
                  onClick={() => {
                    setMenu(null);
                    it.run();
                  }}
                >
                  <span class="vm-label">{it.label}</span>
                </button>
              )}
            </For>
          </div>
        </Portal>
      )}
    </Show>
  );
}
