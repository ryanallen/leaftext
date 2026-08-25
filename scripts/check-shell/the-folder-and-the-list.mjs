// The folder of fragments and the list that loads them have to hold the same files.
//
// Nothing else compares them. The boot below joins whatever `APP_SHELL_SCRIPT_PARTS` names and reports how many parsed, so a fragment written, saved and never added to that list fails at nothing — the suite goes green over an app missing the code, which was watched while the diagram theme mapping was being cut out of `decorate.js`.
//
// Two refusals, because they catch two different things:
//
//   a file the list does not name   code was written and never wired, so it is in the tree and not in the app.
//   an entry the folder lacks       the list names a file that is gone, and the binary will not compile — but the check should say which name rather than leaving it to `include_str!`.
//
// Both are proved on made-up input before the real folder is opened, the way `scripts/check-doc-modules.mjs` proves its two: a walk that finds nothing because it is broken passes exactly like one that finds nothing because the tree is clean.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { check, names, root } from './shared.mjs';

const FOLDER = 'src/assets/shell';

// The folder has held dozens of fragments for its whole life. A count far off that means the walk stopped matching, not that the front end shrank.
const FEWEST_FRAGMENTS = 20;

/** What is wrong with a given folder and a given list, both as bare file names. Pure, so the refusals can be proved on input nobody has to keep in step. */
function problems(files, listed) {
  const found = [];
  const named = new Set(listed);
  const held = new Set(files);
  for (const file of files) {
    if (named.has(file)) continue;
    found.push(`${FOLDER}/${file} is in the folder and not in APP_SHELL_SCRIPT_PARTS — a fragment nothing loads is code the app does not have`);
  }
  for (const entry of listed) {
    if (held.has(entry)) continue;
    found.push(`APP_SHELL_SCRIPT_PARTS names ${FOLDER}/${entry} and the folder does not hold it`);
  }
  return found;
}

export function run() {
  check('every fragment in the folder is in the list, and every entry in the list is in the folder', () => {
    const clean = problems(['alpha.js', 'beta.js'], ['alpha.js', 'beta.js']);
    if (clean.length) throw new Error(`a folder and a list that agree were called wrong: ${clean.join('; ')}`);
    if (!problems(['alpha.js', 'stray.js'], ['alpha.js']).some((one) => one.includes('stray.js is in the folder'))) {
      throw new Error('a fragment the list does not name passed');
    }
    if (!problems(['alpha.js'], ['alpha.js', 'gone.js']).some((one) => one.includes('names src/assets/shell/gone.js'))) {
      throw new Error('a list entry the folder does not hold passed');
    }

    const files = readdirSync(join(root, FOLDER)).filter((name) => name.endsWith('.js')).sort();
    if (files.length < FEWEST_FRAGMENTS) throw new Error(`found ${files.length} fragments under ${FOLDER}, which is too few to be the whole folder`);
    // The list also names `assets/mermaid-icons.js`, which is generated and sits beside the folder rather than in it.
    const listed = names.filter((name) => name.startsWith('shell/')).map((name) => name.slice('shell/'.length));
    const wrong = problems(files, listed);
    if (wrong.length) throw new Error(wrong.join('; '));
  });
}
