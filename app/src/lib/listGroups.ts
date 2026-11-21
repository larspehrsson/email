// The folder list's groups: by date, periods like Outlook's (Today, Yesterday, the other days of
// this week by name, Last week, Two and Three weeks ago, then months of this year, then years);
// by sender or recipient, one per person (named by the core). Also where each group starts in
// the list, for the headers drawn above those rows. Import-free, for the unit tests.

export interface Period {
  label: string;
  /** Start, Unix seconds (local time); the period runs until the one before it starts. */
  from: number;
}

/**
 * Periods of a list sorted newest first, newest first: each starts at `from`; anything older
 * than the last is "Older". `firstDay`: the week's first day (0 Sunday, 1 Monday).
 */
export function datePeriods(now: Date, firstDay = 1, locale?: string): Period[] {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  const month = new Intl.DateTimeFormat(locale, { month: 'long' });
  const at = (y: number, m: number, d: number) => new Date(y, m, d).getTime() / 1000;
  const y = now.getFullYear();
  const today = at(y, now.getMonth(), now.getDate());
  const out: Period[] = [];
  // Only periods that start before the last one: each runs up to the one before it.
  const add = (label: string, from: number) => {
    const last = out[out.length - 1];
    if (!last || from < last.from) out.push({ label, from });
  };
  add('Today', today);
  const dayBack = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  add('Yesterday', dayBack(1).getTime() / 1000);
  const back = (now.getDay() - firstDay + 7) % 7; // days since the week began
  for (let n = 2; n <= back; n++) add(weekday.format(dayBack(n)), dayBack(n).getTime() / 1000);
  const weekStart = dayBack(back);
  const weeksBack = (w: number) =>
    new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7 * w).getTime() / 1000;
  add('Last week', weeksBack(1));
  add('Two weeks ago', weeksBack(2));
  add('Three weeks ago', weeksBack(3));
  // Then this year's months, back to January (a month partly in the weeks above is the rest
  // of it); early in January the weeks reach into last year, which the years below take on.
  const d = new Date((out[out.length - 1]!.from - 1) * 1000);
  for (let m = d.getMonth(); d.getFullYear() === y && m >= 0; m--) add(month.format(new Date(y, m, 1)), at(y, m, 1));
  // Then years.
  for (let yr = y - 1; yr >= 1995; yr--) add(String(yr), at(yr, 0, 1));
  return out;
}

/** The periods' bounds for `list_groups` (newest first). */
export const periodBounds = (periods: Period[]): number[] => periods.map((p) => p.from);

export interface Group {
  label: string;
  count: number;
  /** Index of its first row. */
  start: number;
}

/** Groups from the core's counts, with where each starts; empty ones are left out. */
export function layoutGroups(groups: { label: string; count: number }[]): Group[] {
  const out: Group[] = [];
  let start = 0;
  for (const g of groups) {
    if (g.count <= 0) continue;
    out.push({ label: g.label, count: g.count, start });
    start += g.count;
  }
  return out;
}

/** Labels for the core's date counts (one per period, then "Older"). */
export function labelDateCounts(periods: Period[], counts: number[]): { label: string; count: number }[] {
  return counts.map((count, i) => ({ label: periods[i]?.label ?? 'Older', count }));
}

/** How many groups start at or before row `i` (so: the index of row i's group, plus one). */
export function startsThrough(groups: Group[], i: number): number {
  let lo = 0;
  let hi = groups.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid]!.start <= i) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Is row `i` the first of a group? */
export function startsGroup(groups: Group[], i: number): Group | undefined {
  const k = startsThrough(groups, i) - 1;
  const g = groups[k];
  return g && g.start === i ? g : undefined;
}

/**
 * The groups after rows are taken out (own actions, ahead of the refetch): `removed` are their
 * indexes before. Each group shrinks by the rows it lost; groups left empty go.
 */
export function removeRows(groups: Group[], removed: number[]): Group[] {
  if (removed.length === 0) return groups;
  const lost = new Map<number, number>();
  for (const i of removed) {
    const k = startsThrough(groups, i) - 1;
    if (k >= 0) lost.set(k, (lost.get(k) ?? 0) + 1);
  }
  return layoutGroups(groups.map((g, k) => ({ label: g.label, count: g.count - (lost.get(k) ?? 0) })));
}

/** The groups after a row is put back at `index` (undo), into the group holding that place. */
export function insertRow(groups: Group[], index: number, label?: string): Group[] {
  if (groups.length === 0) return groups;
  // At a boundary the row may belong to either side: the one it's named after, else the later.
  let k = Math.max(0, startsThrough(groups, index) - 1);
  const prev = groups[k - 1];
  if (groups[k]!.start === index && prev && label != null && prev.label.toLowerCase() === label.toLowerCase()) k--;
  return layoutGroups(groups.map((g, j) => ({ label: g.label, count: g.count + (j === k ? 1 : 0) })));
}
