// The README's screenshots (docs/screenshots/*.png), taken from the browser preview and its mock
// backend (src/mock.ts: John Doe, invented mail). Run after UI changes:
//
//   cd app && npm run screenshots              # every scene
//   cd app && npm run screenshots -- inbox     # only scenes whose name contains "inbox"
//
// Uses the installed Google Chrome (or CHROME=/path/to/chromium). The clock, time zone, window
// size and remote images are fixed, so an unchanged UI gives unchanged files.
//
// Each shot is framed as a macOS window (`frame`): rounded corners, an outline and a shadow on a
// transparent background, so they stand apart on the page in light and dark. The main window is
// shot in the app's macOS layout (`?mac`), which keeps room for the traffic lights over its top
// band, and they're drawn there; a compose window gets the title bar it has on macOS.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(APP, '..', 'docs', 'screenshots');
/** "Now" in every screenshot: a Tuesday morning. */
const NOW = new Date('2026-10-13T09:41:00-04:00');
const SIZE = { width: 1280, height: 800 };

// ------------------------------------------------------------- scenes

/** name → what to do before the shot; `shot` takes the page, or a compose window. */
const SCENES = [
  {
    // The main window: accounts and folders, the list, a conversation open.
    name: 'inbox',
    themes: ['light', 'dark'],
    async run({ page, shot }) {
      await openRow(page, '.row:has-text("Morning Brief")');
      await shot(page);
    },
  },
  {
    // Writing: a compose window, with address suggestions open.
    name: 'compose',
    async run({ page, context, shot }) {
      const popup = context.waitForEvent('page');
      await page.focus('.list-scroll');
      await page.keyboard.press('c');
      const w = await popup;
      await w.setViewportSize({ width: 760, height: 460 });
      await w.waitForSelector('.addr-input');
      await w.waitForTimeout(400);
      await w.fill('.cmp-subject input, input.cmp-subject', 'Saturday plans').catch(() => {});
      await w.click('.ProseMirror');
      await w.keyboard.type('Hi Hannah and Sarah,\nAre we still on for the hike on Saturday? I can drive — leaving around 8.\nJohn');
      await w.click('.addr-input');
      // Hannah from the suggestions, then the start of Sarah's name: her suggestions open.
      await w.keyboard.type('hann');
      await w.waitForSelector('.addr-sugg-row');
      await w.keyboard.press('Enter');
      await w.keyboard.type('sar');
      await w.waitForSelector('.addr-sugg-row');
      await shot(w);
    },
  },
  {
    // Quick search with a query and its results.
    name: 'search',
    async run({ page, shot }) {
      await page.click('.search-field input');
      await page.keyboard.type('from:sarah roadmap');
      await page.waitForTimeout(600);
      await openRow(page, '.search-layer .row >> nth=0');
      await shot(page);
    },
  },
  {
    // Tags: the Tag menu on a tagged message.
    name: 'tags',
    async run({ page, shot }) {
      await openRow(page, '.row:has(.tag-dot) >> nth=0');
      await page.keyboard.press('l');
      await page.waitForSelector('.tag-menu');
      await shot(page);
    },
  },
  {
    // The sidebar as a rail, with every folder sliding out over the list.
    name: 'rail',
    async run({ page, shot }) {
      await openRow(page, '.row:has-text("Morning Brief")');
      await page.keyboard.press('Control+1');
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+Shift+1');
      await page.waitForTimeout(300);
      await shot(page);
    },
  },
  {
    // Ctrl+G: every folder of every account, filtered as you type.
    name: 'goto',
    async run({ page, shot }) {
      await openRow(page, '.row:has-text("Morning Brief")');
      await page.keyboard.press('Control+G');
      await page.keyboard.type('in');
      await page.waitForTimeout(200);
      await shot(page);
    },
  },
  {
    // Settings › Keyboard: Gmail's or Thunderbird's keys, each one changeable.
    name: 'keyboard',
    async run({ page, shot }) {
      await page.keyboard.press('Control+Comma');
      await page.click('.st-nav-item:has-text("Keyboard")');
      await page.waitForSelector('.st-row');
      await shot(page);
    },
  },
  {
    // `?`: the shortcuts sheet.
    name: 'shortcuts',
    async run({ page, shot }) {
      await page.focus('.list-scroll');
      await page.keyboard.press('?');
      await page.waitForSelector('.sc-grid');
      await shot(page);
    },
  },
  {
    // View options › Sort by From: each sender's messages together under their name.
    name: 'sorted',
    async run({ page, shot }) {
      // A smaller folder: several senders on screen.
      await page.click('.sidebar .folder-row:has-text("Newsletters"), .sidebar :text("Newsletters")');
      await page.waitForTimeout(500);
      await page.click('.view-menu-btn');
      await page.click('.view-menu .vm-item:has-text("From")');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await openRow(page, '.folder-layer .row >> nth=1');
      await shot(page);
    },
  },
  {
    // Ctrl/⌘+2: everything from the sender beside the message, three picked to delete.
    name: 'sender',
    async run({ page, shot }) {
      await openRow(page, '.row:has-text("Invoicely") >> nth=0');
      await page.keyboard.press('Control+2');
      await page.waitForSelector('.sp-row');
      await page.click('.sp-row >> nth=1');
      await page.click('.sp-row >> nth=3', { modifiers: ['Shift'] });
      await bodyShown(page);
      await page.waitForTimeout(300);
      await shot(page);
    },
  },
  {
    // ✨ AI in a reply: a few words, and the reply written.
    name: 'writing-help',
    async run({ page, context, shot }) {
      await page.evaluate(() => localStorage.setItem('mock.aiKey', 'sk-ant-demo'));
      await openRow(page, '.row:has-text("Morning Brief")');
      const popup = context.waitForEvent('page');
      await page.click('.reader [aria-label="Reply"] >> nth=0');
      const w = await popup;
      await w.setViewportSize({ width: 760, height: 560 });
      await w.waitForSelector('.ProseMirror');
      await w.click('.fmt-ai');
      await w.fill('.ai-input', 'yes, Thursday works — ask if I should bring anything');
      await w.keyboard.press('Enter');
      await w.waitForSelector('.ai-panel button:has-text("Use this")');
      await shot(w);
    },
  },
  {
    // The address book (the people icon, or Ctrl/⌘+Shift+B).
    name: 'contacts',
    async run({ page, shot }) {
      await page.evaluate(() =>
        localStorage.setItem(
          'mock.cards',
          JSON.stringify([
            { id: 1, name: 'Hannah Müller', emails: ['hannah@example.com'], phones: ['+49 30 1234 5678'], company: 'Northwind', notes: 'Hiking group. Prefers Signal.' },
            { id: 2, name: 'Sarah Chen', emails: ['sarah@example.com', 'sarah.chen@gmail.com'], phones: [], company: 'Northwind', notes: '' },
            { id: 3, name: 'Priya Raman', emails: ['priya@example.com'], phones: ['+44 20 7946 0000'], company: 'Fabrikam', notes: '' },
            { id: 4, name: 'Ben Carter', emails: ['ben@example.com'], phones: [], company: '', notes: '' },
          ]),
        ),
      );
      await page.click('[aria-label="Address book"]');
      await page.waitForSelector('.ct-row');
      await page.click('.ct-row:has-text("Hannah")');
      await shot(page);
    },
  },
];

