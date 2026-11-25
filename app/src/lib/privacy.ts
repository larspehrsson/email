import { createSignal } from 'solid-js';
import { api } from '../api';

// Choices in Settings › General › Privacy that the core keeps and enforces (its `settings`
// table), mirrored here so the app follows a change at once. Each is asked for once, the first
// time it's read; until the core answers it reads as its default.

function coreChoice(fallback: boolean, get: () => Promise<boolean>, set: (on: boolean) => Promise<void>) {
  const [value, setValue] = createSignal(fallback);
  let asked = false;
  const read = (): boolean => {
    if (!asked) {
      asked = true;
      void get().then(setValue, () => {});
    }
    return value();
  };
  const write = async (on: boolean): Promise<void> => {
    asked = true;
    setValue(on);
    await set(on);
  };
  return [read, write] as const;
}

/** "Always load…" can cover everyone at a sender's domain. Off unless turned on: where the
 *  mail server doesn't check who mail is from, someone pretending to be from that domain could
 *  then see when their message is opened. */
export const [domainRules, setDomainRules] = coreChoice(false, api.domainRules, api.setDomainRules);

/** A picture that only loads over plain http may be fetched that way (`rescueHttpImages`), its
 *  address visible on the network. On unless turned off. */
export const [httpPictures, setHttpPictures] = coreChoice(true, api.httpPictures, api.setHttpPictures);
