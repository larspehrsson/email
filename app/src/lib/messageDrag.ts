import { createSignal } from 'solid-js';
import { api } from '../api';
import { folderById } from '../state';
import { runAction } from './actions';

// Dragging messages from the list onto a folder (sidebar, rail, flyout, favorites). Pointer-based,
// like reordering accounts: HTML5 drag and drop is unreliable in the app's webviews. The folder
// under the pointer is found by its data-folder-id; only the same account's folders take the drop.

export interface MessageDrag {
  accountId: number;
  /** the folder the messages are viewed in (apply_action's folderId) */
  sourceFolderId: number;
  /** the messages being moved; null while selection_info is answering */
  ids: number[] | null;
  /** rows picked together (message or conversation ids), when several */
  items?: number[];
  /** how many rows are dragged: the ghost's count until the messages are known */
  rows: number;
  x: number;
  y: number;
  /** the folder the drop would land in (highlighted), or null */
  targetId: number | null;
}

const [msgDrag, setMsgDrag] = createSignal<MessageDrag | null>(null);
export { msgDrag };

export interface DragSource {
  accountId: number;
  sourceFolderId: number;
  /** a folder the drop would change nothing in (the message's own): not offered */
  excludeFolderId: number | null;
  threaded: boolean;
  /** the row pressed (a message id, or a conversation's when grouped) */
  rowId: number;
  /** rows picked together, when the pressed row is one of them */
  items?: number[];
}

/** Press on a message row: moving 5px drags it (or the rows picked with it) to a folder. */
export function startMessageDrag(e: MouseEvent, o: DragSource): void {
  if (e.button !== 0 || msgDrag()) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;
  let hoverEl: HTMLElement | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;

  const rowIds = o.items ?? [o.rowId];
  const idsPromise: Promise<number[]> =
    o.threaded || o.items
      ? api.selectionInfo(o.sourceFolderId, rowIds, o.threaded).then((r) => r.ids)
      : Promise.resolve([o.rowId]);

  const targetAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-folder-id]');
    const id = el ? Number(el.dataset.folderId) : NaN;
    const f = folderById(id);
    if (!f || !f.selectable || f.accountId !== o.accountId || f.id === o.excludeFolderId) return null;
    return f.id;
  };

  // Hovering a folded account (sidebar or rail) or a closed folder opens it, so its folders can
  // be reached. A folder by its chevron: a click on the row itself would open the folder.
  const watchExpand = (x: number, y: number) => {
    const el =
      document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('.account-head[aria-expanded="false"], .rail-marker[aria-expanded="false"], .folder[aria-expanded="false"]') ?? null;
    if (el === hoverEl) return;
    hoverEl = el;
    clearTimeout(hoverTimer);
    if (hoverEl) {
      hoverTimer = setTimeout(() => {
        const h = hoverEl;
        if (h?.matches('.folder')) h.querySelector<HTMLElement>('.disclosure')?.click();
        else h?.click();
      }, 550);
    }
  };

  // Near the top or bottom of the folder list, it scrolls to bring more folders under the pointer.
  const scrollLoop = () => {
    const d = msgDrag();
    if (!d) return;
    const el = document.elementFromPoint(d.x, d.y)?.closest<HTMLElement>('.sidebar-scroll, .rail-scroll');
    if (el) {
      const r = el.getBoundingClientRect();
      if (d.y < r.top + 32) el.scrollTop -= 10;
      else if (d.y > r.bottom - 32) el.scrollTop += 10;
    }
    // What's under a still pointer changes as the list scrolls or a folder opens: the drop goes
    // where it is now, not where it was.
    const now = targetAt(d.x, d.y);
    if (now !== d.targetId) setMsgDrag({ ...d, targetId: now });
    watchExpand(d.x, d.y);
    raf = requestAnimationFrame(scrollLoop);
  };

  const finish = (drop: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onCancel);
    clearTimeout(hoverTimer);
    cancelAnimationFrame(raf);
    document.body.classList.remove('dragging-message');
    const d = msgDrag();
    setMsgDrag(null);
    if (!drop || !d || d.targetId == null) return;
    const target = d.targetId;
    void idsPromise.then(
      (ids) => {
        if (ids.length) void runAction({ kind: 'move', targetFolderId: target }, { ids, folderId: o.sourceFolderId, advance: true, items: o.items });
      },
      () => {},
    );
  };
  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!started) {
      if (Math.hypot(dx, dy) < 5) return;
      started = true;
      document.body.classList.add('dragging-message');
      setMsgDrag({
        accountId: o.accountId,
        sourceFolderId: o.sourceFolderId,
        ids: null,
        items: o.items,
        rows: rowIds.length,
        x: ev.clientX,
        y: ev.clientY,
        targetId: null,
      });
      void idsPromise.then((ids) => setMsgDrag((d) => (d ? { ...d, ids } : d)), () => {});
      raf = requestAnimationFrame(scrollLoop);
    }
    watchExpand(ev.clientX, ev.clientY);
    setMsgDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY, targetId: targetAt(ev.clientX, ev.clientY) } : d));
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onCancel);
}
