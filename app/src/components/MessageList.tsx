import { type JSX, batch, on, createEffect, createMemo, createSelector, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { api, type Folder, type MessageSummary, type SearchField, type ThreadSummary } from '../api';
import { createPagedList } from '../lib/messageList';
import { dayStart, fmtNum, smartDate } from '../lib/format';
import {
  datePeriods,
  insertRow,
  labelDateCounts,
  layoutGroups,
  periodBounds,
  removeRows,
  startsGroup,
  startsThrough,
  type Group,
  type Period,
} from '../lib/listGroups';
import { highlightParts, highlightRegex } from '../lib/query';
import {
  accounts,
  listSort,
  mainView,
  rememberedSelection,
  rememberSelection,
  setRestorePending,
  conversationScope,
  setConversationScope,
  includeTrash,
  folderById,
  searchActive,
  searchQuery,
  searchScope,
  searchFields,
  toggleSearchField,
  setSearchQuery,
  setSearchScope,
  selectedMessageId,
  selectedThreadId,
  selectMessage,
  selectThread,
  setThreaded,
  threadedPref,
  selectFolderAtUnread,
  takeUnreadOnArrival,
  takeReveal,
  type Reveal,
  focusInConversation,
  revealRequest,
} from '../state';
import { CheckIcon, ClockIcon, FlagIcon, ForwardIcon, PaperclipIcon, ReplyIcon } from './Icons';

/** A clock among the row's markers while a snooze is waiting to go off (its time on hover). */
function SnoozeMark(props: { until?: number | null }) {
  return (
    <Show when={(props.until ?? 0) > Date.now() / 1000}>
      <span class="snooze-mark" title={`Snoozed until ${new Date(props.until! * 1000).toLocaleString()}`}>
        <ClockIcon size={12} class="icon marker" />
      </span>
    </Show>
  );
}
import { ViewMenuButton } from './ViewMenu';
import { TagDots, tintStyle } from './Tags';
import { climbToParent, FolderCrumbs, folderPathLabel } from './FolderSwitcher';
import { registerListNav, runShortcut } from '../lib/actions';
import { commandFor, hint } from '../lib/shortcuts';
import { hideToast, showToast } from './Toast';
import { badgeFor, railOrder } from './Sidebar';

import { DRAG, windowActive } from '../lib/platform';

type Item = MessageSummary | ThreadSummary;

/** Keys that scroll whatever has focus. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export const ROW_HEIGHT = 72;
/** A group's header (a period, a sender…), drawn above its first row. */
const GROUP_HEAD = 30;

/** The first day of the week here (0 Sunday, 1 Monday), for "Last week" and the like. */
const FIRST_DAY = (() => {
  try {
    const l = new Intl.Locale(navigator.language) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const info = l.getWeekInfo?.() ?? l.weekInfo;
    return info ? info.firstDay % 7 : 1;
  } catch {
    return 1;
  }
})();
/** Space above the first row and below the last, so they don't touch the list's edges. */
const LIST_PAD = 3;

/** The selected row's colours, set on the row itself (see styles.css, `.row:hover`): the
 *  selected background, and while the list has the focus the colours of its contents; grey
 *  while the window is in the background (keys go elsewhere). */
function selectedRowVars(selected: boolean, active: boolean, away = false): Record<string, string> {
  if (!selected) return {};
  if (away) return { '--row-bg': 'var(--sel-bg-away)' };
  if (!active) return { '--row-bg': 'var(--sel-bg-inactive)' };
  return {
    '--row-bg': 'var(--sel-bg)',
    '--rs-text': 'var(--sel-text)',
    '--rs-muted': 'var(--sel-muted)',
    '--rs-chip-bg': 'rgba(255, 255, 255, 0.22)',
    '--rs-chip-fg': '#fff',
    '--rs-mark': 'rgba(255, 255, 255, 0.28)',
    '--rs-ring': '0 0 0 1.5px rgba(255, 255, 255, 0.85)',
  };
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

function SkeletonRow() {
  return (
    <div class="row-inner skeleton" aria-hidden="true">
      <div class="sk-line sk-a" />
      <div class="sk-line sk-b" />
      <div class="sk-line sk-c" />
    </div>
  );
}

/** Text with matched query words wrapped in <mark>. */
function Hl(props: { text: string; re: RegExp | null }) {
  return (
    <Show when={props.re} fallback={props.text}>
      <For each={highlightParts(props.text, props.re)}>{(p) => (p.hit ? <mark>{p.t}</mark> : p.t)}</For>
    </Show>
  );
}

/** "Sending…" / "Not sent" in place of the date for our own outgoing mail. */
export function SendState(props: { m: { sending: boolean; sendFailed: boolean }; fallback: JSX.Element; class?: string }) {
  return (
    <Show when={props.m.sending || props.m.sendFailed} fallback={props.fallback}>
      <span class={`send-state ${props.class ?? 'row-date'}`} classList={{ failed: props.m.sendFailed }}>
        {props.m.sendFailed ? 'Not sent' : 'Sending…'}
      </span>
    </Show>
  );
}

function RowContent(props: { m: MessageSummary; re?: RegExp | null; subjRe?: RegExp | null; folderTag?: string }) {
  return (
    // A tag describes the message: shown as a bar in the first tag's colour beside the text
    // (unread dot stays at the edge); all tags appear as dots on the first line.
    <div class="row-inner" classList={{ tagged: (props.m.tags?.length ?? 0) > 0 }} style={tintStyle(props.m.tags ?? [])}>
      <span class="unread-dot" />
      <div class="row-line1">
        <span class="row-from">
          <Hl text={props.m.fromName || props.m.fromAddr} re={props.re ?? null} />
        </span>
        <Show when={props.folderTag}>
          <span class="folder-tag">{props.folderTag}</span>
        </Show>
        <TagDots tags={props.m.tags ?? []} />
        <span class="row-icons">
          <Show when={props.m.answered}>
            <ReplyIcon size={12} class="icon marker" />
          </Show>
          <Show when={props.m.forwarded}>
            <ForwardIcon size={12} class="icon marker" />
          </Show>
          <Show when={props.m.hasAttachments}>
            <PaperclipIcon size={13} class="icon clip" />
          </Show>
          <Show when={props.m.flagged}>
            <FlagIcon size={12} class="icon flag" />
          </Show>
          <SnoozeMark until={props.m.snoozedUntil} />
        </span>
        <SendState m={props.m} fallback={<span class="row-date">{smartDate(props.m.date)}</span>} />
      </div>
      <div class="row-line2">
        <span class="row-subject">
          <Hl text={props.m.subject || '(no subject)'} re={props.subjRe ?? props.re ?? null} />
        </span>
        <Show when={props.m.snippet}>
          <span class="row-snippet"> — {props.m.snippet}</span>
        </Show>
      </div>
    </div>
  );
}

const FIELD_LABEL: Record<SearchField, string> = { sender: 'Sender', recipients: 'Recipients', subject: 'Subject' };

export interface SearchSpec {
  accountId: number;
  /** null = all folders of the account */
  folderId: number | null;
  query: string;
  /** null = all fields */
  fields: SearchField[] | null;
}

function ThreadRowContent(props: { t: ThreadSummary; me: { name: string; email: string } | undefined }) {
  const people = () =>
    props.t.participants
      .map((p) => (props.me && (p === props.me.name || p.toLowerCase() === props.me.email.toLowerCase()) ? 'me' : p))
      .join(', ');
  return (
    <div class="row-inner" classList={{ tagged: (props.t.tags?.length ?? 0) > 0 }} style={tintStyle(props.t.tags ?? [])}>
      <span class="unread-dot" />
      <div class="row-line1">
        <span class="row-from">
          {people() || '(no sender)'}
        </span>
        <Show when={props.t.messageCount > 1}>
          <span class="thread-count">{props.t.messageCount}</span>
        </Show>
        <TagDots tags={props.t.tags ?? []} />
        <span class="row-icons">
          <Show when={props.t.answered}>
            <ReplyIcon size={12} class="icon marker" />
          </Show>
          <Show when={props.t.forwarded}>
            <ForwardIcon size={12} class="icon marker" />
          </Show>
          <Show when={props.t.hasAttachments}>
            <PaperclipIcon size={13} class="icon clip" />
          </Show>
          <Show when={props.t.flagged}>
            <FlagIcon size={12} class="icon flag" />
          </Show>
          <SnoozeMark until={props.t.snoozedUntil} />
        </span>
        <SendState m={props.t} fallback={<span class="row-date">{smartDate(props.t.date)}</span>} />
      </div>
      <div class="row-line2">
        <span class="row-subject">{props.t.subject || '(no subject)'}</span>
        <Show when={props.t.snippet}>
          <span class="row-snippet"> — {props.t.snippet}</span>
        </Show>
      </div>
    </div>
  );
}

/**
 * Virtualized folder list. `threaded` is fixed for the component's lifetime
 * (the parent remounts on toggle): rows are conversations from `list_threads`
 * or single messages from `list_messages`.
 */
export function MessageList(props: {
  folder: Folder;
  threaded: boolean;
  onOpen: () => void;
  /** When set, this instance shows search results (flat messages) instead of the folder. */
  search?: SearchSpec;
}) {
  /** Search mode is fixed per instance; the spec itself changes while it stays mounted. */
  const search = !!props.search;
  const threaded = props.threaded && !search;
  const rowPrefix = search ? 'sr-row' : 'row';
  /** The spec whose results are on screen (swapped in together with the rows). */
  const [applied, setApplied] = createSignal<SearchSpec | undefined>(props.search);
  const plainIn = (f: SearchField) => {
    const fs = applied()?.fields;
    return !fs || fs.includes(f);
  };
  const hlRe = createMemo(() => {
    const sp = applied();
    return sp ? highlightRegex(sp.query, 'from', plainIn('sender')) : null;
  });
  const hlSubjRe = createMemo(() => {
    const sp = applied();
    return sp ? highlightRegex(sp.query, 'subject', plainIn('subject')) : null;
  });
  const searchFetcher = (sp: SearchSpec) => (offset: number, limit: number) =>
    api
      .searchMessages(sp.accountId, sp.folderId, sp.query, offset, limit, sp.fields)
      .then((r) => ({ total: r.total, items: r.messages as Item[] }));
  const selectedId = threaded ? selectedThreadId : selectedMessageId;
  const select = (it: Item) => (threaded ? selectThread(it as ThreadSummary) : selectMessage(it as MessageSummary));
  let scrollEl!: HTMLDivElement;
  const [selIndex, setSelIndex] = createSignal(-1);
  /** The keyboard is in the list (the selected row shows in the accent colour then). */
  const [listFocused, setListFocused] = createSignal(false);
  /** Set when keyboard moves onto a row whose page hasn't loaded yet. */
  let pendingSelect = false;

  /** First visible message before a live update; used to keep the viewport visually still. */
  let anchor: { id: number; index: number; off: number } | null = null;

  const folderId = props.folder.id;
  /** Fixed for the component's life: the parent remounts the list when it changes. */
  const sort = search ? 'received' : untrack(listSort);
  const fetcher = props.search
    ? searchFetcher(props.search)
    : threaded
    ? (offset: number, limit: number) =>
        // Options read at fetch time; a change invalidates the pages (effect below).
        api.listThreads(folderId, offset, limit, conversationScope(), includeTrash()).then((r) => ({ total: r.total, items: r.threads as Item[] }))
    : (offset: number, limit: number) =>
        api.listMessages(folderId, offset, limit, sort).then((r) => ({ total: r.total, items: r.messages as Item[] }));

  // ---- groups: headers above the first row of each (search results have none)

  const [groups, setGroups] = createSignal<Group[]>([]);
  let periods: Period[] = [];
  let groupsGen = 0;
  /** Top of row `i`'s own content (below its group's header, if it starts one). */
  const rowTop = (i: number) => LIST_PAD + i * ROW_HEIGHT + GROUP_HEAD * startsThrough(groups(), i);
  /** The row at height `y` in the list. */
  function rowAt(y: number): number {
    let lo = 0;
    let hi = Math.max(0, count() - 1);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rowTop(mid) - (startsGroup(groups(), mid) ? GROUP_HEAD : 0) <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  /** Put in new groups without moving what's on screen (unless at the top: new mail shows). */
  function applyGroups(next: Group[]) {
    const y = scrollEl?.scrollTop ?? 0;
    const i = y > 0 ? rowAt(y) : -1;
    const off = i >= 0 ? y - rowTop(i) : 0;
    setGroups(next);
    virt.measure();
    if (i >= 0) scrollEl.scrollTop = rowTop(i) + off;
  }
  function refreshGroups() {
    if (search) return;
    const g = ++groupsGen;
    periods = sort === 'received' ? datePeriods(new Date(), FIRST_DAY) : [];
    api
      .listGroups(folderId, threaded, sort, periodBounds(periods))
      .then((res) => {
        if (g !== groupsGen) return;
        const named =
          sort === 'received'
            ? labelDateCounts(periods, res.map((r) => r.count))
            : res.map((r) => ({ label: r.label || (sort === 'from' ? '(no sender)' : '(no recipients)'), count: r.count }));
        applyGroups(layoutGroups(named));
      })
      .catch((e) => console.error('list_groups', e));
  }
  /** The group a row belongs in, by what it's grouped by (to put an undone row back). */
  function groupLabel(it: Item): string | undefined {
    if (sort === 'from') return (it as MessageSummary).fromName || (it as MessageSummary).fromAddr;
    if (sort === 'received') return periods.find((p) => it.date >= p.from)?.label ?? 'Older';
    return undefined;
  }

  const model = createPagedList<Item>(search ? null : folderId, fetcher, {
    onReset() {
      // New search results applied: top of list, keep selection only if still present.
      if (pendingSpec) setApplied(pendingSpec);
      pendingSelect = false;
      scrollEl.scrollTop = 0;
      const id = untrack(selectedId);
      const k = id == null ? -1 : model.indexOfId(id);
      setSelIndex(k);
      if (id != null && k < 0) selectMessage(null);
    },
    onInvalidate() {
      anchor = null;
      refreshGroups();
      if (scrollEl.scrollTop <= 0) return; // at the top: let new mail appear
      const index = rowAt(scrollEl.scrollTop);
      const m = model.row(index);
      if (m) anchor = { id: m.id, index, off: scrollEl.scrollTop - rowTop(index) };
    },
    onPageLoaded() {
      untrack(() => {
        if (anchor) {
          const j = model.indexOfId(anchor.id);
          if (j >= 0) {
            if (j !== anchor.index) scrollEl.scrollTop = rowTop(j) + anchor.off;
            anchor = null;
          }
        }
        // Keep selection pinned to the same message id.
        const id = selectedId();
        if (id == null) return;
        if (model.row(selIndex())?.id === id) return;
        const k = model.indexOfId(id);
        if (k >= 0) setSelIndex(k);
      });
    },
  });

  /** Spec of the reset in flight; becomes `applied` when its rows land. */
  let pendingSpec: SearchSpec | undefined;
  if (search) {
    // Spec changed (query / scope / fields / account): keep old rows until the new ones land.
    let lastKey = JSON.stringify(props.search);
    createEffect(() => {
      const sp = props.search;
      const key = JSON.stringify(sp);
      if (!sp || key === lastKey) return;
      lastKey = key;
      untrack(() => model.reset(searchFetcher(sp)));
      pendingSpec = sp;
    });
  }
  // Before the first page answers, show a plausible number of skeleton rows.
  if (threaded) {
    // Summaries depend on the conversation options: refetch visible pages, keep scroll + selection.
    createEffect(on([conversationScope, includeTrash], () => model.invalidate(), { defer: true }));
  }

  const count = () => model.state.total ?? (search ? 0 : threaded ? Math.min(props.folder.total, 40) : props.folder.total);
  const me = () => {
    const a = (accounts() ?? []).find((x) => x.id === props.folder.accountId);
    return a ? { name: a.displayName, email: a.email } : undefined;
  };

  const virt = createVirtualizer({
    get count() {
      return count();
    },
    getScrollElement: () => scrollEl,
    estimateSize: (i) => ROW_HEIGHT + (startsGroup(groups(), i) ? GROUP_HEAD : 0),
    paddingStart: LIST_PAD,
    paddingEnd: LIST_PAD,
    // …and keyboard moves / scrollToIndex keep that space visible at either end
    scrollPaddingStart: LIST_PAD,
    scrollPaddingEnd: LIST_PAD,
    overscan: 10,
  });

  if (!search) {
    refreshGroups();
    // Periods move on at midnight.
    createEffect(on(dayStart, () => refreshGroups(), { defer: true }));
  }

  createEffect(() => {
    const items = virt.getVirtualItems();
    const first = items[0]?.index ?? 0;
    const last = items[items.length - 1]?.index ?? 0;
    untrack(() => model.setVisibleRange(first, last));
  });

  // Resolve a pending keyboard selection once its page arrives.
  createEffect(() => {
    const i = selIndex();
    const m = model.row(i);
    if (pendingSelect && m) {
      pendingSelect = false;
      select(m);
    }
  });

  const isSelected = createSelector(selectedId);

  function selectIndex(i: number, scroll = true) {
    const n = count();
    if (n === 0) return;
    const idx = Math.max(0, Math.min(n - 1, i));
    setSelIndex(idx);
    const m = model.row(idx);
    if (m) {
      pendingSelect = false;
      select(m);
    } else {
      pendingSelect = true;
    }
    if (scroll) virt.scrollToIndex(idx, { align: 'auto' });
  }

  function pageRows() {
    return Math.max(1, Math.floor(scrollEl.clientHeight / ROW_HEIGHT) - 1);
  }

  /** Select row `idx`, expected to hold `id` (from the core): scrolls only if it's off screen. */
  async function goTo(idx: number, id: number) {
    const reveal = (i: number) => {
      const top = rowTop(i);
      if (top < scrollEl.scrollTop || top + ROW_HEIGHT > scrollEl.scrollTop + scrollEl.clientHeight) {
        virt.scrollToIndex(i, { align: 'center' });
      }
    };
    setSelIndex(idx);
    if (idx < count()) reveal(idx);
    let m = await model.rowAt(idx);
    let k = idx;
    if (m?.id !== id) {
      // the list shifted meanwhile: find it nearby
      k = model.indexOfId(id);
      m = k >= 0 ? model.row(k) : undefined;
    }
    if (!m) return;
    setSelIndex(k);
    select(m);
    queueMicrotask(() => reveal(k));
  }

  // A second N/P within this time confirms moving on to the next folder with unread mail.
  const CROSS_CONFIRM_MS = 5000;
  let crossing: { folderId: number; back: boolean; until: number; toast: number } | null = null;

  /** N: the next unread item below the selection, wrapping to the top; with `back` (P) the
   *  previous one above it, wrapping to the bottom (Thunderbird's N and P). */
  async function nextUnread(back = false) {
    const cur = untrack(selectedId);
    if (search) {
      // Results: look through what's loaded.
      const n = count();
      const from = selIndex() < 0 && back ? n : selIndex();
      for (let step = 1; step <= n; step++) {
        const i = (from + (back ? -step : step) + n) % n;
        const m = model.row(i);
        if (m?.unread && m.id !== cur) return selectIndex(i);
      }
      return;
    }
    const hit = await api.nextUnread(folderId, cur, threaded, back, sort);
    if (hit && hit.id !== cur) {
      crossing = null;
      await goTo(hit.index, hit.id);
      return;
    }
    // Nothing else unread here: on to the next folder with unread mail, in the rail's order
    // (across accounts, wrapping), after a second press, like Thunderbird's "Advance to…?".
    const order = railOrder();
    const at = order.findIndex((f) => f.id === folderId);
    let next: Folder | undefined;
    for (let s = 1; s < order.length; s++) {
      const f = order[(at + (back ? -s : s) + order.length * 2) % order.length]!;
      if (f.id !== folderId && f.role !== 'drafts' && badgeFor(f) > 0) {
        next = f;
        break;
      }
    }
    if (!next) {
      crossing = null;
      showToast({ kind: 'ok', text: 'No unread messages', ms: 2500 });
      return;
    }
    const target = next;
    const go = () => {
      if (crossing) hideToast(crossing.toast);
      crossing = null;
      selectFolderAtUnread(target.id, back);
    };
    if (crossing && crossing.folderId === target.id && crossing.back === back && Date.now() < crossing.until) {
      go();
      return;
    }
    const otherAccount = target.accountId !== props.folder.accountId;
    const where = `${otherAccount ? `${accounts()?.find((a) => a.id === target.accountId)?.email ?? ''} › ` : ''}${folderPathLabel(target)}`;
    const key = hint(back ? 'prev-unread' : 'next-unread').split(' / ')[0] || (back ? 'P' : 'N');
    const toast = showToast({
      kind: 'ok',
      text: `No more unread here. ${key} again for ${where} (${fmtNum(target.unread)})`,
      action: { label: 'Go', run: go },
      ms: CROSS_CONFIRM_MS,
    });
    crossing = { folderId: target.id, back, until: Date.now() + CROSS_CONFIRM_MS, toast };
  }

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    // In the reader the scrolling keys scroll the message (letter keys still work there).
    if (SCROLL_KEYS.has(e.key) && e.target instanceof Element && (e.target.matches('iframe, .reader') || e.target.closest('.plain, .conv-scroll')))
      return;
    // Enter/Space on a focused button, link or menu item activates it (popup triggers, toolbar…).
    if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.closest('button, a[href], summary, [role="button"], [role^="menuitem"], [role="option"]')) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (mainView() !== 'mail') return; // the address book is over the list
    // Only one list drives the keyboard: results while searching, the folder otherwise.
    if (!!search !== searchActive()) return;
    const cur = selIndex();
    // Keys come from the keymap (lib/shortcuts.ts), remappable in Settings.
    switch (commandFor(e)) {
      case 'next':
        selectIndex(cur < 0 ? 0 : cur + 1);
        break;
      case 'prev':
        selectIndex(cur < 0 ? 0 : cur - 1);
        break;
      case 'next-unread':
        void nextUnread();
        break;
      case 'prev-unread':
        void nextUnread(true);
        break;
      case 'first':
        selectIndex(0);
        break;
      case 'last':
        selectIndex(count() - 1);
        break;
      case 'page-down':
        selectIndex((cur < 0 ? 0 : cur) + pageRows());
        break;
      case 'page-up':
        selectIndex((cur < 0 ? 0 : cur) - pageRows());
        break;
      case 'open':
        if (cur < 0) selectIndex(0);
        props.onOpen();
        break;
      case 'threaded':
        if (search) return;
        setThreaded(!untrack(threadedPref));
        break;
      case 'scope':
        if (search) return;
        setConversationScope(conversationScope() === 'all' ? 'folder' : 'all');
        break;
      case 'escape':
        if (search) setSearchQuery('');
        else scrollEl.focus({ preventScroll: true });
        break;
      case 'parent':
        if (search || !climbToParent()) return;
        break;
      default:
        // Message actions: archive, delete, move, spam, read, star, undo, reply…, tags.
        if (runShortcut(e)) break;
        return;
    }
    e.preventDefault();
  }

  // Open a row by id once it's here: the folder's remembered item (per view mode,
  // Thunderbird-style) when entering it, or a message asked for by a notification or kept from a
  // search (`asked`: a message id, its conversation in conversation view; it replaces whatever
  // is selected, and its fallback runs if the folder doesn't have it).
  function openById(item: number, asked?: Reveal) {
    const force = asked != null;
    let disposed = false;
    onCleanup(() => {
      disposed = true;
      setRestorePending(false);
    });
    setRestorePending(true);
    // The empty reader stays quiet at most this long, then shows its hint as usual.
    const quietTimer = setTimeout(() => setRestorePending(false), 150);
    // index_of answers both questions at once: still in this folder, and where (any depth).
    let target = item;
    const where: Promise<number | null> = asked
      ? api.locateMessage(folderId, asked.id, threaded, sort).then((l) => {
          if (l) target = l.id;
          return l?.index ?? null;
        })
      : api.indexOf(folderId, item, threaded, sort);
    void where
      .catch(() => null)
      .then(async (idx) => {
        if (disposed) return;
        if (idx == null) {
          if (!force) rememberSelection(folderId, threaded, null);
          else asked?.fallback?.();
          return;
        }
        // The user may have picked something meanwhile: never override that.
        if (!force && untrack(selectedId) != null) return;
        // Scroll only if the row isn't on screen, then centred. (Before the first page lands the
        // list may not be that long yet, so this is repeated once the row is here.)
        const reveal = (i: number) => {
          const top = rowTop(i);
          if (top < scrollEl.scrollTop || top + ROW_HEIGHT > scrollEl.scrollTop + scrollEl.clientHeight) {
            virt.scrollToIndex(i, { align: 'center' });
          }
        };
        setSelIndex(idx);
        if (idx < count()) reveal(idx);
        // Open it as soon as its row (one page, fetched directly) is here.
        let m = await model.rowAt(idx);
        let k = idx;
        if (disposed || (!force && untrack(selectedId) != null)) return;
        if (m?.id !== target) {
          // List shifted between index_of and the page fetch: find it nearby.
          k = model.indexOfId(target);
          m = k >= 0 ? model.row(k) : undefined;
        }
        if (!m) return;
        setSelIndex(k);
        // A conversation: its reader opens the message asked for, not the newest.
        if (asked && threaded) focusInConversation(m.id, asked.id);
        select(m);
        queueMicrotask(() => reveal(k));
      })
      .finally(() => {
        clearTimeout(quietTimer);
        if (!disposed) setRestorePending(false);
      });
  }

  if (!search) {
    const revealed = takeReveal(folderId);
    const remembered = rememberedSelection(folderId, threaded);
    const kept = untrack(selectedId);
    if (revealed) openById(revealed.id, revealed);
    // Sorted another way with a message open: find it in the new order.
    else if (kept != null && !threaded) openById(kept, { folderId, id: kept });
    else if (remembered != null && kept == null) openById(remembered);
    // Asked for while this folder is already showing.
    createEffect(
      on(
        revealRequest,
        () => {
          const r = takeReveal(folderId);
          if (r) openById(r.id, r);
        },
        { defer: true },
      ),
    );
  }

  // Lets message actions open the next older row (own actions) and re-sync after undo.
  onCleanup(
    registerListNav(search ? 'search' : 'folder', {
      advance() {
        const cur = selIndex();
        const it = model.row(cur);
        if (!it) return null;
        // One update: the row goes, the rows below move up, and the next older one (now in the
        // same place) opens. The last row falls back to the newer one above.
        batch(() => {
          if (model.remove(new Set([it.id])) > 0) setGroups(removeRows(groups(), [cur]));
          const n = count();
          if (n > 0) selectIndex(Math.min(cur, n - 1));
          else threaded ? selectThread(null) : selectMessage(null);
        });
        return { id: it.id, index: cur, row: it };
      },
      step() {
        const cur = selIndex();
        const n = count();
        if (n > 1) selectIndex(cur + 1 < n ? cur + 1 : cur - 1);
      },
      putBack(r) {
        // The undone row returns to its place, selected, in one update.
        batch(() => {
          if (model.insert(r.row as Item, r.index)) {
            setGroups(insertRow(groups(), r.index, groupLabel(r.row as Item)));
            setSelIndex(r.index);
          }
          select(r.row as Item);
        });
      },
      refresh() {
        model.invalidate();
      },
      sync() {
        const id = untrack(selectedId);
        if (id == null) return;
        const k = model.indexOfId(id);
        if (k >= 0) {
          setSelIndex(k);
          virt.scrollToIndex(k, { align: 'auto' });
        }
      },
    }),
  );

  onMount(() => {
    window.addEventListener('keydown', onKey);
    // Results mount while the user types; don't steal focus from the search field.
    if (!search) scrollEl.focus({ preventScroll: true });
    // Arrived here with N/P from a folder with nothing left unread.
    const arrival = search ? null : takeUnreadOnArrival(folderId);
    if (arrival) void nextUnread(arrival.back);
  });
  onCleanup(() => window.removeEventListener('keydown', onKey));


  return (
    <section class="list" aria-label={search ? 'Search results' : 'Messages'}>
      <Show when={props.search}>
        {(sp) => (
          <header class="list-head search-head" data-tauri-drag-region={DRAG}>
            <div class="search-head-row" data-tauri-drag-region={DRAG}>
            <div class="list-title" data-tauri-drag-region={DRAG}>
              {/* The query itself is already in the search field; show only the outcome. */}
              <div class="list-sub search-count" data-tauri-drag-region={DRAG}>
                <span>
                  <Show when={model.state.total != null} fallback="Searching…">
                    {model.state.total === 0
                      ? 'No results'
                      : `${fmtNum(model.state.total ?? 0)} ${model.state.total === 1 ? 'result' : 'results'}`}
                  </Show>
                </span>
                {/* Reserved slot: visible while a newer query is pending, no layout shift. */}
                <span
                  class="spinner small search-pending"
                  classList={{
                    on: model.state.pending || model.state.total == null || searchQuery().trim() !== sp().query,
                  }}
                  aria-hidden="true"
                />
              </div>
            </div>
            <div class="segmented" role="radiogroup" aria-label="Search scope">
              <button
                role="radio"
                aria-checked={searchScope() === 'all'}
                classList={{ on: searchScope() === 'all' }}
                onClick={() => setSearchScope('all')}
              >
                All folders
              </button>
              <button
                role="radio"
                aria-checked={searchScope() === 'folder'}
                classList={{ on: searchScope() === 'folder' }}
                onClick={() => setSearchScope('folder')}
                title={props.folder.displayName}
              >
                {props.folder.displayName}
              </button>
            </div>
            </div>
            <div class="search-fields" role="group" aria-label="Search in" data-tauri-drag-region={DRAG}>
              <span class="search-fields-label" data-tauri-drag-region={DRAG}>Search in</span>
              <For each={['sender', 'recipients', 'subject'] as SearchField[]}>
                {(f) => (
                  <button
                    class="chip-toggle field-chip"
                    classList={{ on: searchFields().includes(f) }}
                    aria-pressed={searchFields().includes(f)}
                    title={`Match plain words in ${FIELD_LABEL[f].toLowerCase()} · ⌥/Alt-click: only ${FIELD_LABEL[f].toLowerCase()}`}
                    onClick={(e) => toggleSearchField(f, e.altKey)}
                  >
                    <span class="chip-check" aria-hidden="true">
                      <CheckIcon size={10} />
                    </span>
                    {FIELD_LABEL[f]}
                  </button>
                )}
              </For>
            </div>
          </header>
        )}
      </Show>
      <Show when={!search}>
      <header class="list-head" data-tauri-drag-region={DRAG}>
        <div class="list-title" data-tauri-drag-region={DRAG}>
          <FolderCrumbs folder={props.folder} />
          <div class="list-sub" data-tauri-drag-region={DRAG}>
            <Show when={threaded}>
              <span>
                {fmtNum(props.folder.syncedCount)} {props.folder.syncedCount === 1 ? 'message' : 'messages'}
              </span>
              <span class="dot-sep">·</span>
            </Show>
            <span>
              <Show when={model.state.total != null} fallback={threaded ? 'Conversations' : `${fmtNum(count())} messages`}>
                {fmtNum(model.state.total ?? 0)} {threaded ? (model.state.total === 1 ? 'conversation' : 'conversations') : 'messages'}
              </Show>
            </span>
            <Show when={props.folder.unread > 0}>
              <span class="dot-sep">·</span>
              <span>{fmtNum(props.folder.unread)} unread</span>
            </Show>
          </div>
        </div>
        <ViewMenuButton />
      </header>
      </Show>
      <div
        class="list-scroll"
        ref={scrollEl}
        tabIndex={0}
        role="listbox"
        aria-label={`${props.folder.displayName} messages`}
        aria-activedescendant={selIndex() >= 0 ? `${rowPrefix}-${selIndex()}` : undefined}
        onFocusIn={() => setListFocused(true)}
        onFocusOut={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setListFocused(false);
        }}
      >
        <Show when={model.state.total === 0}>
          <Show
            when={search}
            fallback={
              <div class="list-empty">
                <div class="list-empty-title">No messages</div>
                <div class="list-empty-sub">This folder is empty.</div>
              </div>
            }
          >
            <div class="list-empty">
              <div class="list-empty-title">No results</div>
              <div class="list-empty-sub search-hint">
                <Show when={applied()?.fields}>
                  <div class="search-hint-fields">
                    Only searching {applied()!.fields!.map((f) => FIELD_LABEL[f].toLowerCase()).join(' and ')}.
                  </div>
                </Show>
                Try <code>from:</code>, <code>to:</code>, <code>subject:</code>, <code>"exact phrase"</code> or{' '}
                <code>-exclude</code>, <code>tag:work</code>
              </div>
            </div>
          </Show>
        </Show>
        <Show when={model.state.error && model.state.total == null}>
          <div class="list-empty">
            <div class="list-empty-title">Couldn’t load messages</div>
            <div class="list-empty-sub">{model.state.error}</div>
          </div>
        </Show>
        <div class="list-canvas" style={{ height: `${virt.getTotalSize()}px` }}>
          <For each={virt.getVirtualItems()}>
            {(item) => {
              const m = () => model.row(item.index);
              const head = () => startsGroup(groups(), item.index);
              return (
                <>
                <Show when={head()}>
                  {(g) => (
                    <div class="group-head" role="presentation" style={{ transform: `translateY(${item.start}px)` }}>
                      <span class="group-label">{g().label}</span>
                      <Show when={sort !== 'received'}>
                        <span class="group-count">{fmtNum(g().count)}</span>
                      </Show>
                    </div>
                  )}
                </Show>
                <div
                  id={`${rowPrefix}-${item.index}`}
                  role="option"
                  class="row"
                  data-id={m()?.id}
                  classList={{
                    selected: !!m() && isSelected(m()!.id),
                    unread: !!m()?.unread,
                  }}
                  aria-selected={!!m() && isSelected(m()!.id)}
                  style={{
                    transform: `translateY(${item.start + (head() ? GROUP_HEAD : 0)}px)`,
                    ...selectedRowVars(!!m() && isSelected(m()!.id), listFocused(), !windowActive()),
                  }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    selectIndex(item.index, false);
                  }}
                  onDblClick={() => props.onOpen()}
                >
                  <Show when={m()} fallback={<SkeletonRow />}>
                    {(it) =>
                      threaded ? (
                        <ThreadRowContent t={it() as ThreadSummary} me={me()} />
                      ) : (
                        <RowContent
                          m={it() as MessageSummary}
                          re={hlRe()}
                          subjRe={hlSubjRe()}
                          folderTag={
                            search && applied()?.folderId == null
                              ? folderById((it() as MessageSummary).folderId)?.displayName
                              : undefined
                          }
                        />
                      )
                    }
                  </Show>
                </div>
                </>
              );
            }}
          </For>
        </div>
      </div>
    </section>
  );
}
