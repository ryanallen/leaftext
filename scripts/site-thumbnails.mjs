#!/usr/bin/env node
// Photograph every documentation page leaftext.com publishes, so a page pasted into a chat unfurls with a picture of itself rather than of another document.
//
//   node scripts/site-thumbnails.mjs --write                 the publish's run: the baked workspace as it stands, through the front end the hand-over committed
//   node scripts/site-thumbnails.mjs --preview --write       the same run on this machine, through the module just built, as `serve-site.mjs` serves it
//   node scripts/site-thumbnails.mjs --preview --write --only docs/08-examples/merlin/merlin.md   just the pages named
//   node scripts/site-thumbnails.mjs --check                 the rules, offline and with no browser (`just verify`)
//
// **Taken in the public deploy, after the bake.** The runner already has every page and the front end on disk, its minutes cost nothing, and the picture is always of the page going up. Each page's head already names its picture through `cardOf` in `site-page.mjs`, so a page this could not photograph would go out naming a file that is not there — which is why a run with one stops the deploy, by the page's name.
//
// **The reading column, in one theme.** A visit draws its theme family at random, so the browser host's own `leaftext.settings` is pinned to Fern, dark before the first page loads. The picture is clipped from 40 pixels either side of the reading column, from the top of the reading frame, at the card's shape — the pane, the minimap and the floating view bar stay out, because at a feed's size they are unreadable and take width from the words that say what the page is.
//
// **Retaken only when something it shows moved.** `cards/keys.json` keeps, per page, a hash of the document's bytes, the front end it is drawn through and the frame below; the deploy restores the last run's `cards/` and a page whose key has not moved keeps its picture.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_DIR, BUILT_BOOK_MODULE, BUILT_COLORS_MODULE, BUILT_MODULE, BUILT_PLAIN_MODULE, CARD_KEYS, LISTING, previewAnswers } from './site-assets.mjs';
import { CARD_SIZE, cardOf, filesUnder } from './site-page.mjs';
import { staticServer } from './serve-static.mjs';
import { instantiateCore } from './web-module.mjs';
import { findBrowser, openHeadless } from './headless.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The size a link card is drawn at, and the window the page is laid out in to fill it. */
export const CARD = CARD_SIZE;
export const WINDOW = { width: 1200, height: 630 };

/** How much of the page either side of the reading column the picture keeps. */
export const MARGIN = 40;

/** The theme every picture is taken in: the app's own fallback family, in the dark the owner shares in. */
export const THEME = { themeFamily: 'fern', themeMode: 'dark' };

/** Where each page's key is kept beside the pictures. */
export const KEYS = CARD_KEYS;

/** How long a page has to draw its column before it is refused. */
const DRAW_DEADLINE = 20000;

/** What a moved frame, window or theme has to retake every picture for, folded into every key. */
const FRAME = JSON.stringify({ CARD, WINDOW, MARGIN, THEME });

/** The part of the window a card is cut from: the reading column with its margin, from the frame's top, at the card's shape. Refused where that shape does not fit inside the window. */
export function clipOf(column, frameTop, window = WINDOW) {
  const x = Math.max(0, column.x - MARGIN);
  const width = Math.min(window.width - x, column.width + 2 * MARGIN);
  const height = (width * CARD.height) / CARD.width;
  if (!(width > 0) || frameTop < 0 || frameTop + height > window.height) {
    throw new Error(`a reading column at ${Math.round(column.x)}, ${Math.round(frameTop)}, ${Math.round(column.width)} wide makes no card inside a ${window.width} by ${window.height} window`);
  }
  return { x, y: frameTop, width, height, scale: CARD.width / width };
}

const hash = (...parts) => {
  const sum = createHash('sha256');
  for (const part of parts) sum.update(part).update('\0');
  return sum.digest('hex');
};

/** One hash over every file the front end is served as, in one order, so a page drawn differently retakes its picture. */
export function frontEndKey(files) {
  return hash(...[...files].sort(([a], [b]) => a.localeCompare(b)).flatMap(([path, bytes]) => [path, bytes]));
}

/** A page's key: its document's bytes, the front end it is drawn through, and the frame. */
export const cardKey = (documentBytes, frontEnd) => hash(documentBytes, frontEnd, FRAME);

/**
 * Photograph every page whose key moved or whose picture is missing, then refuse every page still without one — by name, because the head the bake already wrote names that picture.
 *
 * `photograph(page)` writes the page's picture or throws why it could not; `exists(card)` answers whether a picture is there. Answers the keys to keep, what was taken and skipped, and every refusal.
 */
export async function takeCards({ pages, keys, keyOf, photograph, exists }) {
  const kept = {};
  const taken = [];
  const skipped = [];
  const refused = [];
  for (const page of pages) {
    const key = keyOf(page);
    const card = cardOf(page.path);
    if (keys[page.path] === key && exists(card)) {
      kept[page.path] = key;
      skipped.push(page.path);
      continue;
    }
    try {
      await photograph(page);
      kept[page.path] = key;
      taken.push(page.path);
    } catch (error) {
      refused.push(`${page.path}: ${error.message}`);
    }
  }
  for (const page of pages) {
    if (!exists(cardOf(page.path)) && !refused.some((line) => line.startsWith(`${page.path}:`))) refused.push(`${page.path}: no picture at ${cardOf(page.path)} after the run`);
  }
  return { keys: kept, taken, skipped, refused };
}

