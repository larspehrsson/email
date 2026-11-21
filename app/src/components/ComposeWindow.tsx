import { createSignal, onMount, Show } from 'solid-js';
import { errorMessage } from '../api';
import { loadAccountsOnly } from '../state';
import { compose, loadDraft } from '../lib/compose';
import { endBoot } from '../lib/windows';
import { Composer } from './Composer';
import { ToastHost } from './Toast';
import { ConfirmHost } from './Actions';

/** The whole page of a compose window: one draft, written and sent from here. */
export function ComposeWindow() {
  const [error, setError] = createSignal<string | null>(null);
  /** Accounts and the draft are both in: the composer is drawn whole, as the outline goes. */
  const [ready, setReady] = createSignal(false);
  onMount(async () => {
    try {
      await Promise.all([loadAccountsOnly(), loadDraft()]);
    } catch (e) {
      setError(errorMessage(e));
    }
    setReady(true);
    // The composer (or the error) is in place under the outline: the outline goes.
    endBoot();
  });
  return (
    <div class="compose-window">
      <Show when={ready() && compose()?.key} keyed fallback={<p class="compose-error">{error() ?? ''}</p>}>
        {(_key) => <Composer />}
      </Show>
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}
