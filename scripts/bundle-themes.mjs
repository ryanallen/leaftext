// Compile the per-family theme files under themes/ into the single
// src/assets/themes.json that the app binary embeds (via include_str! in
// src/theme.rs). themes/ is the human source of truth — one file per theme
// family, also served at leaftext.com/themes — and themes/manifest.json lists
// them in picker order. This bundles them in that order.
//
//   node scripts/bundle-themes.mjs          themes/ -> src/assets/themes.json
//   node scripts/bundle-themes.mjs --check  fail if the bundle has drifted
//                                           (used by `just verify`)
//
// To add a theme: drop themes/<name>.json (an array of its light/dark source
// objects) and add "<name>" to themes/manifest.json, then run `just bundle-themes`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = join(root, 'themes');
const bundlePath = join(root, 'src', 'assets', 'themes.json');
const check = process.argv.includes('--check');

const manifest = JSON.parse(readFileSync(join(themesDir, 'manifest.json'), 'utf8'));
if (!Array.isArray(manifest.themes)) {
  throw new Error('themes/manifest.json must have a "themes" array of family names');
}

const families = [];
for (const family of manifest.themes) {
  const familySources = JSON.parse(readFileSync(join(themesDir, `${family}.json`), 'utf8'));
  if (!Array.isArray(familySources) || familySources.length === 0) {
    throw new Error(`themes/${family}.json must be a non-empty array of theme sources`);
  }
  families.push({ name: familySources[0].family_name, sources: familySources });
}
// Emit families sorted by display name, so the picker/gallery stay alphabetical
// no matter what order themes are added to the manifest.
families.sort((a, b) => a.name.localeCompare(b.name));
const sources = families.flatMap((f) => f.sources);

const bundle = JSON.stringify(sources, null, 2) + '\n';

if (check) {
  const current = readFileSync(bundlePath, 'utf8');
  if (current !== bundle) {
    console.error('src/assets/themes.json is out of date with themes/. Run: just bundle-themes');
    process.exit(1);
  }
  console.log(`themes.json matches themes/ (${sources.length} sources)`);
} else {
  writeFileSync(bundlePath, bundle);
  console.log(`bundled ${sources.length} sources from ${manifest.themes.length} families`);
}
