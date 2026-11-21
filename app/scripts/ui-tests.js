// UI tests: the browser preview with its mock backend (src/mock.ts, `?demo`), driven in Chrome.
// For behaviour that spans the list, the search and the reader, which no unit test reaches.
//
//   cd app && npm run test:ui
//
// Uses the installed Google Chrome (or CHROME=/path/to/chromium).

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-10-13T09:41:00-04:00');

let server;
let browser;
let base;

before(async () => {
  server = await createServer({ root: APP, logLevel: 'error', server: { port: 1498, strictPort: false } });
  await server.listen();
  base = server.resolvedUrls.local[0];
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/** The demo in a fresh window, as a list of messages or of conversations. */
async function open({ threaded, query = '' }) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 }, locale: 'en-US', timezoneId: 'America/New_York' });
  await context.clock.setFixedTime(NOW);
  await context.addInitScript((t) => localStorage.setItem('ui.threaded', JSON.stringify(t)), threaded);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?demo' + query);
  await page.waitForSelector('.folder-layer .row');
  await page.waitForTimeout(300);
  return { page, errors, context, close: () => context.close() };
}

const selected = (page) => page.locator('.folder-layer .row.selected .row-subject').first();
const reader = (page) => page.locator('h1').first();

/** Wait until `locator`'s text is `want` (or time out with what it was). */
async function hasText(locator, want, what) {
  const end = Date.now() + 3000;
  let got = null;
  while (Date.now() < end) {
    got = await locator.textContent({ timeout: 200 }).catch(() => null);
    if (got?.trim() === want) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${what}: expected "${want}", got "${got}"`);
}

/** `hasText` with a longer wait. */
async function hasTextWithin(locator, want, ms, what) {
  const end = Date.now() + ms;
  let got = null;
  while (Date.now() < end) {
    got = await locator.textContent({ timeout: 200 }).catch(() => null);
    if (got?.trim() === want) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${what}: expected "${want}", got "${got}"`);
}

/** Search, pick the first result whose folder tag matches `where` and isn't `not`; its subject. */
async function pickResult(page, query, where, not) {
  await page.fill('.search-field input', query);
  await page.waitForSelector('.search-layer .row');
  await page.waitForTimeout(300);
  const rows = await page.locator('.search-layer .row').evaluateAll((rs) =>
    rs.map((r) => [r.querySelector('.folder-tag')?.textContent ?? '', r.querySelector('.row-subject')?.textContent ?? '']),
  );
  const k = rows.findIndex(([f, s]) => where.test(f) && s !== not);
  assert.ok(k >= 0, `no result in ${where} among ${JSON.stringify(rows)}`);
  await page.locator('.search-layer .row').nth(k).click();
  await hasText(reader(page), rows[k][1], 'the picked result opens');
  return rows[k][1];
}

for (const threaded of [false, true]) {
  describe(threaded ? 'conversation view' : 'message view', () => {
    test('clearing a search keeps a picked result the folder has', async () => {
      const { page, errors, close } = await open({ threaded });
      try {
        await page.locator('.folder-layer .row').nth(2).click();
        const before = (await selected(page).textContent()).trim();
        const picked = await pickResult(page, 'Northwind', /^Inbox$/, before);
        await page.fill('.search-field input', '');
        await hasText(selected(page), picked, 'selected in the folder');
        await hasText(reader(page), picked, 'still open');
        assert.deepEqual(errors, []);
      } finally {
        await close();
      }
    });

    test('clearing a search after picking a result from elsewhere brings back the selection', async () => {
      const { page, errors, close } = await open({ threaded });
      try {
        await page.locator('.folder-layer .row').nth(2).click();
        const before = (await selected(page).textContent()).trim();
        await pickResult(page, 'Northwind', /^(All Mail|Newsletters)$/, before);
        await page.fill('.search-field input', '');
        await hasText(selected(page), before, 'the earlier selection');
        await hasText(reader(page), before, 'the earlier message open');
        assert.deepEqual(errors, []);
      } finally {
        await close();
      }
    });

    test('a notification click opens its message in the folder on screen', async () => {
      const { page, errors, close } = await open({ threaded });
      try {
        await page.locator('.folder-layer .row').first().click();
        // A message further down the Inbox than the one open.
        const subject = (await page.locator('.folder-layer .row .row-subject').nth(4).textContent()).trim();
        assert.ok(await page.evaluate((s) => window.__clickNotification(s), subject), `"${subject}" in the Inbox`);
        await hasText(selected(page), subject, 'selected');
        await hasText(reader(page), subject, 'open');
        assert.deepEqual(errors, []);
      } finally {
        await close();
      }
    });
  });
}

/** Wait until the message's card in the open conversation is expanded and on screen. */
async function cardOpen(page, id, what) {
  const card = page.locator(`.card-slot[data-mid="${id}"] .card-msg.expanded`);
  await card.waitFor({ timeout: 3000 }).catch(() => assert.fail(`${what}: message ${id} isn't expanded`));
  await page.waitForTimeout(200);
  const box = await card.boundingBox();
  const view = page.viewportSize();
  assert.ok(box && box.y >= 0 && box.y < view.height - 40, `${what}: message ${id} isn't on screen (${JSON.stringify(box)})`);
}

