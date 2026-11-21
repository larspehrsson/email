import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { api, errorMessage } from '../api';
import { startAi, type AiRun } from '../lib/ai';
import { CloseIcon } from './Icons';
import { showToast } from './Toast';

// A message's source (View › Show Source, ⌥⌘U, or right-click a message): the whole message as
// sent, headers first; and questions about it to Claude ("why wasn't this marked as spam?"),
// answered from the headers (the user's own API key; only when asked).

const [open, setOpen] = createSignal<number | null>(null);
export function openSource(messageId: number | null | undefined): void {
  if (messageId != null) setOpen(messageId);
}

const QUESTIONS = ['Why wasn’t this marked as spam?', 'Is this genuine, or phishing?', 'Who really sent it, and how did it get here?'];

/** The source as Claude gets it: every header, and the start of the body. */
function forAi(source: string): string {
  const split = source.search(/\r?\n\r?\n/);
  const head = split < 0 ? source : source.slice(0, split);
  const body = split < 0 ? '' : source.slice(split);
  const room = Math.max(4000, 60_000 - head.length);
  return head.slice(0, 60_000) + (body.length > room ? `${body.slice(0, room)}\n[… ${body.length - room} more characters not shown]` : body);
}

function SourceDialog(props: { id: number; onClose: () => void }) {
  const [source] = createResource(() => props.id, (id) => api.messageSource(id));
  const [ai] = createResource(() => api.aiStatus().catch(() => null));
  const [question, setQuestion] = createSignal('');
  const [answer, setAnswer] = createSignal('');
  const [asking, setAsking] = createSignal(false);
  const [msg, setMsg] = createSignal<string | null>(null);
  let run: AiRun | null = null;
  let card!: HTMLDivElement;
  onCleanup(() => run?.cancel());
  onMount(() => {
    card.focus();
    // On the window: focus can leave the dialog (a question's button is disabled while it's
    // answered), and Esc must still work. Over it, a confirmation handles its own.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.confirm-backdrop')) return;
      e.preventDefault();
      e.stopPropagation();
      if (asking()) run?.cancel();
      else props.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    onCleanup(() => window.removeEventListener('keydown', onKey, true));
  });

  const subject = () => /^subject:[ \t]*(.*(?:\r?\n[ \t].*)*)/im.exec(source() ?? '')?.[1]?.replace(/\r?\n[ \t]+/g, ' ') ?? '';

  async function ask(q = question()) {
    const src = source();
    if (!q.trim() || !src || asking()) return;
    setQuestion(q);
    setAnswer('');
    setMsg(null);
    setAsking(true);
    try {
      run = await startAi({ kind: 'ask', question: q }, { me: '', subject: '', to: [], original: forAi(src), draft: '', instruction: '' }, setAnswer);
      const o = await run.done;
      if (o.refused) setMsg('Claude declined to answer this one.');
    } catch (e) {
      const m = errorMessage(e);
      if (m !== 'Stopped.') setMsg(m);
    } finally {
      run = null;
      setAsking(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(source() ?? '');
      showToast({ kind: 'ok', text: 'Source copied', ms: 2000 });
    } catch (e) {
      showToast({ kind: 'error', text: errorMessage(e) });
    }
  }

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        ref={card}
        class="card modal source-view"
        role="dialog"
        aria-label="Message source"
        tabIndex={-1}
      >
        <header class="modal-head src-head">
          <h2 title={subject()}>Source{subject() ? `: ${subject()}` : ''}</h2>
          <span class="src-head-btns">
            <button class="btn secondary" disabled={!source()} onClick={() => void copy()}>
              Copy
            </button>
            <button class="icon-btn" aria-label="Close" title="Close (Esc)" onClick={() => props.onClose()}>
              <CloseIcon />
            </button>
          </span>
        </header>
        <Show when={!source.error} fallback={<p class="st-status error">{errorMessage(source.error)}</p>}>
          <pre class="src-text" tabIndex={0} aria-label="The message source">
            {source() ?? 'Loading…'}
          </pre>
        </Show>
        <section class="src-ask" aria-label="Ask about this message">
          <Show
            when={ai()?.configured}
            fallback={<p class="st-muted src-note">Questions about a message go to Claude with your own key: add one in Settings › AI.</p>}
          >
            <div class="src-chips">
              <For each={QUESTIONS}>
                {(q) => (
                  <button class="chip-toggle" disabled={asking() || !source()} onClick={() => void ask(q)}>
                    {q}
                  </button>
                )}
              </For>
            </div>
            <form
              class="src-form"
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <input
                class="st-input"
                type="text"
                placeholder="Ask Claude about this message: its headers, sender, spam checks…"
                aria-label="Question about this message"
                value={question()}
                onInput={(e) => setQuestion(e.currentTarget.value)}
              />
              <Show
                when={!asking()}
                fallback={
                  <button class="btn secondary" type="button" onClick={() => run?.cancel()}>
                    Stop
                  </button>
                }
              >
                <button class="btn primary" type="submit" disabled={!question().trim() || !source()}>
                  Ask
                </button>
              </Show>
            </form>
            <Show when={asking() || answer() || msg()}>
              <div class="src-answer" aria-live="polite">
                <Show when={answer()} fallback={<span class="st-muted">{asking() ? 'Reading the headers…' : ''}</span>}>
                  {answer()}
                </Show>
                <Show when={msg()}>
                  <p class="st-status error">{msg()}</p>
                </Show>
              </div>
            </Show>
            <p class="st-muted src-note">Only when you ask: the headers and the start of the body go to Anthropic.</p>
          </Show>
        </section>
      </div>
    </div>
  );
}

export function SourceHost() {
  return (
    <Show when={open()} keyed>
      {(id) => <SourceDialog id={id} onClose={() => setOpen(null)} />}
    </Show>
  );
}
