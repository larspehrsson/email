import { Show } from 'solid-js';
import { avatarColor, initials } from '../lib/format';
import { senderIcon, senderPictures } from '../lib/senderIcons';

/** A sender's circle: their domain's picture when there is one (and pictures are on), else
 *  initials on a colour of their own. */
export function Avatar(props: { name: string | null; addr: string; size?: number; class?: string; noPicture?: boolean }) {
  const size = () => props.size ?? 40;
  const pic = () => (senderPictures() && !props.noPicture && props.addr ? senderIcon(props.addr) : null);
  return (
    <div
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
