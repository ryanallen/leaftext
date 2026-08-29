// The app's complete static stylesheet: tokens, drawings, then the rules read out of the one list that orders them. `reading_mode_css()` in `src/theme.rs` puts the compiled theme colors ahead of this join at run time; checks that need those colors read that result in Rust.
//
// Three shapes, because the callers want three different things. `parts()` hands back every static file with its own text and line numbering. `ruleParts()` keeps checks about hand-written rules under `src/assets/reading/` off generated values and classes. `whole()` hands back the static cascade, for a check that slices the sheet by exact text or searches all of it at once.
//
// There is no second copy of the order. This reads the Rust array the same way `scripts/check-shell/shared.mjs` reads `APP_SHELL_SCRIPT_PARTS` out of `src/lib.rs`, so a part added to the binary is a part every check sees.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_PREFIX = ['src/assets/tokens.css', 'src/assets/icons.css'];

/** The paths in `READING_CSS_PARTS`, in cascade order, relative to the repository root. */
export function rulePartPaths() {
  const theme = readFileSync(join(root, 'src/theme.rs'), 'utf8');
  const list = theme.match(/READING_CSS_PARTS: &\[&str\] = &\[([\s\S]*?)\];/);
  if (!list) throw new Error('could not find READING_CSS_PARTS in src/theme.rs');
  const paths = [...list[1].matchAll(/include_str!\("(.*?)"\)/g)].map((hit) => `src/${hit[1]}`);
  if (!paths.length) throw new Error('READING_CSS_PARTS in src/theme.rs is empty');
  return paths;
}

/** Every static path the binary composes, after the run-time theme colors and in cascade order. */
export function partPaths() {
  return [...STATIC_PREFIX, ...rulePartPaths()];
}

const readParts = (paths) => paths.map((path) => ({ path, css: readFileSync(join(root, path), 'utf8') }));

/** Each static part as `{ path, css }`, in cascade order. A line number taken off `css` is a line in `path`. */
export function parts() {
  return readParts(partPaths());
}

/** The hand-written rule parts alone, for checks whose subject is `src/assets/reading/`. */
export function ruleParts() {
  return readParts(rulePartPaths());
}

const separatorAfter = (index) => (index < STATIC_PREFIX.length ? '\n' : '');

/** The complete static cascade the binary builds after its run-time theme colors. */
export function whole() {
  return parts()
    .map((part, index) => part.css + separatorAfter(index))
    .join('');
}

/** A 1-based line in `whole()` as `{ path, n }` — the part it fell in, and its line there. For a check that has to reason across the whole cascade (a rest rule in one part answered by a hover rule in another) and still hand back a place a reader can open. */
export function locate(line) {
  let first = 1;
  for (const [index, part] of parts().entries()) {
    // Every source file ends with a newline, so its last line is complete and the next source starts on a line of its own.
    const count = part.css.split('\n').length - 1;
    if (line < first + count) return { path: part.path, n: line - first + 1 };
    first += count;
    if (separatorAfter(index)) {
      if (line === first) throw new Error(`line ${line} is a separator the binary adds after ${part.path}`);
      first += 1;
    }
  }
  throw new Error(`line ${line} is past the end of the stylesheet`);
}
