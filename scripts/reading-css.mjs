// The app stylesheet as its parts, read out of the one list that orders them. `reading_mode_css()` in `src/theme.rs` concatenates `READING_CSS_PARTS` with nothing between the entries, so the join here is what the browser is handed, byte for byte.
//
// Two shapes, because the callers want two different things. `parts()` hands back each file with its own text and its own line numbering, for a check that prints `file:line` a reader opens — a line number taken off the concatenation would name a line in a file that does not exist. `whole()` hands back the concatenation, for a check that slices the sheet by exact text or searches all of it at once.
//
// There is no second copy of the order. This reads the Rust array the same way `scripts/check-shell/shared.mjs` reads `APP_SHELL_SCRIPT_PARTS` out of `src/lib.rs`, so a part added to the binary is a part every check sees.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The paths in `READING_CSS_PARTS`, in cascade order, relative to the repository root. */
export function partPaths() {
  const theme = readFileSync(join(root, 'src/theme.rs'), 'utf8');
  const list = theme.match(/READING_CSS_PARTS: &\[&str\] = &\[([\s\S]*?)\];/);
  if (!list) throw new Error('could not find READING_CSS_PARTS in src/theme.rs');
  const paths = [...list[1].matchAll(/include_str!\("(.*?)"\)/g)].map((hit) => `src/${hit[1]}`);
  if (!paths.length) throw new Error('READING_CSS_PARTS in src/theme.rs is empty');
  return paths;
}

/** Each part as `{ path, css }`, in cascade order. A line number taken off `css` is a line in `path`. */
export function parts() {
  return partPaths().map((path) => ({ path, css: readFileSync(join(root, path), 'utf8') }));
}

/** The stylesheet the way the binary builds it: every part, joined with nothing. */
export function whole() {
  return parts()
    .map((part) => part.css)
    .join('');
}

/** A 1-based line in `whole()` as `{ path, n }` — the part it fell in, and its line there. For a check that has to reason across the whole cascade (a rest rule in one part answered by a hover rule in another) and still hand back a place a reader can open. */
export function locate(line) {
  let first = 1;
  for (const part of parts()) {
    // Every part ends with a newline, so its last line is complete and the next part starts a line of its own. That is also what makes the join a plain concatenation.
    const count = part.css.split('\n').length - 1;
    if (line < first + count) return { path: part.path, n: line - first + 1 };
    first += count;
  }
  throw new Error(`line ${line} is past the end of the stylesheet`);
}
