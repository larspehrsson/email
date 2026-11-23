import { Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { msgDrag } from '../lib/messageDrag';
import { MailIcon } from './Icons';

/** What a message drag carries: a small card at the pointer, lit up over a folder that takes it. */
export function MessageDragGhost() {
  const n = (d: { ids: number[] | null; rows: number }) => d.ids?.length ?? d.rows;
  return (
    <Show when={msgDrag()}>
      {(d) => (
        <Portal>
          <div
            class="drag-ghost"
            classList={{ ok: d().targetId != null }}
            style={{ left: `${d().x + 14}px`, top: `${d().y + 14}px` }}
            aria-hidden="true"
          >
            <span class="drag-ghost-icon">
              <MailIcon size={14} />
            </span>
            <span class="drag-ghost-count">{n(d())}</span>
            <span>{n(d()) === 1 ? 'message' : 'messages'}</span>
          </div>
        </Portal>
      )}
    </Show>
  );
}
