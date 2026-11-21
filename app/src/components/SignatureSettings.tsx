import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { api, errorMessage } from '../api';
import { accounts } from '../state';
import { loadSignatures, pictureForSignature, reloadSignatures, setDefaultsHere, sigs } from '../lib/signatures';
import { confirmDialog } from './Actions';
import { MOD } from '../lib/shortcuts';
import { ImageIcon } from './Icons';

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
  let pictureInput!: HTMLInputElement;

  /** Put pictures (pasted, dropped or chosen) in at the cursor (or at `pos`). */
  async function addPictures(files: File[], pos?: number) {
    for (const f of files.filter((f) => f.type.startsWith('image/'))) {
      try {
        const p = await pictureForSignature(f);
        if (!editor) return;
        // After what's selected (a picture just put in stays selected: not over it).
        const at = pos ?? editor.state.selection.to;
        editor.chain().focus().insertContentAt(at, { type: 'image', attrs: p }).run();
      } catch {
        setMsg(`Couldn’t read the picture ${f.name || ''}`.trim());
      }
    }
  }
  const pictures = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
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
        Placeholder.configure({ placeholder: 'Your name, title, phone… (paste or drop a logo too)' }),
        // Pictures sit in the text (a logo beside a name), drag a corner to size them; kept as
        // data: URLs, sent as inline parts (the core's compose::inline_images).
        Image.configure({
          inline: true,
          allowBase64: true,
          resize: { enabled: true, directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], alwaysPreserveAspectRatio: true, minWidth: 16, minHeight: 16 },
        }),
      ],
      editorProps: {
        handlePaste: (_view, event) => {
          const files = pictures(event.clipboardData?.files);
          if (!files.length) return false;
          void addPictures(files);
          return true;
        },
        handleDrop: (view, event) => {
          const files = pictures(event.dataTransfer?.files);
          if (!files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void addPictures(files, at);
          return true;
        },
      },
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
            <button
              class="fmt-btn sig-pic-btn"
              tabIndex={-1}
              title="Insert a picture (or paste or drop one)"
              aria-label="Insert picture"
              disabled={current() == null}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pictureInput.click()}
            >
              <ImageIcon />
            </button>
            <input
              ref={pictureInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={(e) => {
                const files = pictures(e.currentTarget.files);
                e.currentTarget.value = '';
                void addPictures(files);
              }}
            />
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
                  // Each option says whether it's the one chosen: the options are made anew
                  // whenever the signatures reload (a rename, another account's choice), and a
                  // select's own value would fall back to the first of them.
                  <select
                    class="st-input sig-default"
                    aria-label={`${a.email}: ${which === 'newId' ? 'new messages' : 'replies and forwards'}`}
                    onChange={(e) => void setDefault(a.id, which, e.currentTarget.value ? Number(e.currentTarget.value) : null)}
                  >
                    <option value="" selected={(defaults(a.id)?.[which] ?? null) === null}>
                      None
                    </option>
                    <For each={sigs().signatures}>
                      {(s) => (
                        <option value={String(s.id)} selected={defaults(a.id)?.[which] === s.id}>
                          {s.name}
                        </option>
                      )}
                    </For>
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
