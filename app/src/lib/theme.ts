import { createSignal } from 'solid-js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../api';
import { loadPref, savePref } from './format';

// The app's colours: Settings › General › Theme. A theme is a set of colour tokens in styles.css
// (`:root[data-theme=…]`) and a scheme, light or dark (`data-scheme`, which the stylesheet's
// dark rules follow). Auto and Paper follow the system's light or dark; the others are fixed.
// Kept in localStorage, which every window of the app shares: index.html applies it before the
// first paint, and the other windows hear of a change by the `storage` event.

export type ThemeId = 'auto' | 'light' | 'dark' | 'paper' | 'solarized-light' | 'solarized-dark';
type Scheme = 'light' | 'dark';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  /** Light, dark, or the system's (null). */
  scheme: Scheme | null;
  /** For the picker's little preview: sidebar, background, accent. */
  swatch: [string, string, string];
  /** Its dark look, when it follows the system. */
  darkSwatch?: [string, string, string];
}

export const THEMES: ThemeInfo[] = [
  { id: 'auto', label: 'Auto', scheme: null, swatch: ['#f3f3f5', '#ffffff', '#0a6cff'], darkSwatch: ['#161618', '#1c1c1f', '#3d8bff'] },
  { id: 'light', label: 'Light', scheme: 'light', swatch: ['#f3f3f5', '#ffffff', '#0a6cff'] },
  { id: 'dark', label: 'Dark', scheme: 'dark', swatch: ['#161618', '#1c1c1f', '#3d8bff'] },
  { id: 'paper', label: 'Paper', scheme: null, swatch: ['#f0eee6', '#faf9f5', '#c96442'], darkSwatch: ['#1f1e1d', '#262624', '#d97757'] },
  { id: 'solarized-light', label: 'Solarized Light', scheme: 'light', swatch: ['#eee8d5', '#fdf6e3', '#268bd2'] },
  { id: 'solarized-dark', label: 'Solarized Dark', scheme: 'dark', swatch: ['#00212b', '#002b36', '#268bd2'] },
];

const PREF = 'ui.theme';
const valid = (v: unknown): ThemeId => (THEMES.some((t) => t.id === v) ? (v as ThemeId) : 'auto');
const system = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

const [themeSig, setThemeSig] = createSignal<ThemeId>(valid(loadPref<unknown>(PREF, 'auto')));
export const theme = themeSig;

/** Light or dark, for a theme, with the system in dark mode or not. */
export function schemeOf(id: ThemeId, systemDark: boolean): Scheme {
  return THEMES.find((t) => t.id === id)?.scheme ?? (systemDark ? 'dark' : 'light');
}

function apply() {
  const id = themeSig();
  const info = THEMES.find((t) => t.id === id);
  const root = document.documentElement;
  root.dataset.scheme = schemeOf(id, !!system?.matches);
  if (id === 'auto' || id === 'light' || id === 'dark') delete root.dataset.theme;
  else root.dataset.theme = id;
  // The window's own parts (title bar, the system's menus and sheets) in the same light or dark;
  // a theme that follows the system leaves them to it.
  if (isTauri) void getCurrentWindow().setTheme(info?.scheme ?? null).catch(() => {});
}

export function setTheme(id: ThemeId) {
  setThemeSig(id);
  savePref(PREF, id);
  apply();
}

apply();
system?.addEventListener('change', apply);
// Another window changed it.
window.addEventListener('storage', (e) => {
  if (e.key !== PREF) return;
  let v: unknown = null;
  try {
    v = e.newValue == null ? null : JSON.parse(e.newValue);
  } catch {
    /* not ours */
  }
  setThemeSig(valid(v));
  apply();
});
