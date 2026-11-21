import { createSignal } from 'solid-js';
import { api, events, type AiOutcome, type AiRequest, type AiTask } from '../api';
import { loadPref, savePref } from './format';

// Writing help: Claude, with the user's own Anthropic API key (kept by the core in the system
// keychain). Settings › AI holds the key and the model; the composer asks.

export const MODEL_NAMES: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5 — best writing',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 — faster, cheaper',
  'claude-haiku-5-5': 'Claude Haiku 5.5 — fastest, cheapest',
};

/** The model chosen in Settings (null: the core's default). Shared by every window. */
const [aiModel, setAiModelSig] = createSignal<string | null>(loadPref<string | null>('ai.model', null));
export { aiModel };
export function setAiModel(m: string): void {
  setAiModelSig(m);
  savePref('ai.model', m);
}

/** A run under way: its text so far comes to `onText`; `cancel` stops it. */
export interface AiRun {
  done: Promise<AiOutcome>;
  cancel: () => void;
}

export async function startAi(task: AiTask, request: AiRequest, onText: (all: string) => void): Promise<AiRun> {
  const status = await api.aiStatus();
  const model = (aiModel() && status.models.includes(aiModel()!) ? aiModel() : status.defaultModel)!;
  const requestId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  let text = '';
  const unlisten = await events.onAiText((p) => {
    if (p.requestId !== requestId) return;
    text += p.text;
    onText(text);
  });
  // The answer carries the whole text: events may still be on their way when it comes.
  const done = api
    .aiRun(requestId, model, task, request)
    .then((o) => {
      onText(o.text);
      return o;
    })
    .finally(() => unlisten());
  return { done, cancel: () => void api.aiCancel(requestId).catch(() => {}) };
}
