// Compile the per-family theme files under themes/ into two generated outputs:
//
//   1. src/assets/themes.md  — the single Markdown bundle the app binary embeds
//      (via include_str! in src/theme.rs). It is just the family files
//      concatenated in display-name order; Rust does the real parsing.
//   2. themes/README.md      — a self-updating gallery of every family in the
//      folder (a light-vs-dark palette table per theme), so the folder landing
//      page always matches what's actually there.
//
// themes/ is the human source of truth — one Markdown file per theme family, also served at leaftext.com/themes and (being Markdown) readable in Leaf itself. Each file names the family (# H1), states its family id, and lists its Light/Dark token tables; see themes/README.md or any existing file for the shape.
//
// A family file may also open with a preview image — a standalone `![alt](../imgs/themes/<id>.png)` line above the `**Family ID:**` line. It is optional; when present the file must point at an image that exists, and the gallery reuses it (README.md sits in themes/, so the same relative path works).
//
//   node scripts/bundle-themes.mjs          regenerate both outputs
//   node scripts/bundle-themes.mjs --check  fail if either output has drifted
//                                           (used by `just verify`)
//
// To add a theme: drop themes/<id>.md (its `# Name`, `**Family ID:** <id>`, and Light/Dark tables) and run `just bundle-themes`. No manifest to maintain — the folder is globbed, and README.md is regenerated to include it.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = join(root, 'themes');
const bundlePath = join(root, 'src', 'assets', 'themes.md');
const readmePath = join(themesDir, 'README.md');
const check = process.argv.includes('--check');

// The roles shown in the README gallery, keyed by the (prefix-stripped) token name. A small, representative slice — the full palette lives in each file.
const GALLERY_ROLES = [
  ['background', 'Background'],
  ['foreground', 'Foreground'],
  ['markdown-heading', 'Heading'],
  ['primary', 'Primary'],
  ['accent', 'Accent'],
  ['link', 'Link'],
  ['success', 'Success'],
  ['warning', 'Warning'],
  ['danger', 'Danger'],
  ['border', 'Border'],
];

function stripTicks(value) {
  const v = value.trim();
  return v.startsWith('`') && v.endsWith('`') ? v.slice(1, -1) : v;
}

