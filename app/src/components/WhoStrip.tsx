import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { Addr } from '../api';
import { Avatar } from './Avatar';
import { clock } from '../lib/format';

// Who sent it and when, kept in sight once the message's own header has scrolled away: a
// one-line strip at the top of the reader, or of a conversation card. It's sticky inside its
// message (position: sticky), so in a conversation the next card's strip pushes it off as that
// card comes up, and scrolling back brings it back. It takes no room (it overlays the top of the
// message) and shows only while the header is out of sight; a click brings the header back.
// An experiment (2026-11-25).

const DATE = new Intl.DateTimeFormat(undefined, clock({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));

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
}) {
  const [on, setOn] = createSignal(false);
  let el: HTMLDivElement | undefined;

  onMount(() => {
    const head = props.head();
    const scroller = el?.closest<HTMLElement>('.conv-scroll, .reader-scroll');
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
      classList={{ on: on() }}
      aria-hidden={!on()}
      title="Show the whole header"
      onClick={(e) => {
        e.stopPropagation();
        props.head()?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }}
    >
      <Avatar name={props.from.name} addr={props.from.addr} size={20} />
      <span class="who-name">{props.from.name || props.from.addr}</span>
      <Show when={props.known}>
        <span class="who-to">to {recipients(props.to, props.cc, props.bcc ?? [])}</span>
      </Show>
      <time class="who-date" dateTime={new Date(props.date * 1000).toISOString()}>
        {DATE.format(new Date(props.date * 1000))}
      </time>
    </div>
  );
}
