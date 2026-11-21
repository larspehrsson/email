import { createResource, For, onCleanup, Show } from 'solid-js';
import { api, events, type SelectionInfo } from '../api';
import { forwardAsAttachments } from '../lib/compose';
import { fmtNum, fmtSize } from '../lib/format';
import { DRAG } from '../lib/platform';
import { MOD } from '../lib/shortcuts';
import { conversationMode } from '../lib/actions';
import { folderById, picked, selectedFolderId, setPicked } from '../state';
import { HeaderActions, type ActionTarget } from './Actions';
import { MailIcon } from './Icons';

// In the reader's place while several rows are picked (⌘/Ctrl-click, ⇧-click, Select All):
// what's picked, and the actions for all of them at once (eM Client's).

/** How many subjects to list under the count. */
const LISTED = 40;

export function MultiPane() {
  const key = () => {
    const f = selectedFolderId();
    return f == null ? null : { folderId: f, items: [...picked()], threaded: conversationMode() };
  };
  const [info, { refetch }] = createResource(key, (k) => api.selectionInfo(k.folderId, k.items, k.threaded));
  // Read, starred or tagged meanwhile: the bar follows.
  const un = events.onMessagesChanged(() => void refetch());
  onCleanup(() => void un.then((f) => f()));

  const target = (): ActionTarget | null => {
    const i: SelectionInfo | undefined = info.latest;
    const k = key();
    if (!i || !k || i.ids.length === 0) return null;
    const accountId = folderById(k.folderId)?.accountId;
    return {
      ids: i.ids,
      folderId: k.folderId,
      anyUnread: i.anyUnread,
      starId: null,
      starIds: i.ids,
      replyId: null,
      starred: i.allFlagged,
      advance: false,
      tagSets: i.tagSets,
      snoozedUntil: i.snoozedUntil,
      items: k.items,
      forwardAll: () =>
        accountId != null && forwardAsAttachments(accountId, i.ids.map((id, n) => ({ id, subject: i.subjects[n] ?? '', size: i.sizes[n] ?? 0 }))),
    };
  };
  const rows = () => picked().size;
  const what = () => (conversationMode() ? (rows() === 1 ? 'conversation' : 'conversations') : rows() === 1 ? 'message' : 'messages');

  return (
    <section class="reader multi-pane" aria-label="Several selected" tabIndex={-1}>
      <header class="reader-band" data-tauri-drag-region={DRAG}>
        <h1 class="reader-subject">
          {fmtNum(rows())} {what()} selected
        </h1>
        <div class="band-meta" data-tauri-drag-region={DRAG}>
          <Show when={info.latest}>
            {(i) => (
              <span>
                <Show when={conversationMode()}>
                  {fmtNum(i().ids.length)} messages ·{' '}
                </Show>
                {fmtSize(i().size)}
              </span>
            )}
          </Show>
          <HeaderActions target={target()} />
        </div>
      </header>
      <div class="multi-body">
        <MailIcon size={40} class="icon empty-icon" />
        <div class="multi-hint">
          The buttons above act on all of them. <kbd>Esc</kbd> or a click on one row picks just that one; {MOD}-click adds or
          takes away one, ⇧-click a range, {MOD}A all.
        </div>
        <Show when={info.latest}>
          {(i) => (
            <ul class="multi-list">
              <For each={i().subjects.slice(0, LISTED)}>{(s) => <li>{s || '(no subject)'}</li>}</For>
              <Show when={i().subjects.length > LISTED}>
                <li class="multi-more">…and {fmtNum(i().subjects.length - LISTED)} more</li>
              </Show>
            </ul>
          )}
        </Show>
        <button class="link-btn" onClick={() => setPicked([])}>
          Clear selection
        </button>
      </div>
    </section>
  );
}
