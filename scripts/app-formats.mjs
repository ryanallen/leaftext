// What the app reads, for the checks that need to know it in Node.
//
// `src/format.rs` is the only table of readable formats and their extensions, so a check that wants them asks here rather than writing a second list beside it — a second list agrees on the day it is written and falls behind on the day the table gains a row.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every extension the app reads, off `src/format.rs`. */
export function appExtensions(root) {
  const source = readFileSync(join(root, 'src/format.rs'), 'utf8');
  const arms = /fn extensions\(self\)[\s\S]*?match self \{([\s\S]*?)\n\s{8}\}/.exec(source);
  if (!arms) throw new Error('could not find the extension table in src/format.rs');
  const found = [...arms[1].matchAll(/"([\w-]+)"/g)].map((one) => one[1]);
  if (found.length < 5) throw new Error(`expected the whole extension table, got ${found.length}`);
  return found;
}
