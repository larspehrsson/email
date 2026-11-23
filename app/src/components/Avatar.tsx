import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { avatarColor, initials } from '../lib/format';
import { senderIcon, senderPictures } from '../lib/senderIcons';

/** A sender's circle: their domain's picture when there is one (and pictures are on), else
 *  initials on a colour of their own. */
export function Avatar(props: {
  name: string | null;
  addr: string;
  size?: number;
  class?: string;
  noPicture?: boolean;
  /** Ask for the picture only once it's on screen (a long list that isn't virtualized). */
  lazy?: boolean;
}) {
  const size = () => props.size ?? 40;
  const [seen, setSeen] = createSignal(!props.lazy);
  let el!: HTMLDivElement;
  onMount(() => {
    if (!props.lazy) return;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      setSeen(true);
      io.disconnect();
    });
    io.observe(el);
    onCleanup(() => io.disconnect());
  });
  const pic = () => (senderPictures() && seen() && !props.noPicture && props.addr ? senderIcon(props.addr) : null);
  return (
    <div
      ref={el}
      class={`avatar${props.class ? ` ${props.class}` : ''}`}
      classList={{ pic: !!pic() }}
      style={{
        background: pic() ? '#fff' : avatarColor(props.addr),
        width: `${size()}px`,
        height: `${size()}px`,
        'font-size': `${Math.round(size() * 0.38)}px`,
      }}
      aria-hidden="true"
    >
      <Show when={pic()} fallback={initials(props.name, props.addr)}>
        {(src) => <img src={src()} alt="" draggable={false} />}
      </Show>
    </div>
  );
}