describe('conversation view: the message asked for', () => {
  test('a notification click opens that message, not the newest of its conversation', async () => {
    const { page, errors, close } = await open({ threaded: true });
    try {
      const older = await page.evaluate(() => window.__olderInConversation('inbox'));
      assert.ok(older, 'an older message in an Inbox conversation');
      await page.evaluate((id) => window.__clickNotification(id), older.id);
      await cardOpen(page, older.id, 'notification');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('clearing a search in All Mail opens the picked message in its conversation', async () => {
    const { page, errors, close } = await open({ threaded: true });
    try {
      await page.getByText('All Mail', { exact: true }).first().click();
      await page.waitForSelector('.folder-layer .row');
      const older = await page.evaluate(() => window.__olderInConversation('all'));
      assert.ok(older, 'an older message in an All Mail conversation');
      await page.fill('.search-field input', `subject:"${older.subject}"`);
      const row = page.locator(`.search-layer .row[data-id="${older.id}"]`);
      await row.waitFor({ timeout: 3000 });
      await row.click();
      await page.waitForTimeout(300);
      await page.fill('.search-field input', '');
      await cardOpen(page, older.id, 'after clearing');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('compose', () => {
  test('the outline a compose window shows while loading is laid out like the composer', async () => {
    const context = await browser.newContext({ viewport: { width: 760, height: 400 } });
    try {
      const page = await context.newPage();
      // only the page itself: the app's code never comes, as if it were still loading
      await page.route(/\.(tsx?|jsx?)(\?|$)|@vite|@id|node_modules/, (r) => r.abort());
      await page.goto(base + '?compose=1');
      const tops = await page.locator('#boot .boot-row').evaluateAll((rs) => rs.map((r) => [r.textContent, Math.round(r.getBoundingClientRect().top)]));
      assert.deepEqual(tops, [['From', 52], ['To', 92], ['Subject', 132]]);
    } finally {
      await context.close();
    }
  });

  test('Reply and Reply all switch over, changing only their own recipients', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      // The first demo message has people in Cc.
      await page.locator('.folder-layer .row').first().click();
      await page.waitForTimeout(300);
      const popup = context.waitForEvent('page');
      await page.locator('.reader [aria-label="Reply all"]').first().click();
      const w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      await w.waitForSelector('.cmp-mode');
      const on = async () => (await w.locator('.cmp-mode button.on').textContent()).trim();
      const people = async () =>
        (await w.locator('.cmp-fields .addr-chip').allTextContents()).map((t) => t.replace('×', '').trim());
      await w.waitForFunction(() => document.querySelectorAll('.cmp-fields .addr-chip').length >= 3);
      assert.equal(await on(), 'Reply all');
      const all = await people();

      await w.locator('.cmp-mode button', { hasText: /^Reply$/ }).click();
      assert.equal(await on(), 'Reply');
      assert.equal((await people()).length, 1, 'only the sender');

      await w.locator('.cmp-mode button', { hasText: 'Reply all' }).click();
      assert.equal(await on(), 'Reply all');
      assert.deepEqual(await people(), all);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('reader', () => {
  test('a picture wider than the reader shrinks and keeps its shape', async () => {
    const { page, errors, close } = await open({ threaded: false, query: '&picture' });
    try {
      await page.locator('.folder-layer .row', { hasText: 'picture as the body' }).first().click();
      const img = page.frameLocator('.reader iframe').first().locator('img');
      await img.waitFor();
      await page.waitForFunction(() => {
        const i = document.querySelector('.reader iframe')?.contentDocument?.querySelector('img');
        return i && i.getBoundingClientRect().width > 0;
      });
      const { w, h, room } = await img.evaluate((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, room: el.ownerDocument.body.clientWidth }));
      assert.ok(w < 1400 && w <= room, `shrunk to the reader (${w} of ${room})`);
      assert.ok(Math.abs(w / h - 2) < 0.02, `still 2:1, not squished (${w}×${h})`);
      // a click shows it at its actual size, another fits it again
      assert.equal(await img.evaluate((el) => getComputedStyle(el).cursor), 'zoom-in');
      await img.click();
      const full = await img.evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]);
      assert.ok(Math.abs(full[0] - 1400) < 1 && Math.abs(full[1] - 700) < 1, `actual size: ${full}`);
      assert.equal(await img.evaluate((el) => getComputedStyle(el).cursor), 'zoom-out');
      // and the reader scrolls sideways to the rest of it
      const across = await img.evaluate((el) => {
        const s = el.ownerDocument.scrollingElement;
        s.scrollLeft = 10_000;
        return { left: s.scrollLeft, room: s.clientWidth, right: el.getBoundingClientRect().right };
      });
      assert.ok(across.left > 0 && Math.abs(across.right - across.room) < 30, `scrolled to its right edge: ${JSON.stringify(across)}`);
      await img.evaluate((el) => (el.ownerDocument.scrollingElement.scrollLeft = 0));
      await img.click({ position: { x: 20, y: 20 } });
      assert.ok(Math.abs((await img.evaluate((el) => el.getBoundingClientRect().width)) - w) < 1, 'fits again');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
  test('in a conversation, a picture at its actual size widens its card; the pane scrolls sideways', async () => {
    const { page, errors, close } = await open({ threaded: true, query: '&picture' });
    try {
      await page.locator('.folder-layer .row', { hasText: 'picture as the body' }).first().click();
      const img = page.frameLocator('.card-frame').first().locator('img');
      await img.waitFor();
      await page.waitForFunction(() => document.querySelector('.card-frame')?.contentDocument?.querySelector('img')?.classList.contains('mail-zoom'));
      const pane = () =>
        page.evaluate(() => {
          const s = document.querySelector('.conv-scroll');
          const f = document.querySelector('.card-frame');
          const de = f.contentDocument.documentElement;
          return { scroll: s.scrollWidth, room: s.clientWidth, frameScrolls: de.scrollWidth > de.clientWidth + 1, frameH: f.getBoundingClientRect().height };
        });
      const before = await pane();
      assert.ok(before.scroll <= before.room + 1, 'nothing to scroll sideways yet');
      await img.click();
      await page.waitForFunction(() => {
        const s = document.querySelector('.conv-scroll');
        return s.scrollWidth > s.clientWidth + 500;
      });
      const zoomed = await pane();
      assert.ok(!zoomed.frameScrolls, 'the message itself never scrolls sideways');
      assert.ok(zoomed.frameH > 700, `the frame holds the whole picture (${zoomed.frameH})`);
      // the pane's scrollbar reaches its right edge
      const edge = await page.evaluate(() => {
        const s = document.querySelector('.conv-scroll');
        s.scrollLeft = 10_000;
        const i = document.querySelector('.card-frame').contentDocument.querySelector('img');
        const f = document.querySelector('.card-frame').getBoundingClientRect();
        return { left: s.scrollLeft, imgRight: f.left + i.getBoundingClientRect().right, paneRight: s.getBoundingClientRect().right };
      });
      assert.ok(edge.left > 0 && edge.imgRight <= edge.paneRight, `its right edge in view: ${JSON.stringify(edge)}`);
      // fitted again, the card narrows back
      await page.evaluate(() => (document.querySelector('.conv-scroll').scrollLeft = 0));
      await img.click({ position: { x: 20, y: 20 } });
      await page.waitForFunction(() => {
        const s = document.querySelector('.conv-scroll');
        return s.scrollWidth <= s.clientWidth + 1;
      });
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('a long To line shows a few, then "and N more"', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.locator('.folder-layer .row', { hasText: 'Notes from today' }).first().click();
      const line = page.locator('.reader .recips-line', { hasText: 'To' }).first();
      const more = line.locator('.recips-more');
      await more.waitFor();
      assert.equal(await line.locator('.recip').count(), 3);
      assert.match(await more.textContent(), /^and \d+ more$/);
      const n = Number((await more.textContent()).match(/\d+/)[0]);
      await more.click();
      assert.equal(await line.locator('.recip').count(), 3 + n);
      assert.equal((await more.textContent()).trim(), 'show less');
      await more.click();
      assert.equal(await line.locator('.recip').count(), 3);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('a busy sync', () => {
  test('new mail shows while the Inbox keeps changing and reads are slow', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      // reads take 400 ms, the Inbox is reported changed every 100 ms
      await page.evaluate(() => window.__busySync(400, 100));
      const subject = await page.evaluate(() => window.__newInboxMail());
      try {
        await hasTextWithin(page.locator('.folder-layer .row .row-subject').first(), subject, 4000, 'the new mail in the list');
      } finally {
        await page.evaluate(() => window.__stopBusySync());
      }
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('selected row colours', () => {
  test('in the background the window greys its selection and folder icons', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.locator('.folder-layer .row').nth(1).click();
      await page.mouse.move(5, 5);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const look = () =>
        page.evaluate(() => ({
          row: getComputedStyle(document.querySelector('.folder-layer .row.selected .row-inner')).backgroundColor,
          icon: getComputedStyle(document.querySelector('.folder .folder-icon')).color,
          folder: getComputedStyle(document.querySelector('.folder.selected')).backgroundColor,
        }));
      await page.waitForTimeout(150);
      const front = await look();
      assert.equal(front.row, 'rgb(10, 108, 255)', 'solid blue in front');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(150);
      const back = await look();
      for (const k of ['row', 'icon', 'folder']) assert.notEqual(back[k], front[k], `${k} changes`);
      const grey = (c) => {
        const [r, g, b] = c.match(/[\d.]+/g).map(Number);
        return Math.max(r, g, b) - Math.min(r, g, b) < 16;
      };
      assert.ok(grey(back.row) && grey(back.icon), `grey: ${JSON.stringify(back)}`);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(150);
      assert.deepEqual(await look(), front, 'back to blue');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('only the selected row has them, and only in full while the list has the focus', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      const rows = page.locator('.folder-layer .row');
      const look = (i) =>
        rows.nth(i).evaluate((r) => ({
          vars: r.style.getPropertyValue('--rs-text') !== '',
          subject: getComputedStyle(r.querySelector('.row-subject')).color,
          bg: getComputedStyle(r.querySelector('.row-inner')).backgroundColor,
        }));
      await rows.nth(1).click();
      await page.mouse.move(5, 5); // no hover colour
      await page.waitForTimeout(150);
      const selected = await look(1);
      assert.ok(selected.vars, 'the selected row carries its colours');
      assert.equal(selected.subject, 'rgb(255, 255, 255)');
      const normal = await look(3);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      assert.deepEqual(await look(1), normal, 'the row left behind looks like any other');
      assert.ok((await look(2)).vars);
      // focus elsewhere: still marked, in the quiet colour, normal text
      await page.locator('.search-field input').focus();
      await page.waitForTimeout(150);
      const quiet = await look(2);
      assert.equal(quiet.vars, false);
      assert.equal(quiet.subject, normal.subject);
      assert.notEqual(quiet.bg, normal.bg);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('conversation keyboard', () => {
  test('the Show / Hide rows are on the arrow path too', async () => {
    const { page, errors, close } = await open({ threaded: true });
    try {
      // a conversation with messages in other folders
      const rows = page.locator('.folder-layer .row');
      let found = false;
      for (let i = 0; i < 6 && !found; i++) {
        await rows.nth(i).click();
        await page.waitForSelector('.conv-scroll .card-slot');
        await page.waitForTimeout(200);
        found = (await page.locator('[data-reveal="other"]').count()) > 0;
      }
      assert.ok(found, 'a conversation with hidden messages');
      const cards = await page.locator('.conv-scroll .card-slot').count();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      // up from the first message to the Show buttons
      await page.locator('.conv-scroll .cm-toggle').first().focus();
      const focusedText = () => page.evaluate(() => document.activeElement?.closest('.reveal-row')?.getAttribute('data-reveal') ?? null);
      for (let i = 0; i < 3 && (await focusedText()) !== 'other'; i++) await page.keyboard.press('ArrowUp');
      assert.equal(await focusedText(), 'other');
      await page.keyboard.press('Enter');
      await page.waitForFunction((c) => document.querySelectorAll('.conv-scroll .card-slot').length > c, cards);
      assert.equal(await focusedText(), 'other', 'the focus stays on that row');
      assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ''), /^Hide/);
      await page.keyboard.press('Enter');
      await page.waitForFunction((c) => document.querySelectorAll('.conv-scroll .card-slot').length === c, cards);
      assert.equal(await focusedText(), 'other');
      await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('conv-scroll')), 'Esc: back to scrolling');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('Enter onto the messages, arrows between them, Enter to expand, ; for all', async () => {
    const { page, errors, close } = await open({ threaded: true });
    try {
      // a conversation of several messages, some collapsed
      const rows = page.locator('.folder-layer .row');
      const n = await rows.count();
      let k = -1;
      for (let i = 0; i < n; i++) {
        if (Number((await rows.nth(i).locator('.thread-count').textContent().catch(() => '')) || 0) >= 2) {
          k = i;
          break;
        }
      }
      assert.ok(k >= 0, 'a conversation with several messages');
      await rows.nth(k).click();
      await page.waitForSelector('.conv-scroll .card-slot');
      const expandedCount = () => page.locator('.conv-scroll .card-msg.expanded').count();
      const cards = await page.locator('.conv-scroll .card-slot').count();
      await page.keyboard.press('Enter'); // into the reader
      await page.keyboard.press('Enter'); // onto the message in view
      const onHeader = () => page.evaluate(() => !!document.activeElement?.classList.contains('cm-toggle'));
      assert.ok(await onHeader(), 'a message header has the focus');
      // ; toggles all: some are collapsed, so all open; again, all close
      await page.keyboard.press(';');
      await page.waitForFunction((c) => document.querySelectorAll('.conv-scroll .card-msg.expanded').length === c, cards);
      await page.keyboard.press(';');
      await page.waitForFunction(() => document.querySelectorAll('.conv-scroll .card-msg.expanded').length === 0);
      // first header, then down to the second, and expand it
      await page.locator('.conv-scroll .cm-toggle').first().focus();
      await page.keyboard.press('ArrowDown');
      const at = () => page.evaluate(() => document.activeElement?.closest('.card-slot')?.getAttribute('data-mid'));
      const second = await page.locator('.conv-scroll .card-slot').nth(1).getAttribute('data-mid');
      assert.equal(await at(), second);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.conv-scroll .card-msg.expanded').length === 1);
      assert.equal(await at(), second, 'the focus stays on that message');
      assert.ok(await onHeader());
      await page.keyboard.press(' '); // and collapse it again
      await page.waitForFunction(() => document.querySelectorAll('.conv-scroll .card-msg.expanded').length === 0);
      // Esc: back to scrolling the reader; Esc again: back to the list
      await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('conv-scroll')), 'scrolling the reader');
      await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.folder-layer')), 'back in the list');
      await page.keyboard.press(';'); // one collapsed: all open
      await page.waitForFunction((c) => document.querySelectorAll('.conv-scroll .card-msg.expanded').length === c, cards);
      assert.equal(await expandedCount(), cards);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('snooze', () => {
  test('a day from the calendar and a typed time', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.locator('.folder-layer .row').nth(3).click();
      await page.locator('.reader [aria-label^="Snooze"]').first().click();
      await page.waitForSelector('.snz-cal');
      // the next month's 10th: forward a month, click it
      await page.locator('[aria-label="Next month"]').click();
      await page.locator('.snz-day:not(.out)', { hasText: /^10$/ }).click();
      const time = page.locator('.snz-time');
      await time.fill('2pm');
      await time.press('ArrowUp'); // 2:15 PM
      assert.match(await page.locator('.snz-summary').textContent(), /10 at 2:15/);
      await time.press('Enter');
      await page.waitForSelector('.snooze-menu', { state: 'detached' });
      await page.waitForSelector('.folder-layer .row.selected .snooze-mark');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('search', () => {
  test('deleting a result moves on to the next one', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.fill('.search-field input', 'Northwind');
      await page.waitForSelector('.search-layer .row');
      await page.waitForTimeout(300);
      const subjects = await page.locator('.search-layer .row .row-subject').allTextContents();
      assert.ok(subjects.length >= 2, 'two results at least');
      await page.locator('.search-layer .row').first().click();
      await hasText(reader(page), subjects[0].trim(), 'the first result opens');
      await page.locator('.reader [aria-label="Delete"]').first().click();
      const sel = page.locator('.search-layer .row.selected .row-subject').first();
      await hasText(sel, subjects[1].trim(), 'the next result is selected');
      await hasText(reader(page), subjects[1].trim(), 'and open');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('compose', () => {
  test('a suggested address can be removed for good', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      const popup = context.waitForEvent('page');
      await page.keyboard.press('c');
      const w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      const to = w.locator('input[aria-label="To"]');
      await to.waitFor();
      assert.equal(await w.locator('#boot').count(), 0, 'the outline gives way to the composer');
      await to.fill('a');
      await w.waitForSelector('.addr-sugg-row');
      const first = async () => (await w.locator('.addr-sugg-row .sugg-addr, .addr-sugg-row .sugg-name').first().textContent()).trim();
      const gone = await first();
      const all = await w.locator('.addr-sugg-row').allTextContents();
      await to.press('Shift+Delete');
      await w.waitForFunction((n) => document.querySelectorAll('.addr-sugg-row').length === n - 1, all.length);
      // typed again: still not suggested
      await to.fill('');
      await to.fill('a');
      await w.waitForSelector('.addr-sugg-row');
      await w.waitForTimeout(200);
      const again = await w.locator('.addr-sugg-row').allTextContents();
      assert.ok(!again.some((t) => t.includes(gone)), `${gone} not suggested again: ${again}`);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('accounts', () => {
  test('closing during an export asks: keep exporting, or stop it', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      const who = (await page.locator('.sidebar .account-name').allTextContents())[1];
      const exportIt = async () => {
        await page.keyboard.press('Control+,');
        await page.locator('.st-acct', { hasText: who }).getByRole('button', { name: 'Export…' }).click();
        await page.getByRole('button', { name: 'Choose folder and export…' }).click();
        await page.waitForSelector('.acct-dialog', { state: 'detached' });
        await page.keyboard.press('Escape');
      };
      await exportIt();
      assert.ok(await page.evaluate(() => window.__askClose(false)));
      const ask = page.locator('.modal.confirm');
      await ask.getByText(/An export of .* is still running/).waitFor();
      assert.match(await ask.textContent(), /Closing Email’s window stops it/);
      await ask.getByRole('button', { name: 'Keep exporting' }).click();
      await page.locator('.toast', { hasText: /Exported 40 messages/ }).waitFor({ timeout: 8000 });

      await exportIt();
      await page.evaluate(() => window.__askClose(true));
      await ask.getByRole('button', { name: 'Stop export and quit' }).click();
      await page.locator('.toast', { hasText: /Export stopped/ }).waitFor({ timeout: 8000 });
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('export an account, then remove it', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      const names = () => page.locator('.sidebar .account-name').allTextContents();
      const before = await names();
      const who = before[1];
      await page.keyboard.press('Control+,');
      const card = page.locator('.st-acct', { hasText: who });
      // Esc closes a dialog over Settings, not Settings
      await card.getByRole('button', { name: 'Remove account…' }).click();
      await page.waitForSelector('.acct-dialog');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.acct-dialog', { state: 'detached' });
      assert.equal(await page.locator('.settings').count(), 1, 'Settings still open');
      await card.getByRole('button', { name: 'Export…' }).click();
      const dialog = page.locator('.acct-dialog');
      await dialog.getByText(/messages, as one mbox file per folder/).waitFor();
      await dialog.getByText(/downloaded for the export first/).waitFor();
      await dialog.getByRole('button', { name: 'Choose folder and export…' }).click();
      await page.waitForSelector('.acct-dialog', { state: 'detached' });
      // progress: in the card and in the sync status row
      await card.getByText(/Exporting · /).waitFor();
      await page.waitForFunction(() => /Exporting .* \d+ \/ 40/.test(document.querySelector('.sf-summary')?.getAttribute('title') ?? ''));
      await page.locator('.toast', { hasText: /Exported 40 messages to/ }).waitFor({ timeout: 8000 });
      assert.match(await page.locator('.toast').textContent(), /Show in folder/);
      await card.getByText('Its mail as mbox files').waitFor();

      // remove: says what goes and what stays; then it's gone
      await card.getByRole('button', { name: 'Remove account…' }).click();
      await dialog.getByText('Nothing changes on the server.').waitFor();
      await dialog.getByRole('button', { name: 'Remove account' }).click();
      await page.waitForSelector('.acct-dialog', { state: 'detached' });
      await page.keyboard.press('Escape');
      await page.waitForFunction((w) => ![...document.querySelectorAll('.sidebar .account-name')].some((e) => e.textContent === w), who);
      assert.deepEqual(await names(), before.filter((n) => n !== who));
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('a Microsoft account can turn on tags and snooze', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      // From Settings › Accounts (the sidebar has no + any more).
      assert.equal(await page.locator('.sidebar [aria-label="Add account"]').count(), 0);
      await page.keyboard.press('Control+,');
      await page.locator('.settings .st-nav-item', { hasText: 'Accounts' }).click().catch(() => {});
      await page.getByRole('button', { name: '+ Add account' }).click();
      assert.equal(await page.locator('.settings').count(), 0, 'Settings makes way for the form');
      await page.fill('input[placeholder="you@example.com"]', 'jane@outlook.com');
      await page.getByRole('button', { name: 'Continue with Microsoft' }).click();
      await page.waitForSelector('.sidebar .account-name:has-text("jane@outlook.com")', { timeout: 15000 });
      await page.waitForSelector('.folder-layer .row', { timeout: 15000 });
      await page.locator('.folder-layer .row').first().click();
      const tag = page.locator('.reader .act-btn[aria-label^="Tag"]').first();
      assert.match(await tag.getAttribute('aria-label'), /doesn't keep tags/);
      await page.keyboard.press('Control+,');
      const acct = page.locator('.st-acct', { hasText: 'jane@outlook.com' });
      await acct.getByRole('button', { name: 'Turn on…' }).click();
      await acct.getByText('On, as Outlook categories').waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.reader .act-btn[aria-label^="Tag"]')?.getAttribute('aria-label') === 'Tag');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('the order and markers set by the user come back from the core', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      const names = () => page.locator('.sidebar .account-name').allTextContents();
      const before = await names();
      assert.ok(before.length >= 2, 'the demo has two accounts');
      // Alt+↓ on the first account's header: it moves down one
      await page.locator('.sidebar .account-head').first().focus();
      await page.keyboard.press('Alt+ArrowDown');
      const moved = [before[1], before[0], ...before.slice(2)];
      assert.deepEqual(await names(), moved);
      // Setting a marker reloads the accounts from the core: the order holds
      await page.keyboard.press('Control+,');
      const acct = page.locator('.st-acct', { hasText: before[0] });
      await acct.locator('.st-mark-letter').fill('w');
      await acct.locator('.st-swatch[title="Teal"]').click();
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      const dot = page.locator('.sidebar .account', { hasText: before[0] }).locator('.acct-dot');
      await hasText(dot, 'W', 'the marker letter');
      assert.equal(await dot.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(65, 200, 182)');
      assert.deepEqual(await names(), moved);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('sorting', () => {
  /** The list's canvas in DOM order: headers ({ head, count }) and rows ({ from, unread }). */
  const listed = (page) =>
    page.locator('.folder-layer .list-canvas').evaluate((c) =>
      [...c.children].map((el) =>
        el.classList.contains('group-head')
          ? { head: el.querySelector('.group-label')?.textContent ?? '', count: el.querySelector('.group-count')?.textContent ?? null }
          : { from: el.querySelector('.row-from')?.textContent ?? '', unread: el.classList.contains('unread') },
      ),
    );
  async function sortBy(page, label) {
    await page.click('.view-menu-btn');
    await page.locator('.view-menu .vm-item', { hasText: label }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  test('by date, the list is grouped into periods, newest first', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      const items = await listed(page);
      const heads = items.filter((x) => x.head != null).map((x) => x.head);
      assert.ok(items[0].head != null, 'a header comes first');
      const order = ['Today', 'Yesterday', 'Sunday', 'Saturday', 'Friday', 'Thursday', 'Wednesday', 'Tuesday', 'Monday', 'Last week', 'Two weeks ago', 'Three weeks ago', 'September', 'August'];
      const ranks = heads.map((h) => order.indexOf(h)).filter((r) => r >= 0);
      assert.ok(ranks.length >= 2, `known periods among ${heads}`);
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `periods in order: ${heads}`);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('by sender: one header per sender over their messages; conversations are off; N follows the order', async () => {
    const { page, errors, close } = await open({ threaded: true });
    try {
      await sortBy(page, 'From');
      // Down to where the first sender's messages end and the next one's begin.
      const firstCount = Number(await page.locator('.folder-layer .group-head .group-count').first().textContent());
      await page.locator('.folder-layer .list-scroll').evaluate((el, n) => (el.scrollTop = (n - 4) * 72), firstCount);
      await page.waitForTimeout(300);
      await page.click('.view-menu-btn');
      assert.equal(await page.locator('.view-menu .vm-item', { hasText: 'Group by conversation' }).getAttribute('aria-disabled'), 'true');
      await page.keyboard.press('Escape');
      const items = await listed(page);
      let head = null;
      const heads = [];
      for (const x of items) {
        if (x.head != null) {
          head = x.head;
          heads.push(head.toLowerCase());
        } else if (x.from && head != null) assert.equal(x.from.toLowerCase(), head.toLowerCase(), 'each row under its sender');
      }
      // A boundary: the rows above the header are someone else's.
      const k = items.findIndex((x) => x.head != null);
      assert.ok(k > 0, 'a header with rows above it');
      assert.notEqual(items[k - 1].from.toLowerCase(), items[k].head.toLowerCase(), 'the sender changes at the header');
      assert.ok(Number(items[k].count) > 0, 'with a count');
      assert.deepEqual(heads, [...heads].sort(), 'senders A to Z');
      // N goes to the first unread one in this order.
      await page.locator('.folder-layer .list-scroll').evaluate((el) => (el.scrollTop = 0));
      await page.waitForTimeout(300);
      const top = (await listed(page)).filter((x) => x.head == null);
      const firstUnread = top.findIndex((x) => x.unread);
      assert.ok(firstUnread >= 0, 'an unread one near the top');
      await page.locator('.folder-layer .list-scroll').focus();
      await page.keyboard.press('n');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.folder-layer .row.selected').getAttribute('id'), `row-${firstUnread}`);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('archiving in a group takes one off its count; undo puts it back', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await sortBy(page, 'From');
      const first = page.locator('.folder-layer .group-head').first();
      const before = Number(await first.locator('.group-count').textContent());
      await page.locator('.folder-layer .row').first().click();
      await page.waitForTimeout(300);
      await page.locator('.reader [aria-label="Archive"]').first().click();
      await hasText(first.locator('.group-count'), String(before - 1), 'one fewer in the group');
      await page.locator('.toast button', { hasText: 'Undo' }).click();
      await page.waitForTimeout(400);
      await hasText(page.locator('.folder-layer .group-head').first().locator('.group-count'), String(before), 'back again');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('group headers', () => {
  test("a header's click picks its group; its trash deletes them all after asking", async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.click('.view-menu-btn');
      await page.locator('.view-menu .vm-item', { hasText: 'From' }).click();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      // A sender with several messages.
      const heads = page.locator('.folder-layer .group-head');
      const counts = await heads.locator('.group-count').allTextContents();
      const k = counts.findIndex((c) => Number(c) >= 2);
      assert.ok(k >= 0, `a group of two or more: ${counts}`);
      const head = heads.nth(k);
      const n = Number(counts[k]);
      const label = (await head.locator('.group-label').textContent()).trim();
      await head.click();
      await hasText(page.locator('.multi-pane .reader-subject'), `${n} messages selected`, 'the group picked');
      await page.keyboard.press('Escape');
      await head.hover();
      await head.locator('.group-del').click();
      assert.match(await page.locator('.confirm-backdrop .confirm-text').textContent(), new RegExp(`Delete ${n} messages in`));
      await page.locator('.confirm-backdrop .btn.danger').click();
      await page.locator('.toast', { hasText: `Deleted ${n} messages` }).waitFor();
      await page.waitForTimeout(300);
      const left = await page.locator('.folder-layer .group-head .group-label').allTextContents();
      assert.ok(!left.map((x) => x.trim()).includes(label), 'the group is gone');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('size and filters', () => {
  const sizeOf = (t) => {
    const [n, u] = t.trim().split(' ');
    return Number(n) * ({ B: 1, KB: 1024, MB: 2 ** 20, GB: 2 ** 30 }[u] ?? 1);
  };
  async function menu(page, label) {
    await page.click('.view-menu-btn');
    await page.locator('.view-menu .vm-item', { hasText: label }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  test('by size: largest first, under size ranges, sizes shown', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await menu(page, 'Size');
      const sizes = await page.locator('.folder-layer .row .row-size').allTextContents();
      assert.ok(sizes.length > 5, 'sizes on the rows');
      const bytes = sizes.map(sizeOf);
      assert.deepEqual(bytes, [...bytes].sort((a, b) => b - a), `largest first: ${sizes.slice(0, 8)}`);
      const head = await page.locator('.folder-layer .group-head .group-label').first().textContent();
      assert.match(head, /^(Huge|Very large|Large|Medium|Small|Tiny) \(/);
      assert.ok(Number(await page.locator('.folder-layer .group-head .group-count').first().textContent()) > 0);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('unread only: the list shows just those, says so, and the one opened stays', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      const all = await page.locator('.folder-layer .list-sub').textContent();
      await menu(page, 'Unread only');
      await page.waitForSelector('.folder-layer .filter-bar');
      assert.match(await page.locator('.folder-layer .filter-what').textContent(), /Unread/);
      const rows = page.locator('.folder-layer .row');
      const n = await rows.count();
      assert.ok(n > 0);
      assert.equal(await page.locator('.folder-layer .row:not(.unread)').count(), 0, 'only unread rows');
      assert.notEqual(await page.locator('.folder-layer .list-sub').textContent(), all, 'fewer messages');
      // Opening one reads it; it stays (with the others) until something else is opened.
      await rows.first().click();
      await page.waitForTimeout(1200);
      const subject = await selected(page).textContent();
      assert.equal(await page.locator('.folder-layer .row', { hasText: subject }).count(), 1, 'the opened one stays');
      // Show all again.
      await page.locator('.folder-layer .filter-clear').click();
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.folder-layer .filter-bar').count(), 0);
      assert.ok((await page.locator('.folder-layer .row:not(.unread)').count()) > 0, 'read ones back');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('with attachments, in conversations too', async () => {
    const { page, errors, close } = await open({ threaded: true });
    try {
      await menu(page, 'With attachments only');
      await page.waitForSelector('.folder-layer .filter-bar');
      const rows = await page.locator('.folder-layer .row').count();
      assert.ok(rows > 0, 'some conversations with attachments');
      assert.equal(await page.locator('.folder-layer .row').filter({ hasNot: page.locator('.clip') }).count(), 0, 'each shows a paperclip');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('folder menu', () => {
  test('right-click a folder: Mark all as read', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      const inbox = page.locator('.sidebar .folder', { hasText: 'Inbox' }).first();
      const badge = inbox.locator('.badge');
      assert.ok(Number((await badge.textContent()).replace(/\D/g, '')) > 0, 'unread to begin with');
      await inbox.click({ button: 'right' });
      await page.locator('.ctx-menu .vm-item', { hasText: 'Mark all as read' }).click();
      await page.waitForSelector('.toast:has-text("as read")');
      await page.waitForTimeout(300);
      assert.equal(await badge.count(), 0, 'no unread badge');
      assert.equal(await page.locator('.folder-layer .row.unread').count(), 0, 'no unread rows');
      // Nothing left: the item is greyed out.
      await inbox.click({ button: 'right' });
      assert.equal(await page.locator('.ctx-menu .vm-item', { hasText: 'Mark all as read' }).isDisabled(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.ctx-menu').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('signatures', () => {
  test('made in Settings, a new message gets the account default; it can be switched or taken off', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
      await page.locator('.st-nav-item', { hasText: 'Signatures' }).click();
      await page.locator('.sig-add').click();
      await page.waitForFunction(() => document.querySelector('.sig-name')?.value === 'Signature');
      await page.locator('.sig-name').fill('Work');
      await page.locator('.sig-editor .ProseMirror').click();
      await page.keyboard.type('Lars Pehrsson, Example AB');
      await page.waitForTimeout(700);
      await page.locator('.sig-add').click();
      await page.waitForFunction(() => document.querySelector('.sig-name')?.value === 'Signature 2');
      await page.locator('.sig-name').fill('Short');
      await page.locator('.sig-editor .ProseMirror').click();
      await page.keyboard.type('/L');
      await page.waitForTimeout(700);
      assert.deepEqual(await page.locator('.sig-item').allTextContents(), ['Work', 'Short']);
      await page.locator('select.sig-default').first().selectOption({ label: 'Work' });
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      const popup = context.waitForEvent('page');
      await page.keyboard.press('c');
      const w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      await w.locator('.cmp-sig-body').waitFor();
      assert.equal((await w.locator('.cmp-sig-body').textContent()).trim(), 'Lars Pehrsson, Example AB');
      // The picker shows the one in use (not "No signature").
      await w.waitForTimeout(300);
      assert.equal(await w.locator('select.cmp-sig-select').evaluate((e) => e.options[e.selectedIndex]?.text), 'Work');
      await w.locator('select.cmp-sig-select').selectOption({ label: 'Short' });
      await hasText(w.locator('.cmp-sig-body'), '/L', 'switched');
      await w.locator('select.cmp-sig-select').selectOption({ label: 'No signature' });
      await w.waitForTimeout(100);
      assert.equal(await w.locator('.cmp-sig-body').count(), 0, 'taken off');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('signature defaults', () => {
  test("choosing one account's default leaves the others' as they were", async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
      await page.locator('.st-nav-item', { hasText: 'Signatures' }).click();
      for (const name of ['Work', 'Home', 'Short']) {
        await page.locator('.sig-add').click();
        await page.waitForTimeout(150);
        await page.locator('.sig-name').fill(name);
        await page.waitForTimeout(650);
      }
      const selects = page.locator('select.sig-default');
      assert.ok((await selects.count()) >= 4, 'two accounts, two choices each');
      const shown = () => selects.evaluateAll((els) => els.map((e) => e.options[e.selectedIndex]?.text));
      await selects.nth(0).selectOption({ label: 'Home' });
      await page.waitForTimeout(250);
      await selects.nth(1).selectOption({ label: 'Short' });
      await page.waitForTimeout(250);
      await selects.nth(2).selectOption({ label: 'Work' });
      await page.waitForTimeout(250);
      await selects.nth(3).selectOption({ label: 'Home' });
      await page.waitForTimeout(400);
      assert.deepEqual((await shown()).slice(0, 4), ['Home', 'Short', 'Work', 'Home']);
      // Renaming a signature (the list reloads) changes no one's choice either.
      await page.locator('.sig-item', { hasText: 'Work' }).click();
      await page.locator('.sig-name').fill('Work 2');
      await page.waitForTimeout(800);
      assert.deepEqual((await shown()).slice(0, 4), ['Home', 'Short', 'Work 2', 'Home']);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('signature html', () => {
  test('a signature pasted as HTML keeps its colours, opens as HTML again, and goes into the message', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
      await page.locator('.st-nav-item', { hasText: 'Signatures' }).click();
      await page.locator('.sig-add').click();
      await page.waitForFunction(() => document.querySelector('.sig-name')?.value === 'Signature');
      await page.locator('.sig-html-btn').click();
      assert.equal(await page.locator('.sig-editor').isVisible(), false);
      await page.locator('textarea.sig-html').fill('<p style="color:#c00">Lars</p><table><tr><td style="color:navy">PaperCut</td></tr></table>');
      await page.waitForTimeout(800);
      await page.locator('.sig-preview p[style*="color"]').waitFor();
      assert.equal(await page.locator('.sig-html-btn').getAttribute('aria-pressed'), 'true');
      // Going back to the simple editor would lose the colours: asked first.
      await page.locator('.sig-html-btn').click();
      await page.locator('.confirm-backdrop').waitFor();
      await page.locator('.confirm-backdrop .btn', { hasText: 'Cancel' }).click();
      assert.equal(await page.locator('textarea.sig-html').count(), 1, 'still HTML');
      await page.locator('select.sig-default').first().selectOption({ label: 'Signature' });
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      const popup = context.waitForEvent('page');
      await page.keyboard.press('c');
      const w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      await w.locator('.cmp-sig-body p[style*="color"]').waitFor();
      assert.match(await w.locator('.cmp-sig-body').textContent(), /PaperCut/);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('pictures in a message', () => {
  test('a picture pasted into the message goes in where the cursor is, not attached', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      const popup = context.waitForEvent('page');
      await page.keyboard.press('c');
      const w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      const body = w.locator('.cmp-editor .ProseMirror');
      await body.waitFor();
      await body.click();
      await w.keyboard.type('Here it is: ');
      await body.evaluate(async (el) => {
        const c = document.createElement('canvas');
        c.width = 3000;
        c.height = 1500;
        const g = c.getContext('2d');
        g.fillStyle = '#3a7';
        g.fillRect(0, 0, 3000, 1500);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      const img = w.locator('.cmp-editor img[src^="data:image/"]');
      await img.waitFor();
      assert.equal(await img.evaluate((i) => i.decode().then(() => i.naturalWidth)), 1600, 'scaled down');
      assert.ok(Number(await img.getAttribute('width')) <= 640);
      assert.equal(await w.locator('.cmp-att').count(), 0, 'not an attachment');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('signature pictures', () => {
  test('a picture pasted or chosen goes in, scaled, and shows in the composer', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
      await page.locator('.st-nav-item', { hasText: 'Signatures' }).click();
      await page.locator('.sig-add').click();
      await page.waitForFunction(() => document.querySelector('.sig-name')?.value === 'Signature');
      await page.locator('.sig-editor .ProseMirror').click();
      await page.keyboard.type('Lars ');
      // Paste a 2000×1000 picture (a big screenshot): it comes in scaled down to 800 wide.
      await page.locator('.sig-editor .ProseMirror').evaluate(async (el) => {
        const c = document.createElement('canvas');
        c.width = 2000;
        c.height = 1000;
        const g = c.getContext('2d');
        g.fillStyle = '#e33';
        g.fillRect(0, 0, 2000, 1000);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'logo.png', { type: 'image/png' }));
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      const img = page.locator('.sig-editor img[src^="data:image/png"]');
      await img.waitFor();
      const natural = await img.evaluate((i) => (i.decode ? i.decode().then(() => i.naturalWidth) : i.naturalWidth));
      assert.equal(natural, 800, 'scaled down');
      assert.ok(Number(await img.getAttribute('width')) <= 300, 'shown at most 300 wide');
      // And one chosen with the button.
      const png = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 40;
        c.getContext('2d').fillRect(0, 0, 40, 40);
        return c.toDataURL('image/png').split(',')[1];
      });
      await page.locator('.sig-edit input[type="file"]').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      // (ProseMirror puts spacer <img>s of its own around inline nodes: count pictures.)
      await page.waitForFunction(() => document.querySelectorAll('.sig-editor img[src^="data:"]').length === 2);
      await page.waitForTimeout(800);
      await page.locator('select.sig-default').first().selectOption({ label: 'Signature' });
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      const popup = context.waitForEvent('page');
      await page.keyboard.press('c');
      const w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      await w.locator('.cmp-sig-body img').first().waitFor();
      assert.equal(await w.locator('.cmp-sig-body img[src^="data:image/png"]').count(), 2, 'both in the preview');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('sender pane', () => {
  test('shows everything from the sender; select all, delete, undo', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.locator('.folder-layer .row').first().click();
      const from = (await page.locator('.folder-layer .row.selected .row-from').textContent()).trim();
      await page.keyboard.press('ControlOrMeta+2');
      await hasText(page.locator('.sp-name'), from, 'the sender of the message on screen');
      /** The sender's total ("12 messages", "3 of 12 selected"). */
      const count = async () => {
        const t = await page.locator('.sp-all').textContent();
        return Number((t.includes(' of ') ? t.split(' of ')[1] : t).replace(/[^\d]/g, ''));
      };
      const before = await count();
      assert.ok(before >= 1);
      assert.equal(await page.locator('.sp-row.current').count(), 1, 'the open one is marked');
      assert.equal(await page.locator('.sp-row input[type="checkbox"]').count(), 0, 'no tick boxes');
      // A click picks one; ⌘/Ctrl+A in the panel all of them.
      await page.locator('.sp-row').first().click();
      assert.equal(await page.locator('.sp-row.on').count(), 1);
      await page.keyboard.press('ControlOrMeta+a');
      // (Everything from the sender comes in first, then it's all picked.)
      await page.waitForFunction(() => document.querySelectorAll('.sp-row.on').length > 1);
      const picked = await page.locator('.sp-row.on').count();
      assert.equal(picked, await page.locator('.sp-row').count(), 'all shown are picked');
      assert.equal(await page.locator('.folder-layer .multi-pane').count(), 0, "the list's selection is its own");
      await page.keyboard.press('Delete');
      if (picked > 1) await page.locator('.confirm-backdrop .btn.danger').click();
      await page.locator('.toast', { hasText: 'Deleted' }).waitFor();
      await page.waitForFunction(
        (n) => {
          const t = document.querySelector('.sp-all')?.textContent ?? '';
          return Number((t.includes(' of ') ? t.split(' of ')[1] : t).replace(/[^\d]/g, '')) === n;
        },
        before - picked,
      );
      await page.locator('.toast button', { hasText: 'Undo' }).click();
      await page.waitForFunction((n) => {
        const t = document.querySelector('.sp-all')?.textContent ?? '';
        return Number((t.includes(' of ') ? t.split(' of ')[1] : t).replace(/[^\d]/g, '')) === n;
      }, before);
      // Off again, remembered.
      await page.keyboard.press('ControlOrMeta+2');
      assert.equal(await page.locator('.sender-pane').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('images', () => {
  test('always from this sender: its other mail loads images too; Settings lists it', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.fill('.search-field input', 'from:lumengoods');
      await page.waitForSelector('.search-layer .row');
      await page.waitForTimeout(400);
      const fromSender = page.locator('.search-layer .row');
      assert.ok((await fromSender.count()) >= 2, 'two from the sender');
      await fromSender.nth(0).click();
      const banner = page.locator('.reader .remote-banner');
      await banner.waitFor();
      await banner.getByRole('button', { name: 'Always from this sender' }).click();
      await page.waitForTimeout(500);
      assert.equal(await banner.count(), 0, 'loaded');
      await fromSender.nth(1).click();
      await page.waitForTimeout(800);
      assert.equal(await page.locator('.reader .remote-banner').count(), 0, 'the next one too');
      await page.keyboard.press('ControlOrMeta+,');
      await page.locator('.st-nav-item', { hasText: 'General' }).click();
      await page.locator('.st-remote-senders li').first().waitFor();
      assert.match(await page.locator('.st-remote-senders').textContent(), /lumen/i);
      await page.locator('.st-remote-senders .link-btn').first().click();
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.st-remote-senders li').count(), 0, 'removed');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('account picture', () => {
  test('a picture of your own for an account shows in the sidebar and the sync status', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.keyboard.press('ControlOrMeta+,');
      await page.locator('.st-nav-item', { hasText: 'Accounts' }).click();
      const png = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 300;
        const g = c.getContext('2d');
        g.fillStyle = '#e33';
        g.fillRect(0, 0, 300, 300);
        return c.toDataURL('image/png').split(',')[1];
      });
      // The file dialog takes the window's focus: Settings stays.
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await page.locator('.settings').count(), 1, 'still open');
      await page.locator('.st-mark-pic input[type="file"]').first().setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await page.locator('.st-mark-pic .acct-dot img').first().waitFor();
      const natural = await page.locator('.st-mark-pic .acct-dot img').first().evaluate((i) => i.naturalWidth);
      assert.equal(natural, 128, 'scaled down');
      await page.keyboard.press('Escape');
      await page.locator('.sidebar .account-head .acct-dot img').first().waitFor();
      await page.click('.sf-summary');
      assert.equal(await page.locator('.sync-popover .acct-dot img').count(), 1, 'in the sync status too');
      // Taken away again: the letter.
      await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+,');
      await page.locator('.st-mark-pic .link-btn', { hasText: 'Remove' }).first().click();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.sidebar .account-head .acct-dot img').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('google contacts', () => {
  test('connect (asking for the OAuth client first), contacts arrive marked, new ones can go there, disconnect', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.keyboard.press('ControlOrMeta+,');
      await page.locator('.st-nav-item', { hasText: 'Accounts' }).click();
      const field = page.locator('.st-acct').first().locator('.gc');
      await field.getByRole('button', { name: 'Connect Google Contacts…' }).click();
      // No client yet: asked for it.
      await field.locator('input[aria-label="Google client ID"]').fill('not-a-client');
      await field.getByRole('button', { name: 'Save' }).click();
      await field.locator('.st-status.error').waitFor();
      await field.locator('input[aria-label="Google client ID"]').fill('123-abc.apps.googleusercontent.com');
      await field.locator('input[aria-label="Google client secret"]').fill('GOCSPX-x');
      await field.getByRole('button', { name: 'Save' }).click();
      await field.locator('.gc-linked').waitFor();
      assert.match(await field.locator('.gc-linked').textContent(), /3 contacts/);
      assert.match(await page.locator('.gc-client-note').textContent(), /123…/);
      await page.keyboard.press('Escape');
      // In the address book: theirs marked; a new one can be saved in Google.
      await page.keyboard.press('ControlOrMeta+Shift+b').catch(() => {});
      if ((await page.locator('.contacts').count()) === 0) await page.locator('.sidebar [aria-label="Address book"]').click();
      await page.locator('.ct-row', { hasText: 'Olivia Hart' }).waitFor();
      assert.equal(await page.locator('.ct-row', { hasText: 'Olivia Hart' }).locator('.ct-google').count(), 1);
      await page.locator('.ct-row', { hasText: 'Olivia Hart' }).click();
      assert.match(await page.locator('.ct-where-text').textContent(), /Google Contacts/);
      await page.locator('[aria-label="New contact"]').click();
      const saveIn = page.locator('select.ct-save-in');
      await saveIn.waitFor();
      assert.equal(await saveIn.locator('option').count(), 2, 'this computer, or the Google account');
      await page.keyboard.press('Escape');
      // Disconnect: its contacts leave the address book.
      await page.keyboard.press('ControlOrMeta+,');
      await page.locator('.st-nav-item', { hasText: 'Accounts' }).click();
      await page.locator('.st-acct').first().locator('.gc').getByRole('button', { name: 'Disconnect' }).click();
      // (The question comes over Settings.)
      await page.locator('.confirm-backdrop .btn', { hasText: 'Disconnect' }).click();
      await page.locator('.st-acct').first().getByRole('button', { name: 'Connect Google Contacts…' }).waitFor();
      const cards = await page.evaluate(() => JSON.parse(localStorage.getItem('mock.cards') ?? '[]'));
      assert.ok(!cards.some((c) => c.google != null), 'their cards went');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('message source', () => {
  test('right-click › Show source; a question about it is answered; ⌥⌘U opens it too', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.evaluate(() => localStorage.setItem('mock.aiKey', 'sk-ant-demo'));
      const row = page.locator('.folder-layer .row').first();
      const subject = (await row.locator('.row-subject').textContent()).trim();
      await row.click({ button: 'right' });
      await page.locator('.ctx-menu .vm-item', { hasText: 'Show source' }).click();
      const src = page.locator('.source-view .src-text');
      await page.waitForFunction(() => document.querySelector('.source-view .src-text')?.textContent?.includes('Subject:'));
      assert.ok((await src.textContent()).includes(`Subject: ${subject}`));
      await page.locator('.source-view .chip-toggle', { hasText: 'spam' }).click();
      await page.waitForFunction(() => document.querySelector('.source-view .src-answer')?.textContent?.includes('X-Spam-Status'));
      // (Esc while it's answering stops the answer; once done, it closes.)
      await page.locator('.source-view .src-form button', { hasText: 'Ask' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.source-view').count(), 0);
      await row.click();
      await page.keyboard.press('ControlOrMeta+Alt+u');
      await page.locator('.source-view').waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('move list', () => {
  test("the folders with most of the sender's mail come first", async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      await page.locator('.folder-layer .row', { hasText: 'Invoicely' }).first().click();
      await page.locator('.reader [aria-label^="Move to"]').first().click();
      await page.locator('.move-picker .mp-row').first().waitFor();
      await page.waitForTimeout(200);
      const rows = await page.locator('.move-picker .mp-row').evaluateAll((els) =>
        els.map((e) => ({ name: e.querySelector('.mp-name')?.textContent, n: Number(e.querySelector('.mp-count')?.textContent?.replace(/\D/g, '') || 0) })),
      );
      const counted = rows.filter((r) => r.n > 0);
      assert.ok(counted.length >= 1, `some folders hold the sender's mail: ${JSON.stringify(rows.slice(0, 5))}`);
      assert.deepEqual(rows.slice(0, counted.length), counted, 'those first');
      assert.deepEqual(counted.map((r) => r.n), [...counted.map((r) => r.n)].sort((a, b) => b - a), 'most first');
      assert.ok(!counted.some((r) => /All Mail|Inbox|Sent|Trash|Spam/.test(r.name)), 'not the folders everything is in');
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('several messages', () => {
  const rows = (page) => page.locator('.folder-layer .row');
  const title = (page) => page.locator('.multi-pane .reader-subject');

  test('⌘/Ctrl-click and ⇧-click pick rows; one Delete for all; Undo picks them again', async () => {
    const { page, errors, close } = await open({ threaded: false });
    try {
      const ids = async () => page.locator('.folder-layer .row').evaluateAll((els) => els.map((e) => e.dataset.id));
      const before = await ids();
      const gone = before.slice(2, 6);
      await rows(page).nth(0).click();
      await rows(page).nth(2).click({ modifiers: ['ControlOrMeta'] });
      await hasText(title(page), '2 messages selected', 'two picked');
      assert.equal(await page.locator('.folder-layer .row.selected').count(), 2);
      await rows(page).nth(5).click({ modifiers: ['Shift'] });
      await hasText(title(page), '4 messages selected', 'rows 2 to 5');
      await page.locator('.multi-pane [aria-label="Delete"]').click();
      // More than one: asked first.
      assert.match(await page.locator('.confirm-backdrop .confirm-text').textContent(), /Delete 4 messages\?/);
      await page.locator('.confirm-backdrop .btn.danger').click();
      await page.locator('.toast', { hasText: 'Deleted 4 messages' }).waitFor();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.multi-pane').count(), 0, 'back to one');
      const after = await ids();
      assert.ok(gone.every((id) => !after.includes(id)), 'the four are gone');
      assert.ok(after.includes(before[6]), 'the rows below moved up');
      await page.locator('.toast button', { hasText: 'Undo' }).click();
      await hasText(title(page), '4 messages selected', 'picked again');
      await page.waitForFunction((g) => {
        const shown = [...document.querySelectorAll('.folder-layer .row')].map((e) => e.dataset.id);
        return g.every((id) => shown.includes(id));
      }, gone);
      // Esc: just the open one again.
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.multi-pane').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('⌘/Ctrl+A picks the whole folder, conversations too; ⇧-arrows extend', async () => {
    const { page, errors, close } = await open({ threaded: true });
    try {
      const total = Number((await page.locator('.folder-layer .list-sub span').nth(2).textContent()).replace(/[^\d]/g, ''));
      await rows(page).nth(1).click();
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
      await hasText(title(page), '3 conversations selected', 'extended down');
      await page.keyboard.press('ControlOrMeta+a');
      await hasText(title(page), `${total.toLocaleString('en-US')} conversations selected`, 'all of them');
      assert.match(await page.locator('.multi-pane .band-meta').textContent(), /messages/);
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.locator('.multi-pane').count(), 0, 'moving on picks one again');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  test('forward several as attachments', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      await rows(page).nth(0).click();
      await rows(page).nth(1).click({ modifiers: ['ControlOrMeta'] });
      await hasText(title(page), '2 messages selected', 'two picked');
      const popup = context.waitForEvent('page');
      await page.locator('.multi-pane [aria-label="Forward as attachments"]').click();
      const w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      await w.locator('.cmp-att-msg').first().waitFor();
      assert.equal(await w.locator('.cmp-att-msg').count(), 2);
      assert.match(await w.locator('.cmp-att-msg .cmp-att-name').first().textContent(), /\.eml$/);
      assert.equal(await w.locator('#cmp-subject').inputValue(), 'Fwd: 2 messages');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('writing help', () => {
  test('without a key it says where to add one; with one, a reply is written and used', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      await page.locator('.folder-layer .row').first().click();
      await page.waitForTimeout(300);
      let popup = context.waitForEvent('page');
      await page.locator('.reader [aria-label="Reply"]').first().click();
      let w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      await w.locator('.fmt-ai').click();
      await w.locator('.ai-note').waitFor();
      await w.close();
      await page.bringToFront();

      await page.keyboard.press('ControlOrMeta+,');
      await page.locator('.st-nav-item', { hasText: 'AI' }).click();
      await page.locator('input.ai-key').fill('sk-ant-test');
      await page.locator('.st-pane button', { hasText: 'Save' }).click();
      await page.locator('.st-pane button', { hasText: 'Try it' }).click();
      await hasText(page.locator('.st-status'), 'Works! — Claude Opus 5.5', 'the key works');
      await page.keyboard.press('Escape');

      popup = context.waitForEvent('page');
      await page.locator('.reader [aria-label="Reply"]').first().click();
      w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      await w.locator('.cmp-editor .ProseMirror').waitFor();
      await w.keyboard.press('ControlOrMeta+j');
      await w.locator('.ai-input').fill('yes, Thursday works');
      await w.keyboard.press('Enter');
      await w.locator('.ai-panel button', { hasText: 'Use this' }).click();
      const body = await w.locator('.cmp-editor .ProseMirror').innerText();
      assert.ok(body.includes('Yes, Thursday works.'), body);
      assert.equal(await w.locator('.ai-panel').count(), 0, 'the panel closes');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('address book', () => {
  test('a sender added from the panel is kept, suggested first, and can be written to', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      await page.locator('.folder-layer .row').first().click();
      const from = (await page.locator('.folder-layer .row.selected .row-from').textContent()).trim();
      await page.keyboard.press('ControlOrMeta+2');
      await page.locator('.sp-card', { hasText: 'Add to contacts' }).click();
      await page.locator('.contacts').waitFor();
      assert.equal(await page.locator('.ct-big').inputValue(), from, 'prefilled with the sender');
      await page.locator('.ct-big').fill(`${from} (work)`);
      await page.locator('.ct-field', { hasText: 'Company' }).locator('input').fill('Acme');
      await page.locator('.ct-actions button', { hasText: 'Save' }).click();
      await hasText(page.locator('.ct-row .ct-name').first(), `${from} (work)`, 'listed');
      await page.keyboard.press('Escape');
      await page.locator('.contacts').waitFor({ state: 'detached' });
      await hasText(page.locator('.sp-card'), 'In contacts', 'the panel knows them now');

      const popup = context.waitForEvent('page');
      await page.keyboard.press('c');
      const w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      await w.locator('input[aria-label="To"]').fill('acm');
      await hasText(w.locator('.addr-sugg-row .sugg-name').first(), `${from} (work)`, 'found by company, first, under its own name');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});