/** The pages the bake wrote, read off its listing: every document it gave a page of its own, the front page apart. */
export function pagesOf(listing, only = []) {
  const pages = listing.documents.filter((entry) => entry.page && entry.page !== '/').map((entry) => ({ path: entry.path, page: entry.page }));
  if (!only.length) return pages;
  const named = pages.filter((page) => only.includes(page.path));
  const unknown = only.filter((path) => !named.some((page) => page.path === path));
  if (unknown.length) throw new Error(`no page of its own for ${unknown.join(', ')}`);
  return named;
}

/** What the page reads once its host has drawn the document: the column's box and the frame's top, or nothing while it has not. The baked words are gone once the host has drawn, which is how a picture of the page's own front end is told from one of the publish's placeholder. */
const DRAWN = `(() => {
  if (window.__leafCardOld || document.querySelector('.baked-page')) return null;
  const column = document.querySelector('#app .reader-layout > article.document-body');
  if (!column || !column.querySelector('h1, h2, h3')) return null;
  const box = column.getBoundingClientRect();
  return { x: box.x, width: box.width, frameTop: column.parentElement.getBoundingClientRect().y };
})()`;

/** One browser, theme pinned, photographing pages one at a time into `out`. */
async function camera(base, out) {
  const browser = await openHeadless('about:blank', WINDOW);
  await browser.send('Page.enable');
  await browser.send('Emulation.setDeviceMetricsOverride', { ...WINDOW, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('leaftext.settings', ${JSON.stringify(JSON.stringify(THEME))}); } catch {}` });
  const photograph = async ({ page, path }) => {
    await browser.evaluate('window.__leafCardOld = true');
    await browser.send('Page.navigate', { url: `${base}${page}` });
    let drawn = null;
    for (const began = Date.now(); !drawn && Date.now() - began < DRAW_DEADLINE; ) {
      drawn = await browser.evaluate(DRAWN).catch(() => null);
      if (!drawn) await new Promise((done) => setTimeout(done, 150));
    }
    if (!drawn) throw new Error('the reading column never held a heading');
    await browser.evaluate('document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))))');
    const settled = await browser.evaluate(DRAWN);
    if (!settled) throw new Error('the reading column went away before it could be photographed');
    const shot = await browser.send('Page.captureScreenshot', { format: 'png', clip: clipOf(settled, settled.frameTop) });
    const file = join(out, cardOf(path));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
  };
  return { photograph, close: browser.close };
}

async function main(args) {
  const preview = args.includes('--preview');
  const only = args.flatMap((arg, at) => (args[at - 1] === '--only' ? [arg] : []));
  if (!findBrowser()) throw new Error('no Edge or Chrome on this machine, so no page can be photographed');

  // What the browser is served ahead of the disk: on this machine, the pages the bake would write and the front end just built; at the publish, nothing, because both are already on disk.
  let ahead = new Map();
  if (preview) {
    if (!existsSync(BUILT_MODULE)) throw new Error('the browser module is not built — run: just build-web');
    ahead = await previewAnswers(await instantiateCore(BUILT_MODULE), readFileSync(BUILT_PLAIN_MODULE), readFileSync(BUILT_COLORS_MODULE), readFileSync(BUILT_BOOK_MODULE));
  }
  const served = (path) => ahead.get(path) ?? readFileSync(join(root, path));
  const listing = JSON.parse(String(served(LISTING)));
  const pages = pagesOf(listing, only);

  const frontEndPaths = preview ? [...ahead.keys()].filter((path) => path.startsWith(`${ASSET_DIR}/`)) : (await filesUnder(join(root, ASSET_DIR))).map((path) => `${ASSET_DIR}/${path}`);
  const frontEnd = frontEndKey(frontEndPaths.map((path) => [path, served(path)]));
  const keysFile = join(root, KEYS);
  let keys = {};
  try {
    keys = JSON.parse(readFileSync(keysFile, 'utf8'));
  } catch {
    // No earlier run restored, so every page is taken.
  }

  const server = staticServer(root, ahead);
  await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
  const shooter = await camera(`http://127.0.0.1:${server.address().port}`, root);
  let result;
  try {
    result = await takeCards({
      pages,
      keys,
      keyOf: (page) => cardKey(readFileSync(join(root, page.path)), frontEnd),
      photograph: shooter.photograph,
      exists: (card) => existsSync(join(root, card)),
    });
  } finally {
    shooter.close();
    server.close();
  }
  mkdirSync(dirname(keysFile), { recursive: true });
  writeFileSync(keysFile, `${JSON.stringify({ ...(only.length ? keys : {}), ...result.keys }, null, 2)}\n`);
  for (const path of result.taken) console.log(`took ${cardOf(path)}`);
  if (result.skipped.length) console.log(`kept ${result.skipped.length} pictures whose page had not moved`);
  if (result.refused.length) {
    console.error('these pages would go out naming a picture nobody took:');
    for (const line of result.refused) console.error(`  ${line}`);
    process.exit(1);
  }
}

/** The rules above, held with a fake camera and no browser. */
async function check() {
  const problems = [];
  const fail = (message) => problems.push(message);

  const clip = clipOf({ x: 334, width: 662 }, 40);
  if (Math.abs(clip.width / clip.height - 1200 / 630) > 1e-9 || clip.width * clip.scale !== CARD.width || Math.round(clip.height * clip.scale) !== CARD.height) fail(`a column's clip came out ${clip.width} by ${clip.height} at ${clip.scale}, not the card's 1.91 to 1`);
  if (clip.x !== 294 || clip.y !== 40 || clip.x + clip.width > WINDOW.width || clip.y + clip.height > WINDOW.height) fail(`a column's clip is not the column with its margin inside the window: ${JSON.stringify(clip)}`);
  let tall = null;
  try {
    clipOf({ x: 100, width: 1100 }, 300);
  } catch (error) {
    tall = error;
  }
  if (!tall) fail('a clip running off the foot of the window was taken');

  const listing = { documents: [{ path: 'README.md', page: '/' }, { path: 'docs/a.md', page: '/docs/a.html' }, { path: 'docs/b.md', page: '/docs/b.html' }, { path: 'docs/c.md', page: '/docs/c.html' }, { path: 'site.yml' }] };
  const pages = pagesOf(listing);
  if (pages.map((page) => page.path).join() !== 'docs/a.md,docs/b.md,docs/c.md') fail(`the pages read off the listing were ${pages.map((page) => page.path).join(', ')}`);
  if (cardOf('docs/08-examples/merlin/merlin.md') !== 'cards/docs/08-examples/merlin/merlin.png') fail(`the Merlin page's card is ${cardOf('docs/08-examples/merlin/merlin.md')}`);

  const bytes = { 'docs/a.md': 'a', 'docs/b.md': 'b', 'docs/c.md': 'c' };
  const front = frontEndKey([['assets/leaftext/app/app.js', 'one']]);
  const keyOf = (page) => cardKey(bytes[page.path], front);
  const pictures = new Set();
  const shot = [];
  const fake = (refuse) => async (page) => {
    shot.push(page.path);
    if (refuse.includes(page.path)) throw new Error('the reading column never held a heading');
    pictures.add(cardOf(page.path));
  };
  const first = await takeCards({ pages, keys: {}, keyOf, photograph: fake(['docs/b.md']), exists: (card) => pictures.has(card) });
  if (!first.refused.some((line) => line.startsWith('docs/b.md:') && line.includes('never held a heading'))) fail(`a page whose column never held a heading was not refused by name: ${first.refused.join('; ')}`);
  if (first.refused.length !== 1) fail(`one bad page refused ${first.refused.length} pages`);

  shot.length = 0;
  const lying = await takeCards({ pages, keys: {}, keyOf, photograph: async (page) => shot.push(page.path), exists: () => false });
  if (lying.refused.length !== 3 || !lying.refused.every((line) => line.includes('no picture at cards/'))) fail(`a run that wrote no pictures was not refused page by page: ${lying.refused.join('; ')}`);

  pictures.clear();
  shot.length = 0;
  const whole = await takeCards({ pages, keys: {}, keyOf, photograph: fake([]), exists: (card) => pictures.has(card) });
  shot.length = 0;
  const again = await takeCards({ pages, keys: whole.keys, keyOf, photograph: fake([]), exists: (card) => pictures.has(card) });
  if (shot.length || again.skipped.length !== 3) fail(`an unchanged page was photographed again: ${shot.join(', ')}`);
  bytes['docs/c.md'] = 'c, changed';
  shot.length = 0;
  await takeCards({ pages, keys: whole.keys, keyOf, photograph: fake([]), exists: (card) => pictures.has(card) });
  if (shot.join() !== 'docs/c.md') fail(`a changed byte retook ${shot.join(', ') || 'nothing'} rather than its own page`);
  const moved = frontEndKey([['assets/leaftext/app/app.js', 'two']]);
  if (cardKey('a', moved) === cardKey('a', front)) fail('a changed front end left every key where it was');
  pictures.delete('cards/docs/a.md'.replace('.md', '.png'));
  shot.length = 0;
  await takeCards({ pages, keys: whole.keys, keyOf, photograph: fake([]), exists: (card) => pictures.has(card) });
  if (!shot.includes('docs/a.md')) fail('a page whose picture went missing kept its key and was not retaken');

  if (problems.length) {
    console.error('site thumbnails:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log('site thumbnails: a column clips to the card inside the window, a page that never drew or wrote no picture is refused by name, an unchanged page is kept and a changed byte retakes only its own');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--check')) await check();
    else if (args.includes('--write')) await main(args);
    else console.log('node scripts/site-thumbnails.mjs --write | --preview --write [--only <path>] | --check');
  } catch (error) {
    console.error(`site thumbnails: ${error.message}`);
    process.exit(1);
  }
}
