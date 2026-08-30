// The page's script, assembled the way the binary assembles it, and the one record what crosses a file boundary by assignment rides on. The fragment list is read from the app itself — APP_SHELL_SCRIPT_PARTS in `src/lib.rs` — so nothing here is a second copy of it.
//
// Reached through `shared.mjs`, never imported by a subject file directly.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The top of the checkout, which every file the checks read is spelled from.
export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function shellSource() {
  const lib = readFileSync(join(root, 'src/lib.rs'), 'utf8');
  const partsNamed = (constant) => {
    const list = lib.match(new RegExp(constant + ': &\\[ShellFragment\\] = shell_fragments!\\[([\\s\\S]*?)\\];'));
    if (!list) throw new Error(`could not find ${constant} in src/lib.rs`);
    // Anchored at the start of a line, so a path written into one of the list's own comments is not read as a fragment.
    return [...list[1].matchAll(/^\s*"assets\/(.*?)",/gm)].map((m) => m[1]);
  };
  // One list, served as one file behind the page's one script tag — so booting them joined in this order is exactly what the web view does.
  const names = partsNamed('APP_SHELL_SCRIPT_PARTS');
  if (names.length < 10) throw new Error(`expected the whole fragment list, got ${names.length}`);
  const page = readFileSync(join(root, 'src/assets/app-shell.html'), 'utf8');
  const tags = (page.match(/<script/g) || []).length;
  // The theme bootstrap, which runs before this in its own scope, is the only tag the template writes itself. The front-end is a seam the host fills — a deferred tag for a browser, the loader for the desktop — so the template carries none for it and the seam is what has to be there.
  if (tags !== 1) throw new Error(`the page should carry one script tag, found ${tags}`);
  if (!page.includes('{{FRONT_END}}')) {
    throw new Error('the page no longer carries the seam a host fills the front-end into');
  }
  return {
    names,
    source: names.map((name) => readFileSync(join(root, 'src/assets', name), 'utf8')).join(''),
  };
}

// ---- the script the whole suite is read against -----------------------------

export const { names, source } = shellSource();

// ---- what crosses a file boundary by assignment ------------------------------
//
// A module cannot assign to a name it imported, so nothing that is written from another file can be an exported `let`. Those four are properties of one record instead.

export const record = {
  // The page the boot made. Every check after it reads this one, whatever the check before it did to it.
  booted: null,
  // The hand-back `check` calls after every check: without it a check that drives the app — opens the pane, folds the bar, switches a view — leaves the next one standing in whatever it left behind, failing on something it never names.
  restore: null,
  // How many commands the browser's own host answers, counted off its own table by the check that reads it rather than written down twice.
  webAnswered: 0,
  // The same, for the embed's own host one file over.
  embedAnswered: 0,
};
