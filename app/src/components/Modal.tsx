import { onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

// Every dialog (Settings, a confirmation, Export, Add account…) is a Modal: one way of opening
// them, so dialogs over dialogs behave. Each is put at the end of the page when it opens, so the
// newest is the last in the page and the one drawn on top, and keys go to it: Esc closes only
// the dialog on top, wherever the focus is.

/** Menus that can open over a dialog. */
const MENUS = '.sel-menu, .st-color-panel';

/** The open dialogs' backdrops, oldest first: the last is the one on top. */
const open: HTMLElement[] = [];

/** Whether `backdrop` is the dialog on top: the one Esc (and other keys) are for. */
export function isTopDialog(backdrop: Element | null | undefined): boolean {
  return !!backdrop && open[open.length - 1] === backdrop;
}

export function Modal(props: {
  /** For screen readers: what the dialog is. */
  label: string;
  /** The card's classes, besides `card modal`. */
  class?: string;
  /** The backdrop's, besides `modal-backdrop`. */
  backdropClass?: string;
  role?: 'dialog' | 'alertdialog';
  onClose: () => void;
  /** Esc, while this is the dialog on top (default: `onClose`). Return false to leave the key
   *  to what has the focus (a menu open in the dialog, a field Esc empties…). */
  onEscape?: (e: KeyboardEvent) => boolean | void;
  /** A click beside the card (default: `onClose`); false: nothing. */
  onBackdrop?: (() => void) | false;
  /** Keys typed in the dialog (on the backdrop, as they bubble). */
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Focus the card when it opens (for dialogs with no field or button to focus first). */
  focusCard?: boolean;
  ref?: (card: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  let back!: HTMLDivElement;
  let card!: HTMLDivElement;
  onMount(() => {
    open.push(back);
    // On the window, first: a dialog under this one (also listening) mustn't take the key.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopDialog(back)) return;
      // A menu open over it (a drop-down's, a marker's colors) closes first, on its own.
      if (document.querySelector(MENUS)) return;
      if ((props.onEscape ?? props.onClose)(e) === false) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    if (props.focusCard) card.focus();
    onCleanup(() => {
      window.removeEventListener('keydown', onKey, true);
      open.splice(open.indexOf(back), 1);
    });
  });
  return (
    <Portal>
      <div
        ref={back}
        class={`modal-backdrop ${props.backdropClass ?? ''}`}
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget || props.onBackdrop === false) return;
          (props.onBackdrop ?? props.onClose)();
        }}
        onKeyDown={(e) => props.onKeyDown?.(e)}
      >
        <div
          ref={(el) => {
            card = el;
            props.ref?.(el);
          }}
          class={`card modal ${props.class ?? ''}`}
          tabIndex={-1}
          role={props.role ?? 'dialog'}
          aria-modal="true"
          aria-label={props.label}
        >
          {props.children}
        </div>
      </div>
    </Portal>
  );
}