function rowCells(line) {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function isSeparator(cells) {
  let sawDash = false;
  for (const cell of cells) {
    if (cell === '') continue;
    if (!/^[-:]+$/.test(cell) || !cell.includes('-')) return false;
    sawDash = true;
  }
  return sawDash;
}

// The first family in a CSS font stack, unquoted (`"Noto Sans", ...` -> Noto Sans).
function firstFamily(stack) {
  const first = (stack || '').split(',')[0].trim();
  return first.replace(/^["']|["']$/g, '');
}

// Parse one family file into { displayName, id, preview, fonts, light, dark }, where light/dark are the *effective* token maps (base tokens overlaid by overrides) and preview is the optional `{ alt, src }` of the header image. Mirrors parse_theme_markdown() in src/theme.rs, minus the --lt- prefix.
function parseFamily(file, body) {
  const fam = {
    displayName: null,
    id: null,
    preview: null,
    fonts: { heading: '', body: '', code: '', google: '' },
    light: { tokens: {}, overrides: {} },
    dark: { tokens: {}, overrides: {} },
  };
  let section = 'none'; // 'fonts' | 'light' | 'dark' | 'none'
  let bucket = 'tokens'; // 'tokens' | 'overrides'
  let inTableBody = false;

  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('# ')) {
      fam.displayName = line.slice(2).trim();
      section = 'none';
      bucket = 'tokens';
      inTableBody = false;
      continue;
    }
    const idMatch = line.match(/^\*\*Family ID:\*\*\s*`([^`]+)`/);
    if (idMatch) {
      fam.id = idMatch[1];
      continue;
    }
    // The optional preview image: a standalone image line in the header, above the first `##` section. Later images (inside a section) are left alone.
    const previewMatch = line.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/);
    if (previewMatch && section === 'none' && !fam.preview) {
      fam.preview = { alt: previewMatch[1].trim(), src: previewMatch[2] };
      inTableBody = false;
      continue;
    }
    if (line.startsWith('## ')) {
      inTableBody = false;
      const h = line.slice(3).trim().toLowerCase();
      if (h === 'fonts') section = 'fonts';
      else if (h === 'light') {
        section = 'light';
        bucket = 'tokens';
      } else if (h === 'dark') {
        section = 'dark';
        bucket = 'tokens';
      } else section = 'none';
      continue;
    }
    if (line.startsWith('### ')) {
      inTableBody = false;
      bucket = line.slice(4).trim().toLowerCase() === 'overrides' ? 'overrides' : 'tokens';
      continue;
    }
    if (line.startsWith('|')) {
      const cells = rowCells(line);
      if (isSeparator(cells)) {
        inTableBody = true;
        continue;
      }
      if (!inTableBody) continue; // header row
      const key = (cells[0] || '').trim();
      const value = stripTicks(cells[1] || '');
      if (section === 'fonts') {
        const role = key.toLowerCase();
        if (role in fam.fonts) fam.fonts[role] = value;
      } else if (section === 'light' || section === 'dark') {
        fam[section][bucket][key] = value;
      }
      continue;
    }
    inTableBody = false;
  }

  if (!fam.displayName) {
    throw new Error(`themes/${file} is missing its "# <display name>" heading`);
  }
  if (!fam.id) {
    throw new Error(`themes/${file} is missing its "**Family ID:** \`<id>\`" line`);
  }
  const expected = file.slice(0, -3);
  if (fam.id !== expected) {
    throw new Error(
      `themes/${file}: family id \`${fam.id}\` does not match the filename \`${expected}\``,
    );
  }
  // A preview is optional, but a broken one is not: catch a typo'd path here rather than shipping a missing image to GitHub, the site, and the app.
  if (fam.preview && !/^[a-z][a-z0-9+.-]*:/i.test(fam.preview.src)) {
    if (!existsSync(join(themesDir, fam.preview.src))) {
      throw new Error(
        `themes/${file}: preview image \`${fam.preview.src}\` does not exist ` +
          `(paths are relative to the themes/ folder)`,
      );
    }
  }
  fam.effective = {
    light: { ...fam.light.tokens, ...fam.light.overrides },
    dark: { ...fam.dark.tokens, ...fam.dark.overrides },
  };
  return fam;
}

