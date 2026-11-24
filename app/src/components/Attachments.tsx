import { For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { api, errorMessage, type Attachment } from "../api";
import { fmtSize } from "../lib/format";
import { showToast } from "./Toast";
import { CloudIcon, DownloadIcon, FileIcon, ImageIcon } from "./Icons";
import { openContextMenu, type MenuItem } from "./ContextMenu";

export { ToastHost as AttachmentToast } from "./Toast";

// ------------------------------------------------------------- actions (shared busy state)

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
type Action = "open" | "save";
/** "msgId:index" -> running action; shared so the chip and the popover agree. */
const [busy, setBusy] = createStore<Record<string, Action | undefined>>({});
const [savingAll, setSavingAll] = createStore<Record<number, boolean>>({});
const key = (messageId: number, a: Attachment) => `${messageId}:${a.index}`;

async function runAttachment(messageId: number, a: Attachment, action: Action) {
  const k = key(messageId, a);
  if (busy[k]) return;
  if (action === "open" && !a.openable) action = "save";
  setBusy(k, action);
  try {
    if (action === "open") await api.openAttachment(messageId, a.index);
    else {
      const path = await api.saveAttachment(messageId, a.index);
      showToast({
        kind: "ok",
        text: `Saved ${baseName(path)} to Downloads`,
        path,
      });
    }
  } catch (e) {
    showToast({ kind: "error", text: errorMessage(e) });
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
      kind: "ok",
      text: `Saved ${paths.length || count} attachments to Downloads`,
      path: paths[0],
    });
  } catch (e) {
    showToast({ kind: "error", text: errorMessage(e) });
  } finally {
    setSavingAll(messageId, false);
  }
}

const isImage = (a: Attachment) => a.mime.startsWith("image/");
const sizeLabel = (a: Attachment) =>
  `${a.downloaded ? "" : "~"}${fmtSize(a.size)}`;
const saveKey = (e: KeyboardEvent) =>
  (e.key === "Enter" && e.shiftKey) ||
  ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s");

function TypeIcon(props: { a: Attachment; busy: boolean; size?: number }) {
  return (
    <span class="att-icon">
      <Show when={!props.busy} fallback={<span class="spinner small" />}>
        {isImage(props.a) ? (
          <ImageIcon size={props.size ?? 13} />
        ) : (
          <FileIcon size={props.size ?? 13} />
        )}
      </Show>
    </span>
  );
}

// ------------------------------------------------------------- the chips

async function saveAs(messageId: number, a: Attachment) {
  const k = key(messageId, a);
  if (busy[k]) return;
  setBusy(k, "save");
  try {
    const path = await api.saveAttachmentAs(messageId, a.index);
    if (path) showToast({ kind: "ok", text: `Saved ${baseName(path)}`, path });
  } catch (e) {
    showToast({ kind: "error", text: errorMessage(e) });
  } finally {
    setBusy(k, undefined);
  }
}

/** Open every attachment that can be opened; says how many couldn't (save those instead). */
async function openAll(messageId: number, list: Attachment[]) {
  const can = list.filter((a) => a.openable);
  for (const a of can) await runAttachment(messageId, a, "open");
  const not = list.length - can.length;
  if (not > 0) {
    showToast({
      kind: "ok",
      text: `${not} ${not === 1 ? "attachment" : "attachments"} can't be opened directly: save ${not === 1 ? "it" : "them"} instead`,
    });
  }
}

function attachmentMenu(
  e: MouseEvent,
  messageId: number,
  a: Attachment,
  list: Attachment[],
) {
  const items: MenuItem[] = [
    {
      label: "Open",
      disabled: !a.openable,
      run: () => void runAttachment(messageId, a, "open"),
    },
    {
      label: "Save to Downloads",
      run: () => void runAttachment(messageId, a, "save"),
    },
    { label: "Save As…", run: () => void saveAs(messageId, a) },
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

function Chip(props: { messageId: number; a: Attachment; list: Attachment[] }) {
  const b = () => busy[key(props.messageId, props.a)];
  const tip = () =>
    [
      `${props.a.name} · ${sizeLabel(props.a)}`,
      props.a.openable
        ? "Click to open · right-click for more"
        : "Click to save: this file type can't be opened directly",
      !props.a.downloaded ? "Will be downloaded from the server" : "",
    ]
      .filter(Boolean)
      .join("\n");
  return (
    <button
      class="att-chip"
      classList={{ busy: !!b() }}
      aria-disabled={!!b()}
      aria-label={`${props.a.openable ? "Open" : "Save"} ${props.a.name}, ${fmtSize(props.a.size)}`}
      title={tip()}
      onClick={() => void runAttachment(props.messageId, props.a, "open")}
      onContextMenu={(e) =>
        attachmentMenu(e, props.messageId, props.a, props.list)
      }
      onKeyDown={(e) => {
        if (saveKey(e) || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          void runAttachment(
            props.messageId,
            props.a,
            saveKey(e) ? "save" : "open",
          );
        } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          attachmentMenu(
            new MouseEvent("contextmenu", {
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
export function AttachmentChips(props: {
  messageId: number;
  list: Attachment[];
}) {
  const saving = () => !!savingAll[props.messageId];
  return (
    <div
      class="att-chips"
      role="group"
      aria-label={`${props.list.length} ${props.list.length === 1 ? "attachment" : "attachments"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <For each={props.list}>
        {(a) => <Chip messageId={props.messageId} a={a} list={props.list} />}
      </For>
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
