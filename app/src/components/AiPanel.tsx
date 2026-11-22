import { createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { api, errorMessage, type AiRequest, type AiTask } from '../api';
import { startAi, type AiRun } from '../lib/ai';
import { clipOriginal, htmlToText, textToHtml } from '../lib/aiText';
import { CloseIcon } from './Icons';

// Writing help in the composer: say what to write (a reply, a new message), or have what's
// written rewritten. The answer shows here as it's written; nothing changes in the message
// until "Use this".

const STYLES: { style: Extract<AiTask, { kind: 'rewrite' }>['style']; label: string }[] = [
  { style: 'improve', label: 'Improve' },
  { style: 'shorter', label: 'Shorter' },
  { style: 'formal', label: 'More formal' },
  { style: 'friendly', label: 'Friendlier' },
  { style: 'proofread', label: 'Fix spelling' },
];
const LANGUAGES = ['English', 'Swedish', 'German', 'French', 'Spanish', 'Danish', 'Norwegian', 'Finnish', 'Dutch'];

const parse = (h: string) => new DOMParser().parseFromString(h, 'text/html');

export function AiPanel(props: {
  mode: 'new' | 'reply' | 'replyAll' | 'forward';
  /** who's writing, what to whom, what's written (HTML), and the original (HTML) */
  context: () => { me: string; subject: string; to: string[]; html: string; quoteHtml: string | null };
  /** Put the result in the message (replacing what's written). */
  onUse: (html: string) => void;
  onClose: () => void;
}) {
  const [status] = createResource(() => api.aiStatus().catch(() => null));
  const [instruction, setInstruction] = createSignal('');
  const [text, setText] = createSignal('');
  const [running, setRunning] = createSignal(false);
  const [msg, setMsg] = createSignal<string | null>(null);
  const [lastTask, setLastTask] = createSignal<AiTask | null>(null);
  let run: AiRun | null = null;
  onCleanup(() => run?.cancel());

  const replying = () => props.mode === 'reply' || props.mode === 'replyAll';
  const hasDraft = () => htmlToText(props.context().html, parse).length > 0;

  async function go(task: AiTask) {
    if (running()) return;
    const c = props.context();
    const request: AiRequest = {
      me: c.me,
      subject: c.subject,
      to: c.to,
      original: c.quoteHtml ? clipOriginal(htmlToText(c.quoteHtml, parse)) : null,
      draft: htmlToText(c.html, parse),
      instruction: instruction(),
    };
    setLastTask(task);
    setText('');
    setMsg(null);
    setRunning(true);
    try {
      run = await startAi(task, request, setText);
      const o = await run.done;
      if (o.refused) setMsg('Claude declined to write this one.');
      else if (o.truncated) setMsg('The answer was cut short.');
    } catch (e) {
      const m = errorMessage(e);
      if (m !== 'Stopped.') setMsg(m);
    } finally {
      run = null;
      setRunning(false);
    }
  }

  const write = () => go(replying() ? { kind: 'reply' } : { kind: 'compose' });

  return (
    <div class="ai-panel" role="region" aria-label="Writing help" onMouseDown={(e) => e.stopPropagation()}>
      <div class="ai-head">
        <span class="ai-title">✨ Writing help</span>
        <button class="icon-btn" aria-label="Close writing help" title="Close" onClick={() => props.onClose()}>
          <CloseIcon size={12} />
        </button>
      </div>
      <Show
        when={status() === undefined || status()?.configured}
        fallback={
          <p class="ai-note">
            Add your Anthropic API key in Settings › AI (in the main window), then come back here.
          </p>
        }
      >
        <div class="ai-ask">
          <textarea
            ref={(el) => queueMicrotask(() => el.focus())}
            class="ai-input"
            rows={2}
            placeholder={
              replying()
                ? 'What should the reply say? e.g. “yes, Thursday works, ask about parking” (or leave empty)'
                : hasDraft()
                  ? 'Anything to add or change? (optional)'
                  : 'What should it say? e.g. “ask Anna if lunch Thursday at 12 works”'
            }
            aria-label="What to write"
            value={instruction()}
            onInput={(e) => setInstruction(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void write();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (running()) run?.cancel();
                else props.onClose();
              }
            }}
          />
          <button class="btn primary ai-go" disabled={running() || (!replying() && !instruction().trim())} onClick={() => void write()}>
            {replying() ? 'Write reply' : 'Write'}
          </button>
        </div>
        <Show when={hasDraft()}>
          <div class="ai-chips" role="group" aria-label="Rewrite what's written">
            <span class="ai-chips-label">Rewrite:</span>
            <For each={STYLES}>
              {(s) => (
                <button class="chip-toggle ai-chip" disabled={running()} onClick={() => void go({ kind: 'rewrite', style: s.style })}>
                  {s.label}
                </button>
              )}
            </For>
            <select
              class="ai-lang"
              aria-label="Translate into"
              disabled={running()}
              value=""
              onChange={(e) => {
                const language = e.currentTarget.value;
                e.currentTarget.value = '';
                if (language) void go({ kind: 'translate', language });
              }}
            >
              <option value="">Translate…</option>
              <For each={LANGUAGES}>{(l) => <option value={l}>{l}</option>}</For>
            </select>
          </div>
        </Show>
        <Show when={running() || text() || msg()}>
          <div class="ai-result" aria-live="polite">
            <Show when={text()} fallback={<Show when={running()}><span class="ai-wait">Writing…</span></Show>}>
              <div class="ai-text">{text()}</div>
            </Show>
            <Show when={msg()}>
              <p class="ai-msg">{msg()}</p>
            </Show>
          </div>
          <div class="ai-actions">
            <Show
              when={!running()}
              fallback={
                <button class="btn secondary" onClick={() => run?.cancel()}>
                  Stop
                </button>
              }
            >
              <Show when={lastTask()}>
                {(t) => (
                  <button class="btn secondary" onClick={() => void go(t())}>
                    Try again
                  </button>
                )}
              </Show>
              <Show when={text().trim()}>
                <button
                  class="btn primary"
                  onClick={() => {
                    props.onUse(textToHtml(text()));
                    props.onClose();
                  }}
                >
                  {hasDraft() ? 'Replace my text' : 'Use this'}
                </button>
              </Show>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