function buildGallery(families) {
  const lines = [];
  lines.push('<!-- Generated by scripts/bundle-themes.mjs from the *.md files in this folder.');
  lines.push('     Do not edit by hand; edit a family file and run `just bundle-themes`. -->');
  lines.push('');
  lines.push('# Leaftext themes');
  lines.push('');
  lines.push(
    'Every theme in Leaftext is plain data — one Markdown file per family, right here in ' +
      'this folder. Because they are Markdown, they render as the color tables below in Leaf ' +
      'itself and at [leaftext.com/themes](https://leaftext.com/themes).',
  );
  lines.push('');
  lines.push(
    `${families.length} families ship today, listed alphabetically (the order the theme ` +
      'picker uses). Each links to its full file; the screenshot is the same document split ' +
      'across the light and dark variants, and the table previews the key colors — every ' +
      'family also defines the full 82-token contract inside its file.',
  );
  lines.push('');
  lines.push(
    'Mermaid diagrams take these same tokens, so a family says nothing about diagrams and ' +
      'gets them anyway: boxes the muted surface, subgraphs the sunken one, arrows the muted ' +
      'foreground, and a Gantt chart the theme\'s own active / done / critical colors. Text ' +
      'printed inside one of those fills takes whichever of the theme\'s inks reads on it, ' +
      'measured rather than assumed. The twelve-color categorical scale a mindmap or pie chart ' +
      "cycles through is the family's own primary, its hue stepped around the wheel with every " +
      'entry held to the same weight, so one ink reads on all twelve.',
  );
  lines.push('');
  lines.push('## Gallery');
  lines.push('');

  for (const fam of families) {
    lines.push(`### ${fam.displayName}`);
    lines.push('');
    const fontKind = fam.fonts.google ? 'Google Fonts' : 'System fonts';
    lines.push(
      `[\`${fam.id}.md\`](${fam.id}.md) · Heading **${firstFamily(fam.fonts.heading)}** · ` +
        `Body **${firstFamily(fam.fonts.body)}** · Code **${firstFamily(fam.fonts.code)}** · ${fontKind}`,
    );
    lines.push('');
    if (fam.preview) {
      // README.md lives in themes/ alongside the family files, so the preview path carries over verbatim.
      lines.push(`![${fam.preview.alt}](${fam.preview.src})`);
      lines.push('');
    }
    lines.push('| Role       | Light     | Dark      |');
    lines.push('| ---------- | --------- | --------- |');
    for (const [key, label] of GALLERY_ROLES) {
      const light = fam.effective.light[key] ?? '—';
      const dark = fam.effective.dark[key] ?? '—';
      lines.push(`| ${label.padEnd(10)} | \`${light}\` | \`${dark}\` |`);
    }
    lines.push('');
  }

  lines.push('## Adding or editing a theme');
  lines.push('');
  lines.push(
    'Copy an existing file (say `fern.md`), rename it to `<your-id>.md`, and edit the ' +
      '`# Name` heading, the `**Family ID:**` line (it must match the filename), the `## Fonts` ' +
      'table, and the `## Light` / `## Dark` token tables. Optionally add a preview screenshot ' +
      'as a standalone `![Your Family](../imgs/themes/<your-id>.png)` line under the heading — ' +
      'it shows up in the file itself and in this gallery. Then run `just bundle-themes` to ' +
      'recompile the embedded bundle and regenerate this gallery, and `just verify` to run the ' +
      'contract and contrast checks. See ' +
      '[docs/02-development/04-theming.md](../docs/02-development/04-theming.md) for the full contract.',
  );
  lines.push('');

  return lines.join('\n');
}

const files = readdirSync(themesDir)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .sort();
if (files.length === 0) {
  throw new Error('themes/ has no .md theme files');
}

const families = files.map((file) => parseFamily(file, readFileSync(join(themesDir, file), 'utf8')));
// Emit in display-name order so the picker, the bundle, and the gallery all agree.
families.sort((a, b) => a.displayName.localeCompare(b.displayName));

const bundleHeader =
  '<!-- Generated by scripts/bundle-themes.mjs from themes/*.md. Do not edit by hand;\n' +
  '     edit the per-family files under themes/ and run `just bundle-themes`. -->\n\n';
const bundle =
  bundleHeader +
  families
    .map((f) => readFileSync(join(themesDir, `${f.id}.md`), 'utf8').replace(/\s*$/, '') + '\n')
    .join('\n');

const gallery = buildGallery(families).replace(/\s*$/, '') + '\n';

const outputs = [
  { label: 'src/assets/themes.md', path: bundlePath, content: bundle },
  { label: 'themes/README.md', path: readmePath, content: gallery },
];

if (check) {
  let drifted = false;
  for (const { label, path, content } of outputs) {
    if (readFileSync(path, 'utf8') !== content) {
      console.error(`${label} is out of date with themes/. Run: just bundle-themes`);
      drifted = true;
    }
  }
  if (drifted) process.exit(1);
  console.log(`themes.md + README.md match themes/ (${families.length} families)`);
} else {
  for (const { path, content } of outputs) writeFileSync(path, content);
  console.log(`bundled ${families.length} families into src/assets/themes.md and themes/README.md`);
}
