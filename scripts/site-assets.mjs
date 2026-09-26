#!/usr/bin/env node
// What leaftext.com serves: the app's own front end and module under one folder, and the page that makes every address on the site the app — written at publish, beside the documents it opens.
//
//   node scripts/site-assets.mjs           name every published path and say whether it is there
//   node scripts/site-assets.mjs --write   build the published files out of web/dist into the site tree, and bake the pages without writing them anywhere
//   node scripts/site-assets.mjs --bake    bake the pages — through the module already beside them — into the copies the deploy uploads
//
// **`--bake` is the public repository's half.** The source is private, so the repository that deploys leaftext.com cannot compile a module; `just hand-over-site` hands it the built front end and its deploy writes the pages through the module it was handed. Same bake, same refusals, and no Rust anywhere near it — what `--write` adds on top is building those files in the first place, which is the half only a checkout with the source in it can do.
//
// **Not one of these files is ever committed here.** `.gitignore` refuses the folder they land in and the two pages the bake writes. `scripts/check-site.mjs` reads the table below, so a renamed output shows up offline as a page fetching a file nobody writes rather than as a blank page on the live site. `scripts/serve-site.mjs` reads it too, and hands a browser what it says rather than whatever the last publish left on disk.
//
// **The pages are baked, never written here.** The front page is the app's own page with the site's lines from `site-page.html` in it and the README already drawn into it, so a cold visitor and a crawler read the words out of the first response; `documents.json` beside it is the listing the app's pane and pager walk; the documentation page carries the folder's file list so an old `#/route` link can be sent on to its page. `--write` draws the same pages and puts them nowhere, as its check that the module can draw the README before a byte crosses.
//
// **The other site rides on these too.** Emptyguru has no Rust and no build, so its page names `assets/leaftext/app/` on leaftext.com for its whole front end — which works because GitHub Pages sends `access-control-allow-origin: *` on every asset. That is why the names here are a contract with another repository.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instantiateCore } from './web-module.mjs';
import { imageSizes } from './site-images.mjs';
import { project } from './project.mjs';
import { SITE_FRAGMENT, inPlaceSite, writeDocsList } from './site-page.mjs';
import { COMPARE_INDEX, chartPagePaths, frontWithChart } from '../site/compare-chart.js';
import { FRONT_LAYOUT_CLASS, layoutFrontPage } from '../site/front-page-layout.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The folder every published asset lands in, and the one line `.gitignore` refuses. */
export const ASSET_DIR = 'assets/leaftext';

/** Where the app's front end is served from, which a page names as its asset base. */
export const APP_DIR = `${ASSET_DIR}/app`;
export const APP_BASE = `${APP_DIR}/`;

/** Which build the site is reading through, so a reader of either site can tell how old it is. */
export const VERSION_PATH = `${ASSET_DIR}/version.json`;
export const IMAGE_SIZES_PATH = `${ASSET_DIR}/image-sizes.json`;

/** The notices of everything compiled into the module, beside it rather than inside it, because every license they reproduce asks to go with the distribution. */
export const LICENSES_PATH = `${ASSET_DIR}/licenses.md`;

/** The app's own module, page script and stylesheet — the whole app a page runs. */
export const APP_MODULE_PATH = `${APP_DIR}/leaftext.wasm`;
export const APP_SCRIPT_PATH = `${APP_DIR}/app.js`;
export const APP_STYLES_PATH = `${APP_DIR}/app.css`;

/** The host a browser answers the page through, its loader and its store, out of `web/preview/`; the deadline every fetch waits under; and the landing's layout, its chart and its motion, which the loader hands the host — the website's own files. */
export const HOST_FILES = [
  [`${APP_DIR}/host.js`, 'web/preview/host.js'],
  [`${APP_DIR}/boot.js`, 'web/preview/boot.js'],
  [`${APP_DIR}/settings.js`, 'web/preview/settings.js'],
  [`${APP_DIR}/fetches.js`, 'site/fetches.js'],
  [`${APP_DIR}/front-page-layout.js`, 'site/front-page-layout.js'],
  [`${APP_DIR}/compare-chart.js`, 'site/compare-chart.js'],
  [`${APP_DIR}/front-page.js`, 'site/front-page.js'],
];

