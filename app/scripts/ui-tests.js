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
  test('a message body (its own frame) counts as the window: clicking in it stays blue, and brings the window back', async () => {
    const { page, errors, close } = await open({ threaded: false, query: '&picture' });
    try {
      await page.locator('.folder-layer .row', { hasText: 'picture as the body' }).first().click();
      const frame = page.frameLocator('.reader iframe').first();
      await frame.locator('img').waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const icon = () => page.evaluate(() => getComputedStyle(document.querySelector('.folder .folder-icon')).color);
      await page.waitForTimeout(150);
      const blue = await icon();
      // into the body: the page blurs, the window doesn't
      await frame.locator('body').click({ position: { x: 5, y: 5 } });
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'IFRAME');
      assert.equal(await icon(), blue, 'still blue with the focus in the message');
      // another window in front, then back by a click into the body: only the frame is focused
      await page.locator('.reader h1').first().click();
      assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'IFRAME');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(150);
      assert.notEqual(await icon(), blue, 'grey in the background');
      await page.evaluate(() => document.querySelector('.reader iframe').contentWindow.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(150);
      assert.equal(await icon(), blue, 'blue again');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

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

describe('mac title band', () => {
  test('with the sidebar folded, the rail top is the colour of the search row beside it', async () => {
    const { page, errors, close } = await open({ threaded: false, query: '&mac' });
    try {
      await page.keyboard.press('Meta+1');
      await page.waitForSelector('.app.rail-mode');
      await page.waitForTimeout(300);
      const rail = await page.locator('.pane-sidebar').boundingBox();
      const band = await page.locator('.search-bar').first().boundingBox();
      // one pixel each, in the band above the search field (where the traffic lights sit)
      const pixel = (x, y) => page.screenshot({ clip: { x, y, width: 1, height: 1 } });
      const left = await pixel(rail.x + 4, 4);
      const right = await pixel(band.x + band.width / 2, band.y + 4);
      assert.ok(left.equals(right), 'one colour across the band');
      // and below the band the rail keeps its own colour
      assert.ok(!(await pixel(rail.x + 4, band.y + band.height + 40)).equals(right), 'the rail below is the sidebar colour');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });
});

describe('compose', () => {
  test('a pasted picture goes into the text', async () => {
    const { page, errors, context, close } = await open({ threaded: false });
    try {
      const popup = context.waitForEvent('page');
      await page.keyboard.press('c');
      const w = await popup;
      w.on('pageerror', (e) => errors.push(e.message));
      const editor = w.locator('.cmp-editor .ProseMirror');
      await editor.waitFor();
      await editor.click();
      await w.keyboard.type('Look: ');
      await editor.evaluate((el) => {
        // a 1×1 PNG, as a screenshot or "Copy image" puts it on the clipboard
        const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      const img = editor.locator('img[src^="data:image/png;base64,"]');
      await img.waitFor();
      assert.match(await editor.innerHTML(), /Look:\s*(&nbsp;)?\s*<img/);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

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
      await page.locator('[aria-label="Add account"]').first().click();
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