// ------------------------------------------------------------- harness

/** Open a list row and wait until its message body has rendered (bodies load on demand). */
async function openRow(page, selector) {
  await page.click(selector);
  await bodyShown(page);
}

/** Wait until the open message's body has rendered. */
async function bodyShown(page) {
  await page.waitForFunction(() => {
    const frames = [...document.querySelectorAll('.reader iframe, .conv-scroll iframe')];
    const plain = document.querySelector('.reader .plain, .conv-scroll .plain');
    return (plain?.textContent ?? '').trim().length > 0 || frames.some((f) => (f.contentDocument?.body?.textContent ?? '').trim().length > 0);
  });
  await page.waitForTimeout(300);
}

/** Stand-in for the newsletters' picsum.photos images: a soft gradient, the same every run. */
function placeholder(url) {
  let h = 0;
  for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = [h % 360, (h >> 9) % 360];
  const m = /\/(\d+)\/(\d+)(?:[/?]|$)/.exec(url);
  const [w, ht] = m ? [m[1], m[2]] : ['600', '400'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${a} 35% 72%)"/><stop offset="1" stop-color="hsl(${b} 30% 52%)"/>
    </linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
}

const STILL = `*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }`;

/** The traffic lights: macOS's colours, 12 px, 20 px apart. */
const LIGHTS = ['#ff5f57', '#febc2e', '#28c840']
  .map((c) => `<i style="background:${c}"></i>`)
  .join('');

