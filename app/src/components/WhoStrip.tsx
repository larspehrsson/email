import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { Addr } from '../api';
import { Avatar } from './Avatar';
import { clock } from '../lib/format';
import { addressMenu } from './AddressMenu';
import { PaperclipIcon } from './Icons';

// Who sent it and when, kept in sight once the message's own header has scrolled away: a
// one-line strip at the top of the reader, or of a conversation card. It's sticky inside its
// message (position: sticky; in the reader it's docked over the top of the scroller instead, so
// it spans the scrollbar too), so in a conversation the next card's strip pushes it off as that
// card comes up, and scrolling back brings it back. It takes no room (it overlays the top of the
// message) and shows only while the header is out of sight; a click brings the header back.
// An experiment (2026-11-25).

const DATE = new Intl.DateTimeFormat(undefined, clock({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));

/** Everyone, for the tooltip: "To: John Doe <john@…>, …  Cc: …". */
function everyone(to: Addr[], cc: Addr[], bcc: Addr[]): string {
  const list = (label: string, l: Addr[]) => (l.length ? `${label}: ${l.map((a) => (a.name ? `${a.name} <${a.addr}>` : a.addr)).join(', ')}` : '');
  return [list('To', to), list('Cc', cc), to.length || cc.length ? '' : list('Bcc', bcc)].filter(Boolean).join('\n') || 'Undisclosed recipients';
}

/** "John Doe, Ben Carter +3"; their Bcc for one of ours with no To or Cc; else not disclosed. */
function recipients(to: Addr[], cc: Addr[], bcc: Addr[]): string {
  const all = [...to, ...cc];
  const list = all.length ? all : bcc;
  if (!list.length) return 'undisclosed recipients';
  const names = list.map((a) => a.name || a.addr);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}

export function WhoStrip(props: {
  from: Addr;
  to: Addr[];
  cc: Addr[];
  bcc?: Addr[];
  /** the recipients are known (the message is loaded) */
  known: boolean;
  date: number;
  /** the header it stands in for: shown while that's scrolled out of sight above */
  head: () => HTMLElement | undefined;
  /** what scrolls, when the strip isn't inside it (the reader's, so the strip spans the
   *  scrollbar too); else the conversation it's in */
  scroller?: () => HTMLElement | undefined;
  /** how many attachments: a paperclip that brings the chips back (`chips`) */
  attachments?: number;
  chips?: () => Element | null | undefined;
  /** buttons shown over the date on hover (a conversation card's own: the band's are far) */
  actions?: JSX.Element;
}) {
  const [on, setOn] = createSignal(false);
  let el: HTMLDivElement | undefined;

  onMount(() => {
    const head = props.head();
    const scroller = props.scroller?.() ?? el?.closest<HTMLElement>('.conv-scroll, .reader-scroll');
    if (!head || !scroller) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        const top = e.rootBounds?.top ?? scroller.getBoundingClientRect().top;
        setOn(!e.isIntersecting && e.boundingClientRect.bottom <= top + 1);
      },
      // The strip's own height at the top doesn't count as in sight: it would cover the header.
      { root: scroller, rootMargin: '-34px 0px 0px 0px', threshold: 0 },
    );
    io.observe(head);
    onCleanup(() => io.disconnect());
  });

  return (
    <div
      ref={el}
      class="who-strip"
      classList={{ on: on(), 'has-acts': !!props.actions }}
      aria-hidden={!on()}
      title="Show the whole header"
      onClick={(e) => {
        e.stopPropagation();
        props.head()?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }}
    >
      <Avatar name={props.from.name} addr={props.from.addr} size={20} />
      <span class="who-name" onContextMenu={(e) => addressMenu(e, props.from)}>
        {props.from.name || props.from.addr}
      </span>
      <Show when={props.known}>
        <span class="who-to" title={everyone(props.to, props.cc, props.bcc ?? [])}>
          to {recipients(props.to, props.cc, props.bcc ?? [])}
        </span>
      </Show>
      <span class="who-end">
        <Show when={(props.attachments ?? 0) > 0}>
          <button
            class="who-clip"
            title={props.attachments === 1 ? 'Show the attachment' : `Show the ${props.attachments} attachments`}
            onClick={(e) => {
              e.stopPropagation();
              e.currentTarget.blur();
              props.chips?.()?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }}
          >
            <PaperclipIcon size={13} />
            {props.attachments}
          </button>
        </Show>
        <span class="who-when">
          <time class="who-date" dateTime={new Date(props.date * 1000).toISOString()}>
            {DATE.format(new Date(props.date * 1000))}
          </time>
          {props.actions}
        </span>
      </span>
    </div>
  );
}