/** The runtimes the page fetches by name when a document needs one — a diagram, some math, the map, the source view — as the app compiles them in. */
const VENDOR = 'src/assets/vendor';
function vendorFiles() {
  const found = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, path);
      else found.push([`${APP_DIR}/${path}`, `${VENDOR}/${path}`]);
    }
  };
  walk(VENDOR, '');
  return found.sort(([a], [b]) => a.localeCompare(b));
}

/** Every path the publish writes, in one order. */
export const PUBLISHED = [
  VERSION_PATH,
  IMAGE_SIZES_PATH,
  LICENSES_PATH,
  APP_MODULE_PATH,
  APP_SCRIPT_PATH,
  APP_STYLES_PATH,
  ...HOST_FILES.map(([path]) => path),
  ...(existsSync(join(root, VENDOR)) ? vendorFiles().map(([path]) => path) : []),
];

/** The build this is cut from. Not published itself — it is what `just build-web` leaves behind. */
export const BUILT_MODULE = join(root, 'web', 'dist', 'leaftext-app.wasm');

/** The page every address on the site is, the listing it reads, and the document it opens on. */
export const FRONT_PAGE = 'index.html';
export const LISTING = 'documents.json';
export const FRONT_DOCUMENT = 'README.md';

/** What the site publishes as documents, and what its trail calls it. Everything else in the repository — the discovery files, the scripts, the themes — is served as it is and never offered as a page. */
export const SITE_NAME = 'leaftext';
export const SITE_PATHS = [FRONT_DOCUMENT, 'docs'];

/**
 * The two addresses the front page's structured data carries, written as marks the bake fills rather than as URLs.
 *
 * They are the project this page is about and the file its Windows button hands over, and both are the public repository — which a tracked file must not spell, because a repository named in a committed file is a repository that can disagree with the one line that owns it.
 */
export const PAGE_MARKS = {
  '{{leaftext:repository}}': (project) => project.url,
  '{{leaftext:windows-download}}': (project) => `${project.download}/leaftext-windows-x86_64.exe`,
};

/** The page with both marks filled, refused where either is missing. */
export function fillMarks(page, project) {
  let filled = page;
  for (const [mark, answer] of Object.entries(PAGE_MARKS)) {
    if (!filled.includes(mark)) throw new Error(`${SITE_FRAGMENT} no longer carries ${mark}, so the deploy would publish a page naming no project address`);
    filled = filled.split(mark).join(answer(project));
  }
  return filled;
}

/**
 * How the landing is laid out at the bake: the comparison chart drawn under its heading out of the chart pages on disk, then the README laid out as the front page. The chart's rows are written once, in `docs/`, and the browser lifts this drawn chart out of the page rather than drawing it again.
 */
export function frontLayout(leaf, from = root) {
  const index = readFileSync(join(from, COMPARE_INDEX), 'utf8');
  const bodies = new Map(chartPagePaths(index).map((path) => [path, readFileSync(join(from, path), 'utf8')]));
  const render = (body, path) => leaf.render(body, path);
  return (html) => layoutFrontPage(frontWithChart(html, index, bodies, render));
}

/**
 * The front page and its listing: the app's own page with the site's lines in it and the README laid out into it, and the documents it walks — what the deploy uploads, never what the repository holds.
 *
 * `layout` is the bake's own unless a check hands it another, which is how a bake that would go out plain is proved refused.
 */
export async function bakeSite(leaf, project, from = root, { layout = frontLayout(leaf, from) } = {}) {
  const fragmentFile = join(from, SITE_FRAGMENT);
  if (!existsSync(fragmentFile)) throw new Error(`${SITE_FRAGMENT} is not here, so the page would carry none of leaftext.com's own lines`);
  const { page, listing } = await inPlaceSite(leaf, from, SITE_PATHS, {
    name: SITE_NAME,
    assets: APP_BASE,
    fragment: readFileSync(fragmentFile, 'utf8'),
    imageSizes: IMAGE_SIZES_PATH,
    layout,
  });
  // The host lays out only the document the listing names, so a site with no landing layout — Emptyguru — draws every page as the app does.
  listing.frontPage = FRONT_DOCUMENT;
  if (listing.landing !== FRONT_DOCUMENT) throw new Error(`the site would open on ${listing.landing || 'nothing'} rather than ${FRONT_DOCUMENT}`);
  if (!/class="reader-layout baked-page"><article class="document-body[^"]*">\s*\S/.test(page)) throw new Error(`the renderer drew no ${FRONT_DOCUMENT} into ${FRONT_PAGE}`);
  // The front page is the one page whose job is to get somebody to press Download, so a publish that lost its layout stops rather than going out as the README drawn plain.
  if (!page.includes(`<article class="document-body ${FRONT_LAYOUT_CLASS}">`)) throw new Error(`${FRONT_PAGE} came out of the bake with ${FRONT_DOCUMENT} drawn plain rather than laid out as the front page`);
  return new Map([
    [FRONT_PAGE, fillMarks(page, project)],
    [LISTING, `${JSON.stringify(listing, null, 2)}\n`],
  ]);
}

