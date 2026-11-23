import { createEffect, on, onCleanup, onMount } from 'solid-js';
import { flyout, RAIL_W, setFlyout } from '../lib/layout';
import { folderById, selectedFolderId } from '../state';
import { msgDrag } from '../lib/messageDrag';
import { Sidebar } from './Sidebar';

/**
 * The full sidebar tree slid out over the list (rail mode). Overlay only: never resizes
 * anything. Opened explicitly; closes on Esc, a click outside, or picking a folder.
 */
export function Flyout(props: { width: number }) {
  let el!: HTMLDivElement;
  const close = () => setFlyout(false);

  // Picking a folder closes it.
  createEffect(on(selectedFolderId, close, { defer: true }));

  onMount(() => {
    // Open at the account being viewed: its section at the top.
    const acct = folderById(selectedFolderId() ?? -1)?.accountId;
    if (acct != null) {
      // The account's own section, not a favourite of it above the accounts.
      queueMicrotask(() => el.querySelector<HTMLElement>(`.account[data-account-id="${acct}"]`)?.scrollIntoView({ block: 'start' }));
    }
    if (flyout() === 'keyboard') {
      queueMicrotask(() => (el.querySelector<HTMLElement>('.account .folder.selected') ?? el.querySelector<HTMLElement>('.folder'))?.focus());
    }
    // The rail's own buttons toggle/switch the flyout themselves.
    const inside = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('.flyout, .rail, .modal-backdrop, .sync-popover, .move-picker, .view-menu');
    const onDown = (e: MouseEvent) => {
      if (inside(e.target)) return;
      // A press on a message row may become a drag into the flyout: decide on release.
      // A drag cancelled with Esc is over before the release: it counts all the same.
      if ((e.target as Element).closest?.('.list-scroll .row')) {
        let dragged = false;
        const move = () => {
          if (msgDrag()) dragged = true;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (!dragged && !msgDrag()) close();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        return;
      }
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      // Esc during a drag cancels the drag only (messageDrag), the flyout stays.
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop') || msgDrag()) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    // Clicks in the email body (an iframe) only show up as the window losing focus.
    const onBlur = () => close();
    window.addEventListener('blur', onBlur);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey, true);
    });
  });

  return (
    <div class="flyout" ref={el} style={{ left: `${RAIL_W}px`, width: `${props.width}px` }}>
      <Sidebar flyout />
    </div>
  );
}
