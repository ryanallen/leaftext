#!/usr/bin/env node
// What the published site serves beside its pages: the app's own renderer as a module, its document stylesheet, the version both were built from — and the front page with its document already written into it.
//
//   node scripts/site-assets.mjs           name every published path and say whether it is there
//   node scripts/site-assets.mjs --write   build them out of web/dist into the site tree
//
// **Not one of these files is ever committed.** `.gitignore` refuses the folder they land in, so the publish builds them and the repository keeps its seventeen small readable files instead of a compiled module nobody can read a diff of. The publish workflow runs this script; `scripts/check-site.mjs` reads the table below, so a renamed output shows up offline as a page fetching a file nobody writes rather than as a blank document on the live site.
//
// **The front page is baked, never committed the same way.** The repository keeps it with an empty content element; `--write` fills that element in the workspace the deploy uploads, so a cold visitor reads the words out of the first response instead of after a 2.8 MB module and a second fetch. `scripts/check-site.mjs` refuses a committed copy that already holds a document, which is the only way a baked page could reach the tree.
//
// The other site rides on these too. Emptyguru has no Rust and no app source, so its pages name leaftext.com for exactly these paths — which works because GitHub Pages sends `access-control-allow-origin: *` on every asset. That is why the names here are a contract with another repository and not an implementation detail.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instantiateCore } from './web-module.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The folder every published asset lands in, and the one line `.gitignore` refuses. */
export const ASSET_DIR = 'assets/leaftext';

/** The renderer itself — the core build, with no highlighter in it: a page colors its own fences with the runtime it already ships. */
export const MODULE_PATH = `${ASSET_DIR}/leaftext.wasm`;

/** The app's document stylesheet, as `leaf_styles()` emits it. */
export const STYLES_PATH = `${ASSET_DIR}/leaftext.css`;

/** Which build a page is reading through, so a reader of either site can tell how old its renderer is. */
export const VERSION_PATH = `${ASSET_DIR}/version.json`;

export const PUBLISHED = [MODULE_PATH, STYLES_PATH, VERSION_PATH];

/** The build these are cut from. Not published itself — it is what `just build-web` leaves behind. */
const BUILT_MODULE = join(root, 'web', 'dist', 'leaftext-core.wasm');

/** The front page, and the document it draws: the publish writes the one into the other. */
export const FRONT_PAGE = 'index.html';
const FRONT_DOCUMENT = 'README.md';

/** The empty element the front page leaves for its document. */
const CONTENT_HOLDER = /(<article\b[^>]*\bid="content"[^>]*>)(\s*)(<\/article>)/;

/** Whether a front page is still the shape the repository keeps: an empty holder waiting for a document. */
export function frontPageIsEmpty(page) {
  const found = CONTENT_HOLDER.exec(page);
  return Boolean(found) && found[2].trim() === '';
}

/**
 * The front page with its document already in it — what the deploy uploads, never what the repository holds.
 *
 * Unbaked, a cold visitor reads nothing until a 2.8 MB module and a second fetch have both crossed the network, and a connection that stalls on either leaves them reading nothing at all. Baked, the words are in the first response and the module is a decoration that arrives after.
 */
export function bakeFrontPage(page, drawn) {
  if (!CONTENT_HOLDER.test(page)) throw new Error(`${FRONT_PAGE} has no empty content element to write the document into`);
  const body = drawn && drawn.html ? drawn.html.trim() : '';
  if (!body) throw new Error(`the renderer drew no ${FRONT_DOCUMENT} to write into ${FRONT_PAGE}`);
  return page.replace(CONTENT_HOLDER, (_, open, __, close) => open + body + close);
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

  if (!process.argv.includes('--write')) {
    for (const path of PUBLISHED) console.log(`${existsSync(join(root, path)) ? 'wrote' : '  no '} ${path}`);
    return;
  }

  if (!existsSync(BUILT_MODULE)) {
    console.error('the renderer is not built — run: just build-web');
    process.exit(1);
  }

  // A module that copied is not a module that answers, and a publish that replaced a working site with pages that cannot draw is worse than one that did not run. So it is asked before anything is written, and a failure here leaves the last published site standing.
  const leaf = await instantiateCore(BUILT_MODULE);
  const styles = leaf.styles();
  const rendered = leaf.render('# Published\n\nA paragraph.\n', 'check.md');
  if (!rendered?.html.includes('<h1 id="published">')) fail('the built module did not render a document');
  if (!styles?.includes('data-leaf-theme')) fail("the built module handed over a stylesheet with none of the app's themes in it");
  if (!styles?.includes('--lt-background')) fail("the built module handed over a stylesheet with none of the app's tokens in it");

  // The front page's own document, drawn here rather than in the reader's browser. Asked for before anything is written, the same as the module is: a page baked empty is the blank page this whole change exists to end.
  let baked = null;
  try {
    baked = bakeFrontPage(readFileSync(join(root, FRONT_PAGE), 'utf8'), leaf.render(readFileSync(join(root, FRONT_DOCUMENT), 'utf8'), FRONT_DOCUMENT));
    if (frontPageIsEmpty(baked)) fail(`${FRONT_PAGE} came out of the bake with no document in it`);
  } catch (error) {
    fail(error.message);
  }

  if (problems.length) {
    console.error('the site has nothing worth publishing:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  mkdirSync(join(root, ASSET_DIR), { recursive: true });
  copyFileSync(BUILT_MODULE, join(root, MODULE_PATH));
  writeFileSync(join(root, STYLES_PATH), styles);
  writeFileSync(join(root, VERSION_PATH), `${JSON.stringify({ version: appVersion() }, null, 2)}\n`);

  writeFileSync(join(root, FRONT_PAGE), baked);

  for (const path of [...PUBLISHED, FRONT_PAGE]) console.log(`wrote ${path}`);
}
