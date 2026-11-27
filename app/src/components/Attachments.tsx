import { createEffect, createMemo, createResource, createRoot, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api, errorMessage, type Attachment } from '../api';
import { fmtSize } from '../lib/format';
import { showToast } from './Toast';
import { CloudIcon, DownloadIcon, FileIcon, ImageIcon } from './Icons';
import { openContextMenu, type MenuItem } from './ContextMenu';
import { parseQuery } from '../lib/query';
import { searchActive, searchFields, searchQuery } from '../state';

/** The words of the search being shown that are looked for in attachments (lowercase, no
 *  accents), a moment after typing stops; none while there's no search. */
const [attachmentWords, setAttachmentWords] = createSignal<string[]>([]);
{
  let t: ReturnType<typeof setTimeout> | undefined;
  createRoot(() =>
    createEffect(() => {
      const words = new Set<string>();
      if (searchActive()) {
        for (const term of parseQuery(searchQuery())) {
          if (term.neg) continue;
          if (term.field === 'attachment' || (term.field === 'any' && searchFields().includes('attachments'))) term.words.forEach((w) => words.add(w));
        }
      }
      const next = [...words].sort();
      clearTimeout(t);
      t = setTimeout(() => {
        if (next.join(' ') !== attachmentWords().join(' ')) setAttachmentWords(next);
      }, 300);
    }),
  );
}

export { ToastHost as AttachmentToast } from './Toast';

// ------------------------------------------------------------- actions (shared busy state)

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
type Action = 'open' | 'save';
/** "msgId:index" -> running action; shared so the chip and the popover agree. */
const [busy, setBusy] = createStore<Record<string, Action | undefined>>({});
const [savingAll, setSavingAll] = createStore<Record<number, boolean>>({});
const key = (messageId: number, a: Attachment) => `${messageId}:${a.index}`;

async function runAttachment(messageId: number, a: Attachment, action: Action) {
  const k = key(messageId, a);
  if (busy[k]) return;
  if (action === 'open' && !a.openable) action = 'save';
  setBusy(k, action);
  try {
    if (action === 'open') await api.openAttachment(messageId, a.index);
    else {
      const path = await api.saveAttachment(messageId, a.index);
      showToast({
        kind: 'ok',
        text: `Saved ${baseName(path)} to Downloads`,
        path,
      });
    }
  } catch (e) {
    showToast({ kind: 'error', text: errorMessage(e) });
  } finally {
    setBusy(k, undefined);
  }
}

async function saveAll(messageId: number, count: number) {
  if (savingAll[messageId]) return;
  setSavingAll(messageId, true);
  try {
    const paths = await api.saveAllAttachments(messageId);
    // "Show in folder" highlights the first file; they're all in Downloads.
    showToast({
      kind: 'ok',
      text: `Saved ${paths.length || count} attachments to Downloads`,
      path: paths[0],
    });
  } catch (e) {
    showToast({ kind: 'error', text: errorMessage(e) });
  } finally {
    setSavingAll(messageId, false);
  }
}

const isImage = (a: Attachment) => a.mime.startsWith('image/');
const sizeLabel = (a: Attachment) => `${a.downloaded ? '' : '~'}${fmtSize(a.size)}`;
const saveKey = (e: KeyboardEvent) =>
  (e.key === 'Enter' && e.shiftKey) || ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's');

function TypeIcon(props: { a: Attachment; busy: boolean; size?: number }) {
  return (
    <span class="att-icon">
      <Show when={!props.busy} fallback={<span class="spinner small" />}>
        {isImage(props.a) ? <ImageIcon size={props.size ?? 13} /> : <FileIcon size={props.size ?? 13} />}
      </Show>
    </span>
  );
}

// ------------------------------------------------------------- the chips

async function saveAs(messageId: number, a: Attachment) {
  const k = key(messageId, a);
  if (busy[k]) return;
  setBusy(k, 'save');
  try {
    const path = await api.saveAttachmentAs(messageId, a.index);
    if (path) showToast({ kind: 'ok', text: `Saved ${baseName(path)}`, path });
  } catch (e) {
    showToast({ kind: 'error', text: errorMessage(e) });
  } finally {
    setBusy(k, undefined);
  }
}

/** Open every attachment that can be opened; says how many couldn't (save those instead). */
async function openAll(messageId: number, list: Attachment[]) {
  const can = list.filter((a) => a.openable);
  for (const a of can) await runAttachment(messageId, a, 'open');
  const not = list.length - can.length;
  if (not > 0) {
    showToast({
      kind: 'ok',
      text: `${not} ${not === 1 ? 'attachment' : 'attachments'} can't be opened directly: save ${not === 1 ? 'it' : 'them'} instead`,
    });
  }
}

function attachmentMenu(e: MouseEvent, messageId: number, a: Attachment, list: Attachment[]) {
  const items: MenuItem[] = [
    {
      label: 'Open',
      disabled: !a.openable,
      run: () => void runAttachment(messageId, a, 'open'),
    },
    {
      label: 'Save to Downloads',
      run: () => void runAttachment(messageId, a, 'save'),
    },
    { label: 'Save As…', run: () => void saveAs(messageId, a) },
  ];
  if (list.length > 1) {
    items.push(
      {
        label: `Open All ${list.length}`,
        separatorBefore: true,
        disabled: !list.some((x) => x.openable),
        run: () => void openAll(messageId, list),
      },
      {
        label: `Save All ${list.length} to Downloads`,
        run: () => void saveAll(messageId, list.length),
      },
    );
  }
  openContextMenu(e, items);
}

