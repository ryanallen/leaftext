// Rebuild the vendored Monaco bundle at src/assets/vendor/monaco/{monaco.js,monaco.css}.
//
// Monaco (the VS Code editor) powers the raw-source code view. Unlike the other vendored libraries it is NOT distributed as one drop-in file, so we bundle it here: the core editor (which includes the minimap, line wrapping and the mouse handling that puts a second cursor down), the Markdown / HTML / XML / YAML colorizers, and the three UI contributions we stand on — the suggestion popup and the hover card for typing help, and multicursor for add-a-cursor-above/below and add-the-next-match. Still no language services and no web workers: the popup's *answers* come from the host over IPC (code-intel.js), so colorizing, the minimap and the popup all run on the main thread. esbuild inlines the icon font, so the output is just monaco.js + monaco.css.
//
// This is a manual regeneration step, like the other vendored assets — it is not part of `just verify`. It needs monaco-editor and esbuild:
//
//   cd app && npm i --no-save monaco-editor@0.52.2 esbuild@0.24.0
//   node scripts/bundle-monaco.mjs
//
// If the editor's feature set or version changes, edit ENTRY / the version above and re-run, then commit the regenerated monaco.js + monaco.css.

import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src/assets/vendor/monaco');
const entryPath = join(outDir, '.entry.js');

const ENTRY = `
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor';
globalThis.LeafMonaco = monaco;
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(entryPath, ENTRY);
try {
  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'iife',
    minify: true,
    platform: 'browser',
    legalComments: 'none',
    loader: { '.ttf': 'dataurl' },
    outfile: join(outDir, 'monaco.js'),
  });
  console.log('bundled src/assets/vendor/monaco/{monaco.js,monaco.css}');
} finally {
  rmSync(entryPath, { force: true });
}
