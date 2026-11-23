// Unit tests for the frontend's plain logic (modules without imports beyond types: Node runs
// their TypeScript as is).
//
//   cd app && npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchRecipients } from '../src/lib/recipients.ts';
import { accountMarks, hash } from '../src/lib/accountMarks.ts';
import { parseMailto } from '../src/lib/mailto.ts';
import { monthGrid, parseTime, stepTime } from '../src/lib/clock.ts';
import { declaredSize } from '../src/lib/images.ts';

const a = (addr, name = null) => ({ name, addr });
const addrs = (list) => list.map((x) => x.addr);

const reply = { to: [a('ann@example.com', 'Ann')], cc: [] };
const replyAll = { to: [a('ann@example.com', 'Ann'), a('bob@example.com')], cc: [a('cy@example.com'), a('di@example.com')] };

test('reply all adds the others, each in its field', () => {
  const next = switchRecipients({ to: reply.to, cc: [], bcc: [] }, reply, replyAll);
  assert.deepEqual(addrs(next.to), ['ann@example.com', 'bob@example.com']);
  assert.deepEqual(addrs(next.cc), ['cy@example.com', 'di@example.com']);
});

test('back to reply takes out only what reply all put there', () => {
  const cur = { to: [...replyAll.to, a('zoe@example.com')], cc: [...replyAll.cc], bcc: [] };
  const next = switchRecipients(cur, replyAll, reply);
  assert.deepEqual(addrs(next.to), ['ann@example.com', 'zoe@example.com']);
  assert.deepEqual(addrs(next.cc), []);
});

test('someone already there by hand (any field, any case) isn’t added twice', () => {
  // Di moved to Bcc by hand, Cy removed; case differs.
  const cur = { to: [a('Ann@Example.com', 'Ann')], cc: [], bcc: [a('di@example.com')] };
  const next = switchRecipients(cur, reply, replyAll);
  assert.deepEqual(addrs(next.to), ['Ann@Example.com', 'bob@example.com']);
  assert.deepEqual(addrs(next.cc), ['cy@example.com']);
});

test('the same recipients either way: nothing changes', () => {
  const cur = { to: [a('ann@example.com')], cc: [], bcc: [] };
  assert.deepEqual(switchRecipients(cur, reply, reply), { to: cur.to, cc: [] });
});

// ------------------------------------------------------------- account markers