/** The documentation address, and the folder whose file list the publish writes into it. */
export const DOCS_PAGE = 'docs/index.html';
export const DOCS_DIR = 'docs';

/** The element the docs page leaves for that list, and the same element still empty — two patterns, so a page already holding a list is told what is wrong with it rather than being told it has no holder at all. */
const DOCS_LIST = /<script\b[^>]*\bid="docs-pages"[^>]*>/;
const DOCS_HOLDER = /(<script\b[^>]*\bid="docs-pages"[^>]*>)(\s*)(<\/script>)/;

/** Whether a docs page is still the shape the repository keeps: an empty holder waiting for a file list. */
export function docsPageIsEmpty(page) {
  const found = DOCS_HOLDER.exec(page);
  return Boolean(found) && found[2].trim() === '';
}

/** Every file the documentation folder holds, relative to it and in one order. */
export function docsPaths(from = join(root, DOCS_DIR)) {
  const found = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else found.push(path);
    }
  };
  walk(from, '');
  return found.sort();
}

/**
 * The documentation address with its folder's file list in it, which is how an old `#/route` link finds the page it named — the route is the file's path with its ordering numbers and `.md` taken off, so the list is what turns one back into the other with no request of its own.
 *
 * A page already holding a list is refused rather than written over: a committed one serves whatever the folder held the day somebody wrote it.
 */
export function bakeDocsPage(page, paths) {
  if (!DOCS_LIST.test(page)) throw new Error(`${DOCS_PAGE} has no element to write its file list into`);
  if (!docsPageIsEmpty(page)) throw new Error(`${DOCS_PAGE} already holds a file list, which is whatever the folder held the day somebody committed it`);
  if (!Array.isArray(paths) || !paths.length) throw new Error(`there are no documentation files to write into ${DOCS_PAGE}`);
  return writeDocsList(page, paths);
}

/**
 * What each published file *is*, against the table above of what they are called: the app module's bytes, its stylesheet and page script, the host files and runtimes as they sit in the tree, the version out of `Cargo.toml`, and the licenses document filled with that version.
 *
 * The publish writes these to disk and the local preview answers them straight to a browser, so one table is what stops the preview drawing a page through the copy the last publish left beside it.
 */
export function publishedAssets(app, appBytes) {
  return new Map([
    // The repository rides beside the version because the public side has no `Cargo.toml` to read: this file is what a bake over there reads its own project address back out of.
    [VERSION_PATH, `${JSON.stringify({ version: appVersion(), repository: project().url }, null, 2)}\n`],
    [IMAGE_SIZES_PATH, `${JSON.stringify(imageSizes())}\n`],
    [LICENSES_PATH, licensesDocument(appVersion())],
    [APP_MODULE_PATH, appBytes],
    [APP_SCRIPT_PATH, app.script()],
    [APP_STYLES_PATH, app.styles()],
    ...HOST_FILES.map(([path, from]) => [path, readFileSync(join(root, from))]),
    ...vendorFiles().map(([path, from]) => [path, readFileSync(join(root, from))]),
  ]);
}

/**
 * The project this run is drawing for.
 *
 * Private side, that is the manifest. On `--bake` there is no manifest at all — the public repository holds the site and no source — so it comes out of the `version.json` the hand-over committed, which is the same line read through the same rule.
 */
