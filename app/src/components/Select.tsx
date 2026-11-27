import { createEffect, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { ChevronIcon } from './Icons';

// A drop-down in the app's own look, in place of the system's <select>: the closed box like our
// buttons (rounded, our colors and chevron), and a menu like the View and Restore defaults
// menus, the chosen option checked. The keyboard works as with a <select>: ↓/↑, Enter or Space
// open it; in it, ↓/↑, Home/End and typing a name's first letters move, Enter or Space choose,
// Esc or Tab close. Esc closes only the menu (Settings and the composer leave it alone while one
// is open: `.sel-menu`).

export interface SelectOption<T> {
  value: T;
  label: string;
  /** Shown instead of `label` in the box when chosen (shorter). */
  short?: string;
  title?: string;
  disabled?: boolean;
  /** Greyed (in the box when chosen, and in the menu): a choice that stands for another (an
   *  address's signature that is the account's). */
  muted?: boolean;
}

export function Select<T>(props: {
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** What it's for, read out by screen readers (and the box's tooltip unless `title`). */
  label: string;
  title?: string;
  /** The box's text when no option is chosen, or always for a menu of actions (`action`). */
  placeholder?: string;
  /** A menu of actions ("Always load…"): the box always says `placeholder`, nothing is checked. */
  action?: boolean;
  /** 'field' (default): a bordered box, as in Settings; 'link': like the banner's links; 'plain':
   *  text and a chevron, for tight rows (the composer's). */
  variant?: 'field' | 'link' | 'plain';
  class?: string;
  disabled?: boolean;
  /** A heading over the options. */
  heading?: string;
  /** The menu's right edge under the box's (for a box near the right side). */
  alignRight?: boolean;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [at, setAt] = createSignal<{ top?: number; bottom?: number; left?: number; right?: number; minWidth: number }>({ minWidth: 0 });
  let box!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  let typed = '';
  let typedAt = 0;

  const chosen = () => (props.action ? undefined : props.options.find((o) => o.value === props.value));
  const shown = () => (props.action ? props.placeholder : (chosen()?.short ?? chosen()?.label ?? props.placeholder ?? ''));
  const items = () => [...(menu?.querySelectorAll<HTMLButtonElement>('.sel-item:not(:disabled)') ?? [])];

  function place() {
    const r = box.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    // Flip above when there's little room below and more above.
    const up = below < 220 && r.top > below;
    const horiz = props.alignRight ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) };
    setAt({ ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }), ...horiz, minWidth: r.width });
  }
  function show() {
    if (props.disabled) return;
    place();
    setOpen(true);
  }
  function close(refocus = true) {
    setOpen(false);
    if (refocus) box.focus();
  }
  function choose(o: SelectOption<T>) {
    if (o.disabled) return;
    close();
    if (props.action || o.value !== props.value) props.onChange(o.value);
  }
  function move(to: 'next' | 'prev' | 'first' | 'last') {
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const j = to === 'first' ? 0 : to === 'last' ? list.length - 1 : to === 'next' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    list[j]?.focus();
  }

  createEffect(() => {
    if (!open()) return;
    // The chosen option has the focus at first, or the first one.
    queueMicrotask(() => (menu?.querySelector<HTMLElement>('.sel-item.on:not(:disabled)') ?? items()[0])?.focus({ preventScroll: true }));
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu?.contains(t) && !box.contains(t)) close(false);
    };
    const onAway = (e: Event) => {
      // Scrolling the menu itself is fine; anything else moves the box from under it.
      if (e.type === 'scroll' && menu?.contains(e.target as Node)) return;
      close(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('scroll', onAway, true);
    window.addEventListener('resize', onAway);
    // Clicks in an email (an iframe) only show up as the window losing focus.
    window.addEventListener('blur', onAway);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('scroll', onAway, true);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('blur', onAway);
    });
  });

  function onMenuKey(e: KeyboardEvent) {
    // The menu's keys stop here: the composer and the app don't see them.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End' || e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      move(({ ArrowDown: 'next', ArrowUp: 'prev', Home: 'first', PageUp: 'first', End: 'last', PageDown: 'last' } as const)[e.key]);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== ' ') {
      // Type to find: the first option starting with what's been typed lately.
      const now = Date.now();
      typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      items()
        .find((el) => (el.textContent ?? '').trim().toLowerCase().startsWith(typed))
        ?.focus();
    }
  }

  return (
    <>
      <button
        ref={box}
        type="button"
        class={`sel sel-${props.variant ?? 'field'}${props.class ? ` ${props.class}` : ''}`}
        classList={{ open: open(), placeholder: !props.action && !chosen() }}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-label={props.action ? props.label : `${props.label}: ${shown()}`}
        title={props.title ?? (props.action ? undefined : chosen()?.title)}
        disabled={props.disabled}
        onClick={() => (open() ? close() : show())}
        onKeyDown={(e) => {
          if (open()) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            show();
          }
        }}
      >
        <span class="sel-text" classList={{ muted: !props.action && !!chosen()?.muted }}>
          {shown()}
        </span>
        <ChevronIcon size={10} />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={menu}
            class="view-menu sel-menu"
            role="listbox"
            aria-label={props.label}
            style={{
              top: at().top != null ? `${at().top}px` : undefined,
              bottom: at().bottom != null ? `${at().bottom}px` : undefined,
              left: at().left != null ? `${at().left}px` : undefined,
              right: at().right != null ? `${at().right}px` : undefined,
              'min-width': `${Math.max(at().minWidth, 140)}px`,
            }}
            onKeyDown={onMenuKey}
          >
            <Show when={props.heading}>
              <div class="vm-section sel-heading">{props.heading}</div>
            </Show>
            <For each={props.options}>
              {(o) => {
                const on = () => !props.action && o.value === props.value;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={on()}
                    class="vm-item sel-item"
                    classList={{ on: on(), action: !!props.action }}
                    title={o.title}
                    disabled={o.disabled}
                    onClick={() => choose(o)}
                    onMouseMove={(e) => e.currentTarget.focus({ preventScroll: true })}
                  >
                    <Show when={!props.action}>
                      <span class="vm-check" classList={{ on: on(), radio: true }} aria-hidden="true">
                        <Show when={on()}>
                          <span class="vm-dot" />
                        </Show>
                      </span>
                    </Show>
                    <span class="vm-label" classList={{ muted: !!o.muted }}>
                      {o.label}
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}
