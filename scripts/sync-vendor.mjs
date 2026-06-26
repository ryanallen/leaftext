// Keep the static site's vendored assets identical to the ones compiled into the
// app binary. `src/assets` is the source of truth: those files are embedded via
// `include_bytes!` in src/lib.rs. The site (and the /docs SPA) serve their own
// static copies under site/, so the two must not drift — a mismatch would make
// the website render math, diagrams, or fonts differently from the desktop app.
//
//   node scripts/sync-vendor.mjs          copy src/assets -> site
//   node scripts/sync-vendor.mjs --check  fail if they differ (used by `just verify`)
//
// site/vendor/highlight.min.js and site/styles.css have no src/assets counterpart
// (web-only) and are deliberately left alone.

import { cpSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// [source under src/assets, destination under site]
const PAIRS = [
  ['vendor/mermaid.min.js', 'vendor/mermaid.min.js'],
  ['vendor/katex', 'vendor/katex'],
  ['noto-fonts.css', 'noto-fonts.css'],
  ['Noto-OFL.txt', 'Noto-OFL.txt'],
];

const check = process.argv.includes('--check');

// Every file under `dir`, as paths relative to it (recursing into folders).
function filesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = entry.name;
    if (entry.isDirectory()) {
      for (const nested of filesUnder(join(dir, rel))) out.push(join(rel, nested));
    } else {
      out.push(rel);
    }
  }
  return out;
}

// Expand a (src, dest) pair into concrete file pairs, whether it names a file or
// a directory, so --check can compare each file's bytes.
function expand(srcRel, destRel) {
  const srcAbs = join(root, 'src/assets', srcRel);
  if (statSync(srcAbs).isDirectory()) {
    return filesUnder(srcAbs).map((f) => [join(srcRel, f), join(destRel, f)]);
  }
  return [[srcRel, destRel]];
}

let drift = 0;
let copied = 0;
for (const [srcRel, destRel] of PAIRS) {
  if (check) {
    for (const [s, d] of expand(srcRel, destRel)) {
      const a = readFileSync(join(root, 'src/assets', s));
      const b = readFileSync(join(root, 'site', d));
      if (!a.equals(b)) {
        console.error(`drift: site/${d.replace(/\\/g, '/')} differs from src/assets/${s.replace(/\\/g, '/')}`);
        drift++;
      }
    }
  } else {
    cpSync(join(root, 'src/assets', srcRel), join(root, 'site', destRel), { recursive: true });
    copied++;
    console.log(`synced site/${destRel.replace(/\\/g, '/')}`);
  }
}

if (check) {
  if (drift) {
    console.error(`\n${drift} vendored file(s) out of sync. Run: node scripts/sync-vendor.mjs`);
    process.exit(1);
  }
  console.log('vendored site assets match src/assets');
} else {
  console.log(`done (${copied} target(s))`);
}