export function siteProject({ bakeOnly = false } = {}) {
  if (!bakeOnly) return project();
  const path = join(root, VERSION_PATH);
  if (!existsSync(path)) throw new Error(`${VERSION_PATH} is not here, so the bake cannot say which project this site is. It is committed by the hand-over in the private repository.`);
  return project(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Everything the local preview answers ahead of the disk, keyed by path within the repository: the files the publish writes, and — baked — the front page, its listing and the documentation address with its file list.
 *
 * Unbaked none of the pages is in it and the published files still are, so a browser gets the tree as it stands.
 */
export async function previewAnswers(app, appBytes, { baked = true } = {}) {
  const answers = new Map(publishedAssets(app, appBytes));
  if (baked) {
    for (const [path, bytes] of await bakeSite(app, siteProject())) answers.set(path, bytes);
    answers.set(DOCS_PAGE, bakeDocsPage(readFileSync(join(root, DOCS_PAGE), 'utf8'), docsPaths()));
  }
  return answers;
}

/**
 * Which paths a run of this script writes.
 *
 * `--write` writes the built files and leaves the pages alone. It still bakes them, as its check that the module can draw the README before a byte crosses; nothing reads the result. Only `--bake` writes them, into the workspace the deploy uploads.
 */
export function writtenPaths({ bakeOnly = false } = {}) {
  return bakeOnly ? [FRONT_PAGE, LISTING, DOCS_PAGE] : [...PUBLISHED];
}

/** The token the licenses document carries where the running version goes; the desktop fills it when it opens the document. */
export const VERSION_TOKEN = '{{version}}';

/**
 * The committed licenses document with the version filled, as every browser build publishes it beside its module.
 *
 * Here rather than in `bundle-notices.mjs`, which writes the document, because the site's deploy runs this file and everything it imports has to cross to the public side with it.
 */
export function licensesDocument(version) {
  return readFileSync(join(root, 'src', 'assets', 'notices.md'), 'utf8').replaceAll(VERSION_TOKEN, version);
}

/** The app version, read where the release path reads it. */
export function appVersion() {
  const found = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, 'Cargo.toml'), 'utf8'));
  if (!found) throw new Error('Cargo.toml names no version');
  return found[1];
}

// The table above is what `scripts/check-site.mjs` imports, so nothing below runs when it does.
if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  await main();
}

async function main() {
  const problems = [];
  const fail = (message) => problems.push(message);

  const bakeOnly = process.argv.includes('--bake');
  if (!bakeOnly && !process.argv.includes('--write')) {
    for (const path of PUBLISHED) console.log(`${existsSync(join(root, path)) ? 'wrote' : '  no '} ${path}`);
    return;
  }

  // Which module this run is read through: the one just built, or the one already beside the pages. A repository with no source has only the second, and a deploy that quietly baked an empty page rather than saying which is missing is the blank front page nobody would think to look at.
  const appSource = bakeOnly ? join(root, APP_MODULE_PATH) : BUILT_MODULE;
  if (!existsSync(appSource)) {
    console.error(
      bakeOnly
        ? `${APP_MODULE_PATH} is not here, so there is no app to write the pages with. It is committed by the hand-over in the private repository; a deploy that cannot find it is one that ran before the hand-over.`
        : 'the browser module is not built — run: just build-web'
    );
    process.exit(1);
  }

  // A module that copied is not a module that answers, and a publish that replaced a working site with pages that cannot draw is worse than one that did not run. So it is asked before anything is written, and a failure here leaves the last published site standing.
  const app = await instantiateCore(appSource);
  const rendered = app.render('# Published\n\nA paragraph.\n', 'check.md');
  if (!rendered?.html.includes('<h1 id="published">')) fail('the built module did not render a document');
  const styles = app.styles();
  if (!styles?.includes('data-leaf-theme')) fail("the built module handed over a stylesheet with none of the app's themes in it");
  if (!styles?.includes('--lt-background')) fail("the built module handed over a stylesheet with none of the app's tokens in it");
  if (!app.page()?.includes('id="appSurface"')) fail("the built module handed over no page of the app's own");

  // The pages, drawn here rather than in the reader's browser. Asked for before anything is written, the same as the module is.
  let baked = null;
  try {
    baked = await bakeSite(app, siteProject({ bakeOnly }));
    baked.set(DOCS_PAGE, bakeDocsPage(readFileSync(join(root, DOCS_PAGE), 'utf8'), docsPaths()));
  } catch (error) {
    fail(error.message);
  }

  if (problems.length) {
    console.error('the site has nothing worth publishing:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  // The bake above is a check, not an output, on `--write`: the hand-over fills its clone out of the commit and the deploy bakes its own copy.
  const bytesFor = bakeOnly ? baked : publishedAssets(app, readFileSync(BUILT_MODULE));
  for (const path of writtenPaths({ bakeOnly })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytesFor.get(path));
    console.log(`wrote ${path}`);
  }
}