function Chip(props: { messageId: number; a: Attachment; list: Attachment[]; match?: boolean }) {
  const b = () => busy[key(props.messageId, props.a)];
  const tip = () =>
    [
      `${props.a.name} · ${sizeLabel(props.a)}`,
      props.a.openable ? 'Click to open · right-click for more' : "Click to save: this file type can't be opened directly",
      !props.a.downloaded ? 'Will be downloaded from the server' : '',
      props.match ? 'Has a word you searched for' : '',
    ]
      .filter(Boolean)
      .join('\n');
  return (
    <button
      class="att-chip"
      classList={{ busy: !!b(), 'att-match': !!props.match }}
      aria-disabled={!!b()}
      aria-label={`${props.a.openable ? 'Open' : 'Save'} ${props.a.name}, ${fmtSize(props.a.size)}`}
      title={tip()}
      onClick={() => void runAttachment(props.messageId, props.a, 'open')}
      onContextMenu={(e) => attachmentMenu(e, props.messageId, props.a, props.list)}
      onKeyDown={(e) => {
        if (saveKey(e) || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          void runAttachment(props.messageId, props.a, saveKey(e) ? 'save' : 'open');
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          attachmentMenu(
            new MouseEvent('contextmenu', {
              clientX: r.left,
              clientY: r.bottom,
            }),
            props.messageId,
            props.a,
            props.list,
          );
        }
      }}
    >
      <TypeIcon a={props.a} busy={!!b()} size={14} />
      <span class="att-chip-name">{props.a.name}</span>
      <span class="att-chip-size">
        {sizeLabel(props.a)}
        <Show when={!props.a.downloaded}>
          <CloudIcon size={11} class="icon att-cloud" />
        </Show>
      </span>
    </button>
  );
}

/**
 * A message's attachments, under its header: one chip per file with its name and size. A click
 * opens it (or saves one that can't be opened); right-click for Open, Save to Downloads,
 * Save As…, and for several Open All / Save All. Clicks don't reach the header (which toggles
 * conversation cards).
 */
export function AttachmentChips(props: { messageId: number; list: Attachment[] }) {
  const saving = () => !!savingAll[props.messageId];
  // Up to three rows of chips; past that, "+N more" shows the rest (and "Show fewer" folds
  // them again). Most mail has a few, all shown; a long list doesn't push the text far down.
  const [shown, setShown] = createSignal(props.list.length);
  const [expanded, setExpanded] = createSignal(false);
  let row!: HTMLDivElement;
  const ROWS = 3;
  const fit = () => {
    const n = props.list.length;
    if (expanded()) return setShown(n);
    // Fewer until everything, the "+N more" chip included, is within the first three rows.
    for (let v = n; v >= 1; v--) {
      setShown(v);
      const items = [...row.children] as HTMLElement[];
      const first = items[0];
      if (!first) return;
      const gap = parseFloat(getComputedStyle(row).rowGap) || 0;
      // (a shorter link in a row sits lower than the chips: compare where items start)
      const limit = first.offsetTop + ROWS * (first.offsetHeight + gap) - gap;
      if (items.every((el) => el.offsetTop < limit)) return;
    }
  };
  createEffect(() => {
    void props.list;
    void expanded();
    fit();
  });
  onMount(() => {
    const ro = new ResizeObserver(() => fit());
    ro.observe(row);
    onCleanup(() => ro.disconnect());
    // The chips' widths change once the fonts are in, the row's own size doesn't: fit again.
    void document.fonts?.ready.then(() => fit());
  });
  // While a search is shown: which of them have a word of it (by name, or in their text).
  const [matches] = createResource(
    () => (attachmentWords().length ? { id: props.messageId, words: attachmentWords() } : null),
    ({ id, words }) => api.attachmentMatches(id, words).catch(() => [] as number[]),
  );
  const matched = createMemo(() => new Set(attachmentWords().length ? (matches() ?? []) : []));
  const rest = () => props.list.length - shown();
  const folded = () => rest() > 0;
  return (
    <div
      ref={row}
      class="att-chips"
      role="group"
      aria-label={`${props.list.length} ${props.list.length === 1 ? 'attachment' : 'attachments'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <For each={props.list.slice(0, shown())}>{(a) => <Chip messageId={props.messageId} a={a} list={props.list} match={matched().has(a.index)} />}</For>
      <Show when={folded()}>
        <button
          class="att-chip att-more"
          aria-expanded="false"
          title={props.list
            .slice(shown())
            .map((a) => a.name)
            .join('\n')}
          onClick={() => setExpanded(true)}
        >
          +{rest()} more
        </button>
      </Show>
      <Show when={expanded()}>
        <button class="link-btn att-fewer" aria-expanded="true" onClick={() => setExpanded(false)}>
          Show fewer
        </button>
      </Show>
      <Show when={props.list.length > 1}>
        <button
          class="link-btn att-save-all"
          aria-disabled={saving()}
          title={`Save all ${props.list.length} attachments to Downloads`}
          onClick={() => void saveAll(props.messageId, props.list.length)}
        >
          <Show when={!saving()} fallback={<span class="spinner small" />}>
            <DownloadIcon size={12} />
          </Show>
          Save all
        </button>
      </Show>
    </div>
  );
}