/**
 * `shot` (a PNG at 2×, `size` CSS pixels) framed as a macOS window, saved to `path`: the main
 * window with its lights at (18, 20) as the app sets them (`traffic_light_position`), a compose
 * window under a title bar of its own.
 */
async function frame(browser, shot, size, { kind, theme, title }, path) {
  const dark = theme === 'dark';
  const bar = kind === 'compose'
    ? `<div class="bar"><span class="lights">${LIGHTS}</span><span class="title">${title}</span></div>`
    : `<span class="lights over">${LIGHTS}</span>`;
  const html = `<!doctype html><html><head><style>
    html, body { margin: 0; background: transparent; }
    #shot { display: inline-block; padding: 36px 48px 60px; }
    .win { position: relative; border-radius: 11px; overflow: hidden;
      box-shadow: 0 0 0 0.5px ${dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.28)'}, 0 24px 48px rgba(0,0,0,${dark ? 0.55 : 0.26}), 0 4px 12px rgba(0,0,0,0.12); }
    .win img { display: block; width: ${size.width}px; height: ${size.height}px; }
    .bar { position: relative; height: 28px; display: flex; align-items: center; justify-content: center;
      background: ${dark ? '#323234' : '#ececec'}; border-bottom: 1px solid ${dark ? '#000' : '#d6d6d6'};
      font: 600 13px -apple-system, "SF Pro Text", "Inter", system-ui, sans-serif; color: ${dark ? '#dfdfdf' : '#4d4d4d'}; }
    .lights { position: absolute; left: 13px; top: 8px; display: flex; gap: 8px; }
    .lights.over { left: 18px; top: 20px; }
    .lights i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.18); }
  </style></head><body><div id="shot"><div class="win">${bar}<img src="data:image/png;base64,${shot.toString('base64')}"></div></div></body></html>`;
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: size.width + 200, height: size.height + 200 } });
  try {
    const p = await ctx.newPage();
    await p.setContent(html);
    await p.waitForFunction(() => document.querySelector('img')?.complete);
    await p.locator('#shot').screenshot({ path, omitBackground: true });
  } finally {
    await ctx.close();
  }
}

async function main() {
  const only = process.argv[2];
  const scenes = SCENES.filter((s) => !only || s.name.includes(only));
  if (!scenes.length) throw new Error(`no scene matches "${only}"`);
  mkdirSync(OUT, { recursive: true });

  const server = await createServer({ root: APP, logLevel: 'error', server: { port: 1499, strictPort: false } });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
  try {
    for (const scene of scenes) {
      for (const theme of scene.themes ?? ['light']) {
        const context = await browser.newContext({
          viewport: SIZE,
          deviceScaleFactor: 2,
          colorScheme: theme,
          locale: 'en-US',
          timezoneId: 'America/New_York',
          // A Mac's, so every window (compose ones too) takes the macOS layout and ⌘ keys.
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        });
        await context.route(/^https:\/\/picsum\.photos\//, (r) =>
          r.fulfill({ contentType: 'image/svg+xml', body: placeholder(r.request().url()) }),
        );
        await context.clock.setFixedTime(NOW);
        // Every page (popups too) without animations or a blinking caret.
        await context.addInitScript((css) => {
          addEventListener('DOMContentLoaded', () => {
            const s = document.createElement('style');
            s.textContent = css;
            document.head.append(s);
          });
        }, STILL);
        const page = await context.newPage();
        // The macOS layout: room for the traffic lights, which `frame` draws.
        await page.goto(base + '?demo&mac' + (scene.query ?? ''));
        await page.waitForSelector('.row');
        await page.waitForTimeout(600);
        const file = `${scene.name}${theme === 'dark' ? '-dark' : ''}.png`;
        const shot = async (target) => {
          await target.waitForTimeout(250);
          const raw = await target.screenshot({ animations: 'disabled', caret: 'hide' });
          const kind = target === page ? 'main' : 'compose';
          await frame(browser, raw, target.viewportSize(), { kind, theme, title: 'New Message' }, join(OUT, file));
          console.log(`  ${file}`);
        };
        await scene.run({ page, context, shot, base });
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
