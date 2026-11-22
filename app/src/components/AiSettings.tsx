import { createResource, createSignal, For, Show } from 'solid-js';
import { api, errorMessage } from '../api';
import { aiModel, MODEL_NAMES, setAiModel, startAi } from '../lib/ai';

// Settings › AI: the Anthropic API key (kept in the system keychain) and the model.

export function AiSection() {
  const [status, { refetch }] = createResource(() => api.aiStatus().catch(() => null));
  const [key, setKey] = createSignal('');
  const [msg, setMsg] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [testing, setTesting] = createSignal(false);

  async function save() {
    try {
      await api.aiSetKey(key().trim() || null);
      setKey('');
      await refetch();
      setMsg({ text: 'Saved in the system keychain.' });
    } catch (e) {
      setMsg({ text: errorMessage(e), error: true });
    }
  }
  async function remove() {
    try {
      await api.aiSetKey(null);
      await refetch();
      setMsg({ text: 'The key is gone from this computer.' });
    } catch (e) {
      setMsg({ text: errorMessage(e), error: true });
    }
  }
  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      let text = '';
      const run = await startAi(
        { kind: 'compose' },
        { me: '', subject: '', to: [], original: null, draft: '', instruction: 'Just the word "Works!", nothing else.' },
        (t) => (text = t),
      );
      const o = await run.done;
      setMsg({ text: `${text.trim() || '(no answer)'} — ${MODEL_NAMES[o.model]?.split(' —')[0] ?? o.model}` });
    } catch (e) {
      setMsg({ text: errorMessage(e), error: true });
    } finally {
      setTesting(false);
    }
  }

  const model = () => aiModel() ?? status()?.defaultModel ?? 'claude-opus-5-5';

  return (
    <div class="st-body">
      <p class="st-muted ai-intro">
        Help writing and replying, from Claude, with your own Anthropic API key: you pay Anthropic for what you use
        (usually a fraction of a cent per message), no subscription. Get a key at{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          console.anthropic.com
        </a>
        .
      </p>
      <div class="st-field">
        <span class="st-field-label">API key</span>
        <span class="st-field-value">
          <Show
            when={!status()?.configured}
            fallback={
              <>
                <span>Saved in the keychain</span>
                <button class="link-btn" onClick={() => void remove()}>
                  Remove
                </button>
                <button class="btn secondary st-field-action" disabled={testing()} onClick={() => void test()}>
                  {testing() ? 'Trying…' : 'Try it'}
                </button>
              </>
            }
          >
            <input
              class="st-input ai-key"
              type="password"
              placeholder="sk-ant-…"
              autocomplete="off"
              spellcheck={false}
              aria-label="Anthropic API key"
              value={key()}
              onInput={(e) => setKey(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && key().trim() && void save()}
            />
            <button class="btn primary" disabled={!key().trim()} onClick={() => void save()}>
              Save
            </button>
          </Show>
        </span>
      </div>
      <div class="st-field">
        <span class="st-field-label">Model</span>
        <span class="st-field-value">
          <select class="st-input ai-model" aria-label="Model" value={model()} onChange={(e) => setAiModel(e.currentTarget.value)}>
            <For each={status()?.models ?? Object.keys(MODEL_NAMES)}>{(m) => <option value={m}>{MODEL_NAMES[m] ?? m}</option>}</For>
          </select>
        </span>
      </div>
      <p class="st-status" classList={{ error: !!msg()?.error }}>
        {msg()?.text ?? ''}
      </p>
      <p class="st-muted ai-privacy">
        Only when you ask, and only what you ask about, goes to Anthropic: the message you’re replying to, what
        you’ve written, and your instruction. Nothing else leaves this computer for it.
      </p>
    </div>
  );
}
