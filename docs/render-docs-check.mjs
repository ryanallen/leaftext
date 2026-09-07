// render-docs-check.mjs
// ---------------------------------------------------------------------------
// A headless smoke test for the docs: render every Markdown file under docs/ through the app's own renderer — the same module the published site draws with — and fail loudly if any of them throws or produces empty output. Catches broken Markdown before it ships to leaftext.com/docs without needing a browser.
//
// Run from the repo root:  node docs/render-docs-check.mjs
//
// It needs the module built (`just build-web`), which is why it is not part of `just verify`: that gate stays offline and quick, and never asks for the wasm32 target.
// ---------------------------------------------------------------------------

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { instantiateCore } from '../scripts/web-module.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(root, 'docs');
const module_ = join(root, 'web', 'dist', 'leaftext-core.wasm');
if (!existsSync(module_)) {
  console.error('the renderer is not built — run: just build-web');
  process.exit(1);
}
const leaf = await instantiateCore(module_);

async function listMarkdown(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listMarkdown(full)));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = (await listMarkdown(docsDir)).sort();
let failed = 0;

for (const file of files) {
  const rel = relative(root, file);
  try {
    const md = await readFile(file, 'utf8');
    const drawn = leaf.render(md, rel.split('\\').join('/'));
    const html = drawn && drawn.html;
    if (!html || !html.trim()) throw new Error('rendered to empty output');

    // Catch MDX/Mintlify leftovers the leaftext renderer cannot handle. Match only real component tags (preceded by line-start or whitespace) so Rust generics in backticks like `Vec<Tab>` or `Option<Steps>` are not flagged.
    const leftovers = md.match(
      /(?:^|\s)<\/?(?:Tabs?|Steps?|CardGroup|Card|AccordionGroup|Accordion|Note|Tip|Warning)\b|theme=\{null\}/gm
    );
    if (leftovers) {
      throw new Error('unsupported MDX leftovers: ' + [...new Set(leftovers.map((s) => s.trim()))].join(', '));
    }

    console.log('ok   ' + rel + '  (' + html.length + ' bytes)');
  } catch (err) {
    failed++;
    console.error('FAIL ' + rel + '  -> ' + err.message);
  }
}

console.log(`\n${files.length - failed}/${files.length} docs rendered cleanly`);
if (failed) process.exit(1);
