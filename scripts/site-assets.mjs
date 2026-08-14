#!/usr/bin/env node
// What the published site serves beside its pages: the app's own renderer as a module, its document stylesheet, and the version both were built from.
//
//   node scripts/site-assets.mjs           name every published path and say whether it is there
//   node scripts/site-assets.mjs --write   build them out of web/dist into the site tree
//
// **Not one of these files is ever committed.** `.gitignore` refuses the folder they land in, so the publish builds them and the repository keeps its seventeen small readable files instead of a compiled module nobody can read a diff of. The publish workflow runs this script; `scripts/check-site.mjs` reads the table below, so a renamed output shows up offline as a page fetching a file nobody writes rather than as a blank document on the live site.
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

  if (problems.length) {
    console.error('the site has nothing worth publishing:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  mkdirSync(join(root, ASSET_DIR), { recursive: true });
  copyFileSync(BUILT_MODULE, join(root, MODULE_PATH));
  writeFileSync(join(root, STYLES_PATH), styles);
  writeFileSync(join(root, VERSION_PATH), `${JSON.stringify({ version: appVersion() }, null, 2)}\n`);

  for (const path of PUBLISHED) console.log(`wrote ${path}`);
}
