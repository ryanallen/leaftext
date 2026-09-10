#!/usr/bin/env node
// What the published site serves beside its pages: the app's own renderer as a module, its document stylesheet, the version both were built from — and the two pages the publish writes into: the front page with its document already in it, and the documentation reader with the file list its sidebar is built from.
//
//   node scripts/site-assets.mjs           name every published path and say whether it is there
//   node scripts/site-assets.mjs --write   build the four out of web/dist into the site tree, and bake both pages without writing either anywhere
//   node scripts/site-assets.mjs --bake    bake both pages — the front page through the renderer already beside them — into the copies the deploy uploads
//
// **`--bake` is the public repository's half.** The source is private, so the repository that deploys leaftext.com cannot compile a module; the renderer workflow in the private repository hands it the three files above and its deploy bakes the front page through the one it was handed, and the docs page out of the documentation folder it was handed beside it. Same bake, same refusals, and no Rust anywhere near it — what `--write` adds on top is building those three files in the first place, which is the half only a checkout with the source in it can do.
//
// **Not one of these files is ever committed.** `.gitignore` refuses the folder they land in, so the publish builds them and the repository keeps its seventeen small readable files instead of a compiled module nobody can read a diff of. The publish workflow runs this script; `scripts/check-site.mjs` reads the table below, so a renamed output shows up offline as a page fetching a file nobody writes rather than as a blank document on the live site. `scripts/serve-site.mjs` reads it too, and hands a browser what it says rather than whatever the last publish left on disk — there is one answer to which renderer the site is read through.
//
// **Both pages are baked, never written here.** The repository keeps the front page with an empty content element and the docs page with an empty file list, and `--bake` fills each in the workspace the deploy uploads — so a cold visitor reads the words out of the first response instead of after a 2.8 MB module and a second fetch, and a reader of the documentation gets a sidebar without a call to the GitHub API that a limit can refuse. `--write` draws the same document and puts it nowhere: the bake is its check that the module can draw the README before a byte crosses, and writing the result over the tracked page is what committed a baked front page and stopped the whole gate in every session. So the only run that writes the page is the deploy's own, in the copy it is about to upload, and `scripts/check-site.mjs` goes on refusing a committed copy that already holds a document.
//
// The other site rides on these too. Emptyguru has no Rust and no app source, so its pages name leaftext.com for exactly these paths — which works because GitHub Pages sends `access-control-allow-origin: *` on every asset. That is why the names here are a contract with another repository and not an implementation detail.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instantiateCore } from './web-module.mjs';
import { imageSizes } from './site-images.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The folder every published asset lands in, and the one line `.gitignore` refuses. */
export const ASSET_DIR = 'assets/leaftext';

/** The renderer itself — the core build, with no highlighter in it: a page colors its own fences with the runtime it already ships. */
export const MODULE_PATH = `${ASSET_DIR}/leaftext.wasm`;

/** The app's document stylesheet, as `leaf_styles()` emits it. */
export const STYLES_PATH = `${ASSET_DIR}/leaftext.css`;

/** Which build a page is reading through, so a reader of either site can tell how old its renderer is. */
export const VERSION_PATH = `${ASSET_DIR}/version.json`;
export const IMAGE_SIZES_PATH = `${ASSET_DIR}/image-sizes.json`;

export const PUBLISHED = [MODULE_PATH, STYLES_PATH, VERSION_PATH, IMAGE_SIZES_PATH];

/** The build these are cut from. Not published itself — it is what `just build-web` leaves behind. The local preview draws the front page through this one too, so there is one answer to which module the site is read against. */
export const BUILT_MODULE = join(root, 'web', 'dist', 'leaftext-core.wasm');

/** The front page, and the document it draws: the publish writes the one into the other. */
export const FRONT_PAGE = 'index.html';
export const FRONT_DOCUMENT = 'README.md';

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

/** The documentation reader, and the folder whose file list the publish writes into it. */
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

/**
 * Every file the documentation folder holds, relative to it and in one order.
 *
 * All of them, not the ones that look like documents: which listed path is a page is the renderer's own table to answer, asked in the browser off `leaf_formats`, and a second extension list here would be the one to fall behind it.
 */
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
 * The docs page with its own file list already in it — what the deploy uploads and what the preview answers, never what the repository holds.
 *
 * Without it the sidebar is discovered at runtime two ways and only the second can happen: a static host answers the docs folder address with the `index.html` that folder holds, which is this reader, so every visitor reached api.github.com for the page list — sixty calls an hour per address, and no route to another page past that.
 *
 * A page already holding a list is refused rather than written over: a committed one serves whatever the folder held the day somebody wrote it, and the whole point of baking is that nobody keeps it up to date.
 */
export function bakeDocsPage(page, paths) {
  if (!DOCS_LIST.test(page)) throw new Error(`${DOCS_PAGE} has no element to write its file list into`);
  if (!docsPageIsEmpty(page)) throw new Error(`${DOCS_PAGE} already holds a file list, which is whatever the folder held the day somebody committed it`);
  if (!Array.isArray(paths) || !paths.length) throw new Error(`there are no documentation files to write into ${DOCS_PAGE}`);
  // A JSON script element ends at the first `</script`, so the three characters that could close it early or open a tag are written as escapes the parser reads back as themselves.
  const written = JSON.stringify(paths).replace(/[<>&]/g, (c) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[c]);
  return page.replace(DOCS_HOLDER, (_, open, __, close) => open + written + close);
}