const hueOf = (color) => Number(/hsl\((\d+)/.exec(color)[1]);
const gap = (a, b) => Math.min(Math.abs(a - b) % 360, 360 - (Math.abs(a - b) % 360));

test('accounts with the same initial get different letters', () => {
  const m = accountMarks([
    { id: 1, email: 'john@example.com' },
    { id: 2, email: 'jdoe@example.org' },
    { id: 3, email: 'j.doe@work.example.net' },
  ]);
  assert.deepEqual([1, 2, 3].map((id) => m.get(id).letter), ['J', 'E', 'W']);
});

test('accounts whose colours would match get different ones', () => {
  // Find two addresses that hash to the same hue (what happened with a real pair).
  const seen = new Map();
  let pair;
  for (let i = 0; !pair; i++) {
    const e = `user${i}@example.com`;
    const h = hash(e) % 360;
    if (seen.has(h)) pair = [seen.get(h), e];
    else seen.set(h, e);
  }
  const m = accountMarks([{ id: 1, email: pair[0] }, { id: 2, email: pair[1] }]);
  assert.ok(gap(hueOf(m.get(1).color), hueOf(m.get(2).color)) >= 40);
});

test('adding an account leaves the existing markers alone', () => {
  const before = accountMarks([{ id: 1, email: 'john@example.com' }, { id: 2, email: 'jane@example.org' }]);
  const after = accountMarks([{ id: 2, email: 'jane@example.org' }, { id: 1, email: 'john@example.com' }, { id: 3, email: 'jo@mail.example.net' }]);
  assert.deepEqual(after.get(1), before.get(1));
  assert.deepEqual(after.get(2), before.get(2));
  assert.equal(after.get(3).letter, 'M');
});

test('a marker the user set is kept, and the automatic ones steer clear of it', () => {
  const m = accountMarks([
    { id: 1, email: 'john@example.com' },
    { id: 2, email: 'kate@example.org', markLetter: 'j', markColor: 'teal' },
  ]);
  assert.equal(m.get(2).letter, 'J');
  assert.equal(m.get(2).color, 'hsl(172 55% 52%)');
  assert.equal(m.get(2).autoLetter, 'K', 'what automatic would be');
  // John's J is taken by Kate's choice: he falls back to his domain's E, his colour clear of teal
  assert.equal(m.get(1).letter, 'E');
  assert.ok(gap(hueOf(m.get(1).color), 172) >= 40);
});

// ------------------------------------------------------------- mailto: links

test('a mailto link with recipients, subject and body', () => {
  const m = parseMailto('mailto:ann@example.com,Bob%20%3Cbob@example.org%3E?cc=cy@example.com&subject=Look%20at%20this&body=Hi%2C%0A%0Ahttps%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2%0Asecond%20line');
  assert.deepEqual(m.to, [{ name: null, addr: 'ann@example.com' }, { name: 'Bob', addr: 'bob@example.org' }]);
  assert.deepEqual(m.cc, [{ name: null, addr: 'cy@example.com' }]);
  assert.equal(m.subject, 'Look at this');
  assert.equal(m.html, '<p>Hi,</p><p>https://example.com/a?b=1&amp;c=2<br>second line</p>');
});

test('a browser\'s "email link": no recipient, a plus kept, markup escaped', () => {
  const m = parseMailto('MAILTO:?subject=C%2B%2B%20%3Ctips%3E&body=1+1');
  assert.deepEqual(m.to, []);
  assert.equal(m.subject, 'C++ <tips>');
  assert.equal(m.html, '<p>1+1</p>');
  assert.equal(parseMailto('https://example.com'), null);
});

// ------------------------------------------------------------- snooze picker

test('times typed by hand', () => {
  assert.equal(parseTime('9'), 9 * 60);
  assert.equal(parseTime('9:30'), 9 * 60 + 30);
  assert.equal(parseTime('2pm'), 14 * 60);
  assert.equal(parseTime('2'), 14 * 60, 'an afternoon hour without am/pm');
  assert.equal(parseTime('2', true), 2 * 60, 'unless the clock is 24-hour');
  assert.equal(parseTime('12am'), 0);
  assert.equal(parseTime('12:15 p.m.'), 12 * 60 + 15);
  assert.equal(parseTime('14:15'), 14 * 60 + 15);
  assert.equal(parseTime('noon'), 12 * 60);
  assert.equal(parseTime('25'), null);
  assert.equal(parseTime('9:75'), null);
  assert.equal(parseTime('soon'), null);
});

test('arrow keys step the time on a 15-minute grid', () => {
  assert.equal(stepTime(9 * 60, 15), 9 * 60 + 15);
  assert.equal(stepTime(9 * 60 + 7, 15), 9 * 60 + 15, 'onto the grid first');
  assert.equal(stepTime(9 * 60 + 7, -15), 9 * 60);
  assert.equal(stepTime(23 * 60 + 45, 15), 0, 'round the day');
  assert.equal(stepTime(0, -60), 23 * 60);
});

test('a month grid starts on the week of the 1st', () => {
  const g = monthGrid(2026, 10); // November 2026: the 1st is a Sunday
  assert.equal(g.length, 42);
  assert.equal(g[0].getDate(), 1);
  const m = monthGrid(2026, 10, 1); // weeks from Monday
  assert.equal(m[0].getMonth(), 9);
  assert.equal(m[0].getDate(), 26);
});

test('an image keeps the shape it is declared at', () => {
  // Outlook: attributes in pixels, inline style in inches (the style is what shows)
  assert.deepEqual(declaredSize('514', '867', 'width:5.3541in;height:9.0312in'), { w: 5.3541 * 96, h: 9.0312 * 96 });
  assert.deepEqual(declaredSize('600', '1', null), { w: 600, h: 1 });
  assert.deepEqual(declaredSize('300px', null, 'height: 150px'), { w: 300, h: 150 });
  assert.deepEqual(declaredSize(null, null, 'border:0; width:2in; height:72pt'), { w: 192, h: 96 });
  // max-width or a percentage is no declared size
  assert.equal(declaredSize('100%', '200', null), null);
  assert.equal(declaredSize(null, '200', 'max-width:300px'), null);
  assert.equal(declaredSize('300', null, null), null);
  assert.equal(declaredSize('0', '10', null), null);
});

// ------------------------------------------------------------- list groups

import { datePeriods, insertRow, labelDateCounts, layoutGroups, removeRows, startsGroup, startsThrough } from '../src/lib/listGroups.ts';

test('date periods: today, yesterday, this week by name, weeks, months, years', () => {
  // Saturday 21 November 2026, weeks starting on Monday.
  const p = datePeriods(new Date(2026, 10, 21, 15, 30), 1, 'en-US');
  assert.deepEqual(
    p.slice(0, 12).map((x) => x.label),
    ['Today', 'Yesterday', 'Thursday', 'Wednesday', 'Tuesday', 'Monday', 'Last week', 'Two weeks ago', 'Three weeks ago', 'October', 'September', 'August'],
  );
  assert.equal(p[0].from, new Date(2026, 10, 21).getTime() / 1000);
  assert.equal(p[6].from, new Date(2026, 10, 9).getTime() / 1000, 'last week starts the Monday before');
  assert.equal(p[9].from, new Date(2026, 9, 1).getTime() / 1000, 'October: the rest of it');
  assert.ok(p.some((x) => x.label === 'January') && p.some((x) => x.label === '2025'));
  for (let i = 1; i < p.length; i++) assert.ok(p[i].from < p[i - 1].from, 'strictly older');
});

test('date periods early in a week and a year', () => {
  // Monday 4 January 2027: no weekday names; the weeks reach into 2026, then years.
  const p = datePeriods(new Date(2027, 0, 4, 9), 1, 'en-US');
  assert.deepEqual(p.slice(0, 6).map((x) => x.label), ['Today', 'Yesterday', 'Last week', 'Two weeks ago', 'Three weeks ago', '2026']);
  // Sunday-first weeks: on a Sunday nothing but Today/Yesterday before the weeks.
  const s = datePeriods(new Date(2026, 10, 22, 9), 0, 'en-US');
  assert.deepEqual(s.slice(0, 3).map((x) => x.label), ['Today', 'Yesterday', 'Last week']);
});

test('groups: where they start, and keeping them right through removes and undo', () => {
  const g = layoutGroups(labelDateCounts([{ label: 'Today', from: 0 }, { label: 'Yesterday', from: 0 }], [2, 0, 3]));
  assert.deepEqual(g, [
    { label: 'Today', count: 2, start: 0 },
    { label: 'Older', count: 3, start: 2 },
  ]);
  assert.equal(startsThrough(g, 0), 1);
  assert.equal(startsThrough(g, 4), 2);
  assert.equal(startsGroup(g, 2)?.label, 'Older');
  assert.equal(startsGroup(g, 3), undefined);
  const less = removeRows(g, [0, 1]);
  assert.deepEqual(less, [{ label: 'Older', count: 3, start: 0 }]);
  const back = insertRow(removeRows(g, [1]), 1, 'today');
  assert.deepEqual(back, g, 'put back into the group it is named after');
  assert.deepEqual(insertRow(g, 2), [{ label: 'Today', count: 2, start: 0 }, { label: 'Older', count: 4, start: 2 }]);
});

// ------------------------------------------------------------- writing help text

import { clipOriginal, htmlToText, textToHtml } from '../src/lib/aiText.ts';

test('the model’s plain text becomes paragraphs, line breaks and lists', () => {
  assert.equal(textToHtml('Hi Anna,\n\nThursday works.\nSee you <then>.\n\n- one\n- two'), '<p>Hi Anna,</p><p>Thursday works.<br>See you &lt;then&gt;.</p><ul><li><p>one</p></li><li><p>two</p></li></ul>');
  assert.equal(textToHtml('  \n'), '<p></p>');
});

test('a very long original keeps its newest part', () => {
  const long = 'x'.repeat(70_000);
  const c = clipOriginal(long);
  assert.ok(c.length < 61_000 && c.endsWith('left out]'));
  assert.equal(clipOriginal('short'), 'short');
});

test('an email’s text for the prompt leaves out its CSS and scripts', () => {
  const parse = (h) => ({ body: { textContent: h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&') } });
  const html = '<html><head><title>T</title><style>.a{color:red}</style></head><body><p>Hi&amp;bye</p><STYLE type="text/css">p{x:y}</STYLE><ul><li>one</li></ul><script>x()</script>Done</body></html>';
  assert.equal(htmlToText(html, parse), 'Hi&bye\n- one\nDone');
});

import { describeLink, siteOf, textHost } from '../src/lib/linkCheck.ts';

test('a link shows where it goes: the site apart from the rest', () => {
  const l = describeLink('https://www.facebook.com/login/?next=x', 'Log in');
  assert.equal(l.host, 'www.facebook.com');
  assert.equal(l.before, 'https://');
  assert.equal(l.after, '/login/?next=x');
  assert.equal(l.warning, null);
  assert.equal(describeLink('mailto:ann@example.com?subject=Hi', 'Ann').host, 'ann@example.com');
});

test('text that is an address but leads elsewhere is called out', () => {
  assert.match(describeLink('https://fb-security.example/verify', 'https://www.facebook.com/security').warning, /facebook\.com.*fb-security\.example/);
  assert.match(describeLink('http://evil.example/', 'facebook.com').warning, /facebook\.com/);
  // The same site, with or without www, or a part of it: fine.
  assert.equal(describeLink('https://www.facebook.com/x', 'facebook.com').warning, null);
  assert.equal(describeLink('https://m.facebook.com/x', 'www.facebook.com/x').warning, null);
  // Words, not an address: nothing to compare.
  assert.equal(describeLink('https://click.example/abc', 'Click here').warning, null);
  assert.equal(textHost('Facebook'), null);
  assert.equal(textHost('version 2.0 notes'), null);
});

test('look-alike letters and bare addresses are called out', () => {
  // A Cyrillic "а" in facebook: the browser sees xn--…
  const l = describeLink('https://fаcebook.com/', 'Facebook');
  assert.match(l.host, /^xn--/);
  assert.match(l.warning, /international letters/);
  assert.match(describeLink('http://192.168.1.20/login', 'Log in').warning, /bare internet address/);
});

test('a link to a place that isn\u2019t in the message goes nowhere, and says so', () => {
  const dead = describeLink('#unsubscribe', 'opsige abonnementet', { targetExists: false });
  assert.match(dead.before, /Goes nowhere \(#unsubscribe\)/);
  assert.match(dead.warning, /doesn.t lead anywhere/);
  assert.match(describeLink('#', 'Unsubscribe').warning, /doesn.t lead anywhere/);
  const there = describeLink('#top', 'Back to top', { targetExists: true });
  assert.equal(there.warning, null);
  assert.match(there.before, /A place in this message/);
});

test('a link to another site than the sender\u2019s gets a note', () => {
  assert.equal(siteOf('mail.shop.example.co.uk'), 'example.co.uk');
  assert.equal(siteOf('news.example.com'), 'example.com');
  const other = describeLink('https://parcellink-track.example/x', 'Track', { sender: 'jessica@jkp.invid.se' });
  assert.match(other.note, /invid\.se/);
  assert.equal(other.warning, null);
  // The sender's own site, or a part of it: nothing to say.
  assert.equal(describeLink('https://www.example.com/a', 'Read', { sender: 'news@mail.example.com' }).note, null);
  // No sender known, or not a web link: no note.
  assert.equal(describeLink('https://other.example/', 'Read').note, null);
  assert.equal(describeLink('mailto:a@other.example', 'Write', { sender: 'b@example.com' }).note, null);
  // A warning says more; the note isn't added to it.
  assert.equal(describeLink('http://evil.example/', 'facebook.com', { sender: 'x@facebook.com' }).note, null);
});
