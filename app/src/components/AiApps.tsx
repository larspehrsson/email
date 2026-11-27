import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { api, errorMessage, events, type McpConfirm, type McpSettings } from '../api';
import { accounts } from '../state';
import { platform } from '../lib/platform';
import { showToast } from './Toast';
import { clock } from '../lib/format';
import { Modal } from './Modal';

// AI apps (Claude Desktop, Claude Code, any MCP client) working with the mail: Settings › AI apps
// (what they may do, how to connect one, what they did), and the app's side of it while they
// work (a question before deleting or sending, a notice with Undo after).

const PERMS: { key: keyof McpSettings; label: string; note: string }[] = [
  { key: 'drafts', label: 'Write drafts', note: 'Messages and replies go to Drafts; you send them.' },
  { key: 'organize', label: 'Organize', note: 'Mark read or starred, tag, archive, move, snooze.' },
  { key: 'delete', label: 'Delete', note: 'Asks you here first, every time.' },
  { key: 'send', label: 'Send', note: 'Shows you the message here first, every time.' },
];

/** Settings › AI apps. */
export function AiAppsSection() {
  const [status, { mutate }] = createResource(() => api.mcpStatus());
  const [log, { refetch: refetchLog }] = createResource(() => api.mcpLog().catch(() => []));
  const [msg, setMsg] = createSignal<string | null>(null);
  const un = events.onMcpActivity(() => void refetchLog());
  onCleanup(() => void un.then((f) => f()));

  const s = () => status()?.settings;
  async function save(patch: Partial<McpSettings>) {
    const cur = s();
    if (!cur) return;
    const next = { ...cur, ...patch };
    mutate({ ...status()!, settings: next });
    try {
      await api.setMcpSettings(next);
      setMsg(null);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  const allowedAccount = (id: number) => s()?.accounts == null || s()!.accounts!.includes(id);
  function toggleAccount(id: number) {
    const all = (accounts() ?? []).map((a) => a.id);
    const cur = s()?.accounts ?? all;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    void save({ accounts: next.length === all.length ? null : next });
  }

  const desktopJson = () =>
    JSON.stringify({ mcpServers: { email: { command: status()?.command ?? '', args: ['--mcp'] } } }, null, 2);
  const codeCommand = () => `claude mcp add email -- "${status()?.command ?? ''}" --mcp`;
  const desktopConfigPath = () =>
    platform === 'windows' ? '%APPDATA%\\Claude\\claude_desktop_config.json' : platform === 'macos' ? '~/Library/Application Support/Claude/claude_desktop_config.json' : '~/.config/Claude/claude_desktop_config.json';
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => showToast({ kind: 'ok', text: 'Copied', ms: 1500 }),
      (e) => showToast({ kind: 'error', text: errorMessage(e) }),
    );
  const when = (ms: number) => new Date(ms).toLocaleString(undefined, clock({ weekday: 'short', hour: 'numeric', minute: '2-digit' }));

  return (
    <div class="st-body mcp">
      <p class="st-muted mcp-intro">
        Let AI apps such as Claude Desktop or Claude Code work with your mail through this app (MCP): find and read
        messages, write drafts, tidy up. They reach it only on this computer, only while it runs, and only as far as you
        allow here. What a message says is written by its sender: an AI app is told to treat it as information, never as
        your instructions, and deleting or sending always asks you first.
      </p>
      <Show when={s()}>
        {(st) => (
          <>
            <label class="mcp-row mcp-master">
              <input type="checkbox" checked={st().enabled} onChange={(e) => void save({ enabled: e.currentTarget.checked })} />
              <span>
                <b>Let AI apps use Email</b>
                <span class="st-muted"> — read and search mail, folders and contacts</span>
              </span>
            </label>
            <div class="mcp-perms" classList={{ off: !st().enabled }}>
              <For each={PERMS}>
                {(p) => (
                  <label class="mcp-row">
                    <input
                      type="checkbox"
                      disabled={!st().enabled}
                      checked={!!st()[p.key]}
                      onChange={(e) => void save({ [p.key]: e.currentTarget.checked } as Partial<McpSettings>)}
                    />
                    <span>
                      {p.label}
                      <span class="st-muted"> — {p.note}</span>
                    </span>
                  </label>
                )}
              </For>
              <div class="mcp-accounts">
                <span class="st-field-label">Accounts</span>
                <For each={accounts() ?? []}>
                  {(a) => (
                    <label class="mcp-row">
                      <input type="checkbox" disabled={!st().enabled} checked={allowedAccount(a.id)} onChange={() => toggleAccount(a.id)} />
                      <span>{a.email}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
            <Show when={msg()}>
              <p class="st-status error">{msg()}</p>
            </Show>
            <h4 class="mcp-head">Connect an AI app</h4>
            <p class="st-muted mcp-how">
              <b>Claude Desktop:</b> add this to <code>{desktopConfigPath()}</code> (Settings › Developer › Edit Config), then
              restart Claude.
            </p>
            <div class="mcp-code">
              <pre>{desktopJson()}</pre>
              <button class="btn secondary" onClick={() => copy(desktopJson())}>
                Copy
              </button>
            </div>
            <p class="st-muted mcp-how">
              <b>Claude Code</b> (and other MCP clients: the command, with <code>--mcp</code>):
            </p>
            <div class="mcp-code">
              <pre>{codeCommand()}</pre>
              <button class="btn secondary" onClick={() => copy(codeCommand())}>
                Copy
              </button>
            </div>
            <h4 class="mcp-head">What AI apps did</h4>
            <Show when={(log() ?? []).length > 0} fallback={<p class="st-muted">Nothing yet (this session).</p>}>
              <ul class="mcp-log">
                <For each={log()}>
                  {(l) => (
                    <li classList={{ declined: !l.ok }}>
                      <span class="mcp-log-when">{when(l.at)}</span>
                      <span class="mcp-log-what">
                        {l.summary} <span class="st-muted">· {l.client}</span>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

/** Questions from AI apps (delete, send) and notices of what they did, in the main window. */
export function AiAppsHost() {
  const [asks, setAsks] = createSignal<McpConfirm[]>([]);
  onMount(() => {
    const unAsk = events.onMcpConfirm((c) => setAsks((a) => [...a, c]));
    const unDone = events.onMcpConfirmDone((id) => setAsks((a) => a.filter((x) => x.id !== id)));
    const unAct = events.onMcpActivity((a) => {
      if (!a.ok) return;
      const undo = a.undoOp != null || a.undoSend != null;
      showToast({
        kind: 'ok',
        text: `${a.client}: ${a.summary}`,
        action: undo
          ? {
              label: 'Undo',
              run: () =>
                void (a.undoSend != null ? api.cancelSend(a.undoSend).then(() => undefined) : api.undoAction(a.undoOp!)).catch((e) =>
                  showToast({ kind: 'error', text: errorMessage(e) }),
                ),
            }
          : undefined,
        ms: undo ? 8000 : 4000,
      });
    });
    onCleanup(() => {
      for (const u of [unAsk, unDone, unAct]) void u.then((f) => f());
    });
  });
  const answer = (c: McpConfirm, allow: boolean) => {
    setAsks((a) => a.filter((x) => x.id !== c.id));
    void api.mcpAnswer(c.id, allow);
  };
  return (
    <Show when={asks()[0]}>
      {(c) => (
        <Modal label={c().title} role="alertdialog" class="confirm mcp-ask" backdropClass="confirm-backdrop" onClose={() => answer(c(), false)} onBackdrop={false}>
          <p class="mcp-ask-who">{c().client} asks:</p>
          <h3 class="mcp-ask-title">{c().title}</h3>
          <For each={c().lines}>{(l) => <p class="mcp-ask-line">{l}</p>}</For>
          <Show when={c().body}>
            <pre class="mcp-ask-body">{c().body}</pre>
          </Show>
          <div class="form-actions">
            <button class="btn secondary" onClick={() => answer(c(), false)}>
              Don't
            </button>
            <button class="btn danger" ref={(el) => queueMicrotask(() => el.focus())} onClick={() => answer(c(), true)}>
              {c().ok}
            </button>
          </div>
        </Modal>
      )}
    </Show>
  );
}
