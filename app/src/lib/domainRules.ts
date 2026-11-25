import { createSignal } from 'solid-js';
import { api } from '../api';

// Whether "Always load…" can cover everyone at a sender's domain (Settings › General › Privacy).
// Off unless the user turns it on: someone pretending to be from that domain could then see when
// their message is opened, where the user's mail server doesn't check who mail is from. The core
// keeps it and enforces it; this mirrors it so the menus follow a change at once.

const [on, setOn] = createSignal(false);
let asked = false;

/** Domain rules are on (false until the core has said). */
export function domainRules(): boolean {
  if (!asked) {
    asked = true;
    void api.domainRules().then(setOn, () => {});
  }
  return on();
}

export async function setDomainRules(value: boolean): Promise<void> {
  setOn(value);
  asked = true;
  await api.setDomainRules(value);
}