/**
 * What each published file *is*, against the table above of what they are called: the module's bytes, the stylesheet the built module hands over, and the version out of `Cargo.toml`.
 *
 * The publish writes these to disk and the local preview answers them straight to a browser, so one table is what stops the preview drawing a page through the copy the last publish left beside it. It is handed the module's bytes rather than a file to copy, which is what lets the same answer serve a browser and write a folder.
 */
export function publishedAssets(leaf, moduleBytes) {
  return new Map([
    [MODULE_PATH, moduleBytes],
    [STYLES_PATH, leaf.styles()],
    [VERSION_PATH, `${JSON.stringify({ version: appVersion() }, null, 2)}\n`],
    [IMAGE_SIZES_PATH, `${JSON.stringify(imageSizes())}\n`],
  ]);
}

/**
 * Everything the local preview answers ahead of the disk, keyed by path within the repository: the four files the publish writes, and — baked — the front page with its document already in it and the docs page with its own file list already in it.
 *
 * It is built here rather than in the server because this is where its two halves already live, so the gate can ask for it with a stand-in module and never wait on `just build-web`. Unbaked neither page is in it and the four still are: that first paint is a second first paint, not a second renderer.
 *
 * The docs page is baked here as well as at publish because this preview answers a folder address the way the published host does — with the `index.html` that folder holds, which is the reader itself. Left unbaked the sidebar would be discovered over the GitHub API in local preview too.
 */
export function previewAnswers(leaf, moduleBytes, { baked = true } = {}) {
  const answers = new Map(publishedAssets(leaf, moduleBytes));
  if (baked) {
    const page = readFileSync(join(root, FRONT_PAGE), 'utf8');
    answers.set(FRONT_PAGE, bakeFrontPage(page, leaf.render(readFileSync(join(root, FRONT_DOCUMENT), 'utf8'), FRONT_DOCUMENT)));
    answers.set(DOCS_PAGE, bakeDocsPage(readFileSync(join(root, DOCS_PAGE), 'utf8'), docsPaths()));
  }
  return answers;
}

/**
 * Which paths a run of this script writes.
 *
 * Answered here rather than decided inside `main`, so the gate can ask it offline with no module built — and so there is one answer rather than a decision made twice.
 *
 * `--write` writes the four built files and leaves both tracked pages alone. It still bakes them, because that bake is the check that the module can draw the README and that the docs page still has a holder to write its file list into, before a byte crosses; nothing reads the result. Only `--bake` writes them, into the workspace the deploy uploads, which is the one place a written page is ever read.
 */
export function writtenPaths({ bakeOnly = false } = {}) {
  return bakeOnly ? [FRONT_PAGE, DOCS_PAGE] : [...PUBLISHED];
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
  const source = bakeOnly ? join(root, MODULE_PATH) : BUILT_MODULE;
  if (!existsSync(source)) {
    console.error(
      bakeOnly
        ? `${MODULE_PATH} is not here, so there is no renderer to draw the front page with. It is committed by the renderer workflow in the private repository; a deploy that cannot find it is one that ran before the hand-over.`
        : 'the renderer is not built — run: just build-web'
    );
    process.exit(1);
  }

  // A module that copied is not a module that answers, and a publish that replaced a working site with pages that cannot draw is worse than one that did not run. So it is asked before anything is written, and a failure here leaves the last published site standing.
  const leaf = await instantiateCore(source);
  const styles = leaf.styles();
  const rendered = leaf.render('# Published\n\nA paragraph.\n', 'check.md');
  if (!rendered?.html.includes('<h1 id="published">')) fail('the built module did not render a document');
  if (!styles?.includes('data-leaf-theme')) fail("the built module handed over a stylesheet with none of the app's themes in it");
  if (!styles?.includes('--lt-background')) fail("the built module handed over a stylesheet with none of the app's tokens in it");

  // The front page's own document, drawn here rather than in the reader's browser. Asked for before anything is written, the same as the module is: a page baked empty is the blank page a reader waits in front of.
  let baked = null;
  try {
    baked = bakeFrontPage(readFileSync(join(root, FRONT_PAGE), 'utf8'), leaf.render(readFileSync(join(root, FRONT_DOCUMENT), 'utf8'), FRONT_DOCUMENT));
    if (frontPageIsEmpty(baked)) fail(`${FRONT_PAGE} came out of the bake with no document in it`);
  } catch (error) {
    fail(error.message);
  }

  // The documentation folder's own file list, written into the reader that draws it. No module is asked anything here — the list is paths — but it is read at the same moment and for the same reason: a docs page that reached the deploy without one sends every visitor to api.github.com for its sidebar.
  let bakedDocs = null;
  try {
    bakedDocs = bakeDocsPage(readFileSync(join(root, DOCS_PAGE), 'utf8'), docsPaths());
    if (docsPageIsEmpty(bakedDocs)) fail(`${DOCS_PAGE} came out of the bake with no file list in it`);
  } catch (error) {
    fail(error.message);
  }

  if (problems.length) {
    console.error('the site has nothing worth publishing:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  // The bake above is a check, not an output: baking `--write`'s page onto the disk is what put a baked front page in the tree, and nothing ever read it — the hand-over fills its clone out of the commit and the deploy bakes its own copy.
  const bytesFor = bakeOnly ? new Map([[FRONT_PAGE, baked], [DOCS_PAGE, bakedDocs]]) : publishedAssets(leaf, readFileSync(BUILT_MODULE));
  if (!bakeOnly) mkdirSync(join(root, ASSET_DIR), { recursive: true });
  for (const path of writtenPaths({ bakeOnly })) {
    writeFileSync(join(root, path), bytesFor.get(path));
    console.log(`wrote ${path}`);
  }
}
