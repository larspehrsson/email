import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { api, errorMessage } from '../api';
import { accounts } from '../state';
import { loadSignatures, reloadSignatures, setDefaultsHere, sigs } from '../lib/signatures';
import { confirmDialog } from './Actions';
import { MOD } from '../lib/shortcuts';

// Settings › Signatures: the list on the left, the one chosen on the right (saved as it's
// typed, like a draft), and each account's defaults below.

export function SignaturesSection() {
  const [current, setCurrent] = createSignal<number | null>(null);
  const [name, setName] = createSignal('');
  const [msg, setMsg] = createSignal<string | null>(null);
  const [tick, setTick] = createSignal(0);
  let nameInput!: HTMLInputElement;
  let editorEl!: HTMLDivElement;
  let editor: Editor | undefined;
  /** Loading a signature into the fields isn't a change to save. */
  let loading = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    editor = new Editor({
      element: editorEl,
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
          horizontalRule: false,
          link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
        }),
        Placeholder.configure({ placeholder: 'Your name, title, phone…' }),
      ],
      content: '',
      onUpdate: () => changed(),
      onTransaction: () => setTick((t) => t + 1),
    });
    onCleanup(() => editor?.destroy());
    void loadSignatures().then(
      (s) => setCurrent(s.signatures[0]?.id ?? null),
      (e) => setMsg(errorMessage(e)),
    );
  });
  onCleanup(() => {
    // Leaving with a change still waiting: keep it.
    if (saveTimer) {
      clearTimeout(saveTimer);
      void save();
    }
  });

  // The chosen one into the fields.
  createEffect(
    on(current, (id) => {
      const s = sigs().signatures.find((x) => x.id === id);
      loading = true;
      setName(s?.name ?? '');
      editor?.commands.setContent(s?.html ?? '');
      editor?.setEditable(s != null);
      loading = false;
      setMsg(null);
    }),
  );

  function changed() {
    if (loading || current() == null) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(), 500);
  }

  async function save() {
    saveTimer = undefined;
    const id = current();
    if (id == null || !editor) return;
    if (!name().trim()) {
      setMsg('A signature needs a name.');
      return;
    }
    try {
      await api.saveSignature(id, name(), editor.isEmpty ? '' : editor.getHTML());
      await reloadSignatures();
      setMsg(null);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  async function add() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      await save();
    }
    const n = sigs().signatures.length + 1;
    try {
      const id = await api.saveSignature(null, n === 1 ? 'Signature' : `Signature ${n}`, '');
      await reloadSignatures();
      setCurrent(id);
      queueMicrotask(() => {
        nameInput.focus();
        nameInput.select();
      });
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  async function remove() {
    const s = sigs().signatures.find((x) => x.id === current());
    if (!s || !(await confirmDialog(`Delete the signature “${s.name}”?`, 'Delete'))) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    try {
      await api.deleteSignature(s.id);
      await reloadSignatures();
      setCurrent(sigs().signatures[0]?.id ?? null);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  async function select(id: number) {
    if (id === current()) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      await save();
    }
    setCurrent(id);
  }

  const defaults = (accountId: number) => sigs().defaults.find((d) => d.accountId === accountId);
  async function setDefault(accountId: number, which: 'newId' | 'replyId', id: number | null) {
    const d = defaults(accountId);
    const next = { newId: d?.newId ?? null, replyId: d?.replyId ?? null, [which]: id };
    setDefaultsHere(accountId, next.newId, next.replyId);
    try {
      await api.setSignatureDefaults(accountId, next.newId, next.replyId);
      await reloadSignatures();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  const fmt = (label: string, mark: string, key: string, run: (e: Editor) => void) => (
    <button
      class="fmt-btn"
      tabIndex={-1}
      classList={{ on: (tick(), editor?.isActive(mark) ?? false) }}
      title={`${label}${key ? ` (${key})` : ''}`}
      aria-label={label}
      disabled={current() == null}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => editor && run(editor)}
    >
      {label === 'Bold' ? 'B' : label === 'Italic' ? 'I' : label === 'Underline' ? 'U' : '•'}
    </button>
  );

  return (
    <div class="st-body st-sigs">
      <div class="sig-cols">
        <div class="sig-list" role="listbox" aria-label="Signatures">
          <For each={sigs().signatures}>
            {(s) => (
              <button
                role="option"
                aria-selected={current() === s.id}
                class="sig-item"
                classList={{ on: current() === s.id }}
                onClick={() => void select(s.id)}
              >
                {s.name}
              </button>
            )}
          </For>
          <button class="link-btn sig-add" onClick={() => void add()}>
            + New signature
          </button>
        </div>
        <div class="sig-edit" classList={{ empty: current() == null }}>
          <input
            ref={nameInput}
            class="st-input sig-name"
            type="text"
            placeholder="Name"
            aria-label="Signature name"
            disabled={current() == null}
            value={name()}
            onInput={(e) => {
              setName(e.currentTarget.value);
              changed();
            }}
          />
          <div class="sig-toolbar" role="toolbar" aria-label="Formatting">
            {fmt('Bold', 'bold', `${MOD}B`, (e) => e.chain().focus().toggleBold().run())}
            {fmt('Italic', 'italic', `${MOD}I`, (e) => e.chain().focus().toggleItalic().run())}
            {fmt('Underline', 'underline', `${MOD}U`, (e) => e.chain().focus().toggleUnderline().run())}
            {fmt('Bulleted list', 'bulletList', '', (e) => e.chain().focus().toggleBulletList().run())}
            <span class="fmt-fill" />
            <Show when={current() != null}>
              <button class="link-btn sig-delete" onClick={() => void remove()}>
                Delete
              </button>
            </Show>
          </div>
          <div class="sig-editor cmp-editor" ref={editorEl} onMouseDown={(e) => e.target === e.currentTarget && editor?.commands.focus('end')} />
          <Show when={current() == null}>
            <p class="st-muted sig-none">No signatures yet. Add one, then choose where it’s used below.</p>
          </Show>
        </div>
      </div>
      <p class="st-status" classList={{ error: !!msg() }}>
        {msg() ?? ''}
      </p>
      <h4 class="sig-defaults-head">Use by default</h4>
      <div class="sig-defaults">
        <span class="st-field-label" />
        <span class="st-field-label">New messages</span>
        <span class="st-field-label">Replies and forwards</span>
        <For each={accounts() ?? []}>
          {(a) => (
            <>
              <span class="sig-acct" title={a.email}>
                {a.email}
              </span>
              <For each={['newId', 'replyId'] as const}>
                {(which) => (
                  <select
                    class="st-input sig-default"
                    aria-label={`${a.email}: ${which === 'newId' ? 'new messages' : 'replies and forwards'}`}
                    value={String(defaults(a.id)?.[which] ?? '')}
                    onChange={(e) => void setDefault(a.id, which, e.currentTarget.value ? Number(e.currentTarget.value) : null)}
                  >
                    <option value="">None</option>
                    <For each={sigs().signatures}>{(s) => <option value={String(s.id)}>{s.name}</option>}</For>
                  </select>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
