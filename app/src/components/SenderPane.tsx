import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from 'solid-js';
import { api, errorMessage, events, type Action, type MessageSummary, type SenderPage } from '../api';
import { folderById, revealMessage, selectedMessageId, selectedThread, setSenderPane } from '../state';
import { fmtNum, smartDate } from '../lib/format';
import { hint } from '../lib/shortcuts';
import { ArchiveIcon, CloseIcon, ReadIcon, TrashIcon } from './Icons';
import { hideToast, showToast } from './Toast';
import { cardFor, loadCards } from '../lib/addressBook';
import { openContacts } from './ContactsView';

// The sender pane (eM Client's contact sidebar, for mail): everything from the sender of the
// message on screen, in every folder but Trash and Spam, newest first. Tick some (or all) to
// archive, delete or mark them read at once: clearing out a newsletter takes two clicks.

const PAGE = 300;

interface Who {
  accountId: number;
  addr: string;
}

export function SenderPane() {
  const [page, setPage] = createSignal<SenderPage | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [picked, setPicked] = createSignal<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = createSignal(false);
  /** The one ticked last (for shift-click ranges). */
  let anchor: number | null = null;
  let who: Who | null = null;
  let seq = 0;

  /** The message the pane follows: the one open, or the conversation's newest. */
  const source = createMemo(() => selectedMessageId() ?? selectedThread()?.latestMessageId ?? null);

  async function load(from: { messageId: number } | Who, limit: number, keepPicked: boolean) {
    const my = ++seq;
    setLoading(true);
    try {
      const p = await api.senderMessages(from, 0, limit);
      if (my !== seq) return;
      const same = !!p && !!who && p.accountId === who.accountId && p.addr.toLowerCase() === who.addr.toLowerCase();
      batch(() => {
        setError(null);
        if (!p) {
          if (!('messageId' in from)) setPage(null);
          return;
        }
        who = { accountId: p.accountId, addr: p.addr };
        setPage(p);
        if (!same || !keepPicked) {
          setPicked(new Set<number>());
          anchor = null;
        } else {
          const ids = new Set(p.messages.map((m) => m.id));
          setPicked(new Set([...picked()].filter((id) => ids.has(id))));
        }
      });
    } catch (e) {
      if (my === seq) setError(errorMessage(e));
    } finally {
      if (my === seq) setLoading(false);
    }
  }

  // Follow the message on screen (a moment after it settles: arrowing down the list shouldn't
  // ask for every sender on the way).
  let follow: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(source, (id) => {
      clearTimeout(follow);
      if (id == null) return;
      follow = setTimeout(() => void load({ messageId: id }, PAGE, true), 120);
    }),
  );
  onCleanup(() => clearTimeout(follow));

  // Mail changed (arrived, deleted, read here or elsewhere): look again, keeping what's ticked.
  let again: ReturnType<typeof setTimeout> | undefined;
  const un = events.onMessagesChanged(() => {
    clearTimeout(again);
    again = setTimeout(() => {
      if (who) void load(who, Math.max(PAGE, untrack(page)?.messages.length ?? 0), true);
    }, 300);
  });
  onCleanup(() => {
    clearTimeout(again);
    void un.then((f) => f());
  });

  const rows = () => page()?.messages ?? [];
  const total = () => page()?.total ?? 0;
  const allPicked = () => rows().length > 0 && rows().every((m) => picked().has(m.id));
  const somePicked = () => picked().size > 0 && !allPicked();

  function toggle(m: MessageSummary, i: number, shift: boolean) {
    const next = new Set(picked());
    const on = !next.has(m.id);
    if (shift && anchor != null) {
      const a = rows().findIndex((r) => r.id === anchor);
      if (a >= 0) {
        const [lo, hi] = a < i ? [a, i] : [i, a];
        for (const r of rows().slice(lo, hi + 1)) on ? next.add(r.id) : next.delete(r.id);
      }
    } else if (on) next.add(m.id);
    else next.delete(m.id);
    anchor = m.id;
    setPicked(next);
  }

  function toggleAll() {
    setPicked(allPicked() ? new Set<number>() : new Set(rows().map((m) => m.id)));
  }

  /** Every one there is (more than the pane has loaded). */
  async function pickEverything() {
    if (!who) return;
    await load(who, total(), true);
    setPicked(new Set(rows().map((m) => m.id)));
  }

  /** Apply `action` to the ticked ones: one action per folder they're in, one Undo for all. */
  async function act(action: Action, label: string) {
    const chosen = rows().filter((m) => picked().has(m.id));
    if (!chosen.length || busy()) return;
    const byFolder = new Map<number, number[]>();
    for (const m of chosen) byFolder.set(m.folderId, [...(byFolder.get(m.folderId) ?? []), m.id]);
    setBusy(true);
    const ops: number[] = [];
    try {
      for (const [folderId, ids] of byFolder) {
        const res = await api.applyAction(action, ids, folderId);
        if (res.opId != null && res.undoable) ops.push(res.opId);
      }
      setPicked(new Set<number>());
      if (action.kind === 'read') return;
      const n = chosen.length;
      const toast = showToast({
        kind: 'ok',
        text: `${label} ${n === 1 ? '1 message' : `${fmtNum(n)} messages`}`,
        action: ops.length
          ? {
              label: 'Undo',
              run: () => {
                hideToast(toast);
                void Promise.all(ops.map((op) => api.undoAction(op))).catch((e) =>
                  showToast({ kind: 'error', text: errorMessage(e) }),
                );
              },
            }
          : undefined,
        ms: 6000,
      });
    } catch (e) {
      showToast({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const name = () => page()?.name || page()?.addr || '';
  void loadCards().catch(() => {});

  return (
    <aside class="sender-pane" aria-label="Messages from this sender">
      <header class="sp-head">
        <div class="sp-who">
          <Show when={page()} fallback={<div class="sp-name sp-dim">Sender</div>}>
            <div class="sp-name" title={name()}>
              {name()}
            </div>
            <div class="sp-addr" title={page()!.addr}>
              {page()!.addr}
            </div>
            <Show
              when={cardFor(page()!.addr)}
              fallback={
                <button class="link-btn sp-card" onClick={() => openContacts({ name: page()!.name, email: page()!.addr })}>
                  + Add to contacts
                </button>
              }
            >
              {(c) => (
                <button class="link-btn sp-card" title="Open in the address book" onClick={() => openContacts({ id: c().id })}>
                  In contacts
                </button>
              )}
            </Show>
          </Show>
        </div>
        <button class="icon-btn" title={`Close (${hint('sender')})`} aria-label="Close sender panel" onClick={() => setSenderPane(false)}>
          <CloseIcon />
        </button>
      </header>
      <Show
        when={page()}
        fallback={
          <div class="sp-empty">{error() ?? (loading() ? '' : 'Select a message to see everything from its sender.')}</div>
        }
      >
        <div class="sp-bar">
          <label class="sp-all" title={allPicked() ? 'Untick all' : 'Tick all'}>
            <input
              type="checkbox"
              checked={allPicked()}
              ref={(el) => createEffect(() => (el.indeterminate = somePicked()))}
              onChange={toggleAll}
              aria-label="Tick all"
            />
            <span>
              <Show when={picked().size > 0} fallback={`${fmtNum(total())} ${total() === 1 ? 'message' : 'messages'}`}>
                {fmtNum(picked().size)} ticked
              </Show>
            </span>
          </label>
          <span class="sp-fill" />
          <Show when={picked().size > 0}>
            <button class="icon-btn" title="Mark read" aria-label="Mark read" disabled={busy()} onClick={() => void act({ kind: 'read' }, 'Marked read')}>
              <ReadIcon />
            </button>
            <button class="icon-btn" title="Archive" aria-label="Archive" disabled={busy()} onClick={() => void act({ kind: 'archive' }, 'Archived')}>
              <ArchiveIcon />
            </button>
            <button class="icon-btn sp-delete" title="Delete" aria-label="Delete" disabled={busy()} onClick={() => void act({ kind: 'trash' }, 'Deleted')}>
              <TrashIcon />
            </button>
          </Show>
        </div>
        <Show when={allPicked() && total() > rows().length}>
          <button class="link-btn sp-everything" onClick={() => void pickEverything()}>
            Tick all {fmtNum(total())}
          </button>
        </Show>
        <div class="sp-list" role="list">
          <For each={rows()}>
            {(m, i) => (
              <div
                role="listitem"
                class="sp-row"
                classList={{ unread: m.unread, on: picked().has(m.id), current: m.id === source() }}
                onClick={(e) => {
                  if ((e.target as Element).closest('input')) return;
                  revealMessage(m.folderId, m.id);
                }}
              >
                <input
                  type="checkbox"
                  class="sp-check"
                  checked={picked().has(m.id)}
                  aria-label={`Tick “${m.subject || '(no subject)'}”`}
                  onClick={(e) => {
                    e.preventDefault();
                    toggle(m, i(), e.shiftKey);
                  }}
                />
                <div class="sp-text">
                  <div class="sp-line1">
                    <span class="sp-subject">{m.subject || '(no subject)'}</span>
                    <span class="sp-date">{smartDate(m.date)}</span>
                  </div>
                  <div class="sp-line2">
                    <span class="sp-folder">{folderById(m.folderId)?.displayName ?? ''}</span>
                    <Show when={m.snippet}>
                      <span class="sp-snippet"> — {m.snippet}</span>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </For>
          <Show when={total() > rows().length}>
            <button class="link-btn sp-more" onClick={() => who && void load(who, rows().length + PAGE, true)}>
              Show more ({fmtNum(total() - rows().length)} older)
            </button>
          </Show>
        </div>
      </Show>
    </aside>
  );
}
