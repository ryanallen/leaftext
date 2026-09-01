#!/usr/bin/env node
// The modules a browser loads, and what each costs on the wire.
//
//   node scripts/build-web.mjs           build them all, print every size, hold the ceiling
//   node scripts/build-web.mjs --check   the same, without rebuilding if the files are there
//
// More than one module because the highlighter is most of the weight and most documents have no code in them: a page downloads the core, and fetches the second only for a document that turns out to have a fence. The ceiling below is what makes that split worth having — let the core drift past it and the decision quietly stops being true.
//
// Four, because the front end is the other axis. The core and the core-with-colors render a document into somebody else's markup; the other two carry the app's own page, front end and boot state — the embed module without colors, and the whole app with them. A product dropping an editor into its own page downloads the third; a published static site is served the fourth.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { instantiateCore } from './web-module.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = 'wasm32-unknown-unknown';
const built = join(root, 'target', target, 'release', 'leaftext_web.wasm');
const out = join(root, 'web', 'dist');

// What a page may pay before a word appears. The core measured 631 KB the day it was first built; this leaves room for the renderer to grow without leaving room for the highlighter to creep back in.
const CORE_CEILING_BROTLI = 800 * 1024;

const check = process.argv.includes('--check');

/** Compressed as a browser would receive it. Brotli is what every host serves wasm with. */
function sizes(file) {
  const bytes = readFileSync(file);
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

function build(name, features) {
  const args = ['build', '--release', '-p', 'leaftext-web', '--target', target];
  if (features) args.push('--features', features);
  try {
    execFileSync('cargo', args, { cwd: root, stdio: 'inherit' });
  } catch (error) {
    console.error(`\ncargo could not build the ${name} module.`);
    console.error(`If the target is missing: rustup target add ${target}`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  const file = join(out, `leaftext-${name}.wasm`);
  copyFileSync(built, file);
  return { file, ...sizes(file) };
}

if (check && !existsSync(built)) {
  console.error('nothing built yet — run `just build-web` first');
  process.exit(1);
}

const core = build('core', null);
const highlight = build('highlight', 'highlight');
// The app's page, front end and document buffer, without the colors: what a product embedding an editor downloads. A render-only embed has no use for the front end, which is why it is not in the two above.
const embed = build('embed', 'shell');
// The same, with the highlighter: what a published static site is served, since a site is read rather than embedded and pays for the whole app once.
const app = build('app', 'shell,highlight');

// A module that builds is not a module that answers. Every module is loaded and asked, which is the only thing here a compiler cannot check.
const fixture = '# Hello\n\nA paragraph with a [link](https://example.com).\n\n- [x] done\n\n```rust\nfn main() {}\n```\n';

/** Load a module and render `fixture` through it, the way an embedding page does. Loaded through the same wrapper the static export is built on, so the byte protocol has one copy in this repo rather than one per caller. */
async function render(file, source = fixture) {
  const module_ = await instantiateCore(file);
  const document = module_.render(source, 'notes.md');
  if (!document) throw new Error('the module refused the document');
  return document;
}

const problems = [];
const rendered = {
  core: await render(core.file),
  highlight: await render(highlight.file),
  // The embed module renders too, and it is the one that has to leave a fence plain while carrying the whole front end — the pair of facts the fourth build exists for.
  embed: await render(embed.file),
};

for (const [name, document] of Object.entries(rendered)) {
  if (document.title !== 'Hello') problems.push(`${name}: the title came back as ${JSON.stringify(document.title)}`);
  if (!document.html.includes('<h1 id="hello">')) problems.push(`${name}: no heading in the rendered document`);
  if (!document.html.includes('rel="noopener noreferrer"')) problems.push(`${name}: the sanitizer did not run`);
  if (document.blocks.length === 0) problems.push(`${name}: no block ranges, so nothing could be edited`);
  if (document.tasks.length !== 1) problems.push(`${name}: ${document.tasks.length} task markers, expected 1`);
}
// The whole reason the colors are their own module: these two leave a fence plain, and the ones carrying the highlighter color it.
for (const name of ['core', 'embed']) {
  if (rendered[name].html.includes('<span class="syn-')) problems.push(`the ${name} module colored code, so the highlighter is in it after all`);
}
if (!rendered.highlight.html.includes('<span class="syn-')) problems.push('the second module did not color code, so there is no reason to fetch it');

// ---- what a published site draws with ---------------------------------------
//
// Both published sites draw their document bodies through the core, so three things they depend on are asked here rather than found live: that the core opens every format its own table names, that a document comes back carrying exactly one Previous/Next strip and that it is the waiting one the page fills, and that a fence is left plain with its language still on it for the page's own highlighter to color.
//
// It belongs here rather than in `scripts/check-shell.mjs`: that check boots the front end offline against a stand-in module, and `just verify` must never ask for a wasm32 build. This script is the one place a real module is already loaded and questioned.

const FORMAT_FIXTURES = {
  md: '# Fixture\n\nA paragraph.\n',
  markdown: '# Fixture\n',
  mdown: '# Fixture\n',
  mdc: '---\ndescription: Fixture\n---\n\n# Fixture\n\nA paragraph.\n',
  html: '<html><head><title>Fixture</title></head><body><p>A paragraph.</p></body></html>\n',
  htm: '<html><body><p>A paragraph.</p></body></html>\n',
  xml: '<?xml version="1.0" encoding="UTF-8"?>\n<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>Fixture</title></titleStmt></fileDesc></teiHeader><text><body><p>A paragraph.</p></body></text></TEI>\n',
  json: '{"title":"Fixture","note":"A paragraph."}\n',
  yaml: 'title: Fixture\nnote: A paragraph.\n',
  yml: 'title: Fixture\nnote: A paragraph.\n',
  eml: 'From: someone@example.com\nSubject: Fixture\n\nA paragraph.\n',
  mht: 'From: <Saved by Leaftext>\nContent-Type: text/html\n\n<html><body><p>A paragraph.</p></body></html>\n',
  mhtml: 'From: <Saved by Leaftext>\nContent-Type: text/html\n\n<html><body><p>A paragraph.</p></body></html>\n',
  txt: 'Fixture\n\n    A paragraph, indented as it was typed.\n',
  ini: '; Fixture\n[section]\nnote = A paragraph.\n',
  ts: 'export const note: string = "A paragraph.";\n',
  tsx: 'export const Note = (): JSX.Element => <p>A paragraph.</p>;\n',
  js: 'export const note = "A paragraph.";\n',
  jsx: 'export const Note = () => <p>A paragraph.</p>;\n',
  jsonc: '{\n  // A paragraph.\n  "title": "Fixture"\n}\n',
  css: '.fixture {\n  color: green;\n}\n',
  scss: '$ink: green;\n\n.fixture {\n  color: $ink;\n}\n',
  sh: '#!/bin/sh\necho "A paragraph."\n',
  bash: '#!/usr/bin/env bash\nnote="A paragraph."\necho "$note"\n',
  zsh: '#!/usr/bin/env zsh\nprint -- "A paragraph."\n',
  toml: '[fixture]\nnote = "A paragraph."\n',
  rs: 'fn main() {\n    println!("A paragraph.");\n}\n',
  py: 'def note() -> str:\n    return "A paragraph."\n',
  sql: 'select note from fixture where id = 1;\n',
  diff: '--- a/fixture\n+++ b/fixture\n@@ -1 +1 @@\n-A sentence.\n+A paragraph.\n',
  patch: '--- a/fixture\n+++ b/fixture\n@@ -1 +1 @@\n-A sentence.\n+A paragraph.\n',
  env: '# Fixture\nNOTE=A paragraph.\n',
  graphql: 'type Fixture {\n  note: String!\n}\n',
  gql: 'query Fixture {\n  note\n}\n',
};

// The six packaged formats are a zip rather than a string, so their fixtures are built rather than typed. A stored archive is the whole of what the reader needs — no deflate, one member per name — and building one here keeps the check honest about what a page is handed: a `.docx` reaches the module as bytes or not at all.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** A zip of `members` ({ name: text }), every one stored rather than deflated. */
function storedArchive(members) {
  const bytesOf = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(members)) {
    const nameBytes = bytesOf.encode(name);
    const body = bytesOf.encode(text);
    const sum = crc32(body);
    const local = new Uint8Array(30 + nameBytes.length + body.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(14, sum, true);
    view.setUint32(18, body.length, true);
    view.setUint32(22, body.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(body, 30 + nameBytes.length);
    locals.push(local);

    const entry = new Uint8Array(46 + nameBytes.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true);
    entryView.setUint16(6, 20, true);
    entryView.setUint32(16, sum, true);
    entryView.setUint32(20, body.length, true);
    entryView.setUint32(24, body.length, true);
    entryView.setUint16(28, nameBytes.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);
    offset += local.length;
  }
  const directory = central.reduce((n, entry) => n + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, directory, true);
  endView.setUint32(16, offset, true);
  const parts = [...locals, ...central, end];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>\n';
const odfContent = (body) => '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body>' + body + '</office:body></office:document-content>\n';

const PACKAGE_FIXTURES = {
  docx: storedArchive({
    '[Content_Types].xml': CONTENT_TYPES,
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Fixture</w:t></w:r></w:p><w:p><w:r><w:t>A paragraph.</w:t></w:r></w:p></w:body></w:document>\n',
  }),
  xlsx: storedArchive({
    '[Content_Types].xml': CONTENT_TYPES,
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fixture" sheetId="1" r:id="rId1"/></sheets></workbook>\n',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>\n',
    'xl/sharedStrings.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" uniqueCount="2"><si><t>Note</t></si><si><t>A paragraph.</t></si></sst>\n',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>\n',
  }),
  pptx: storedArchive({
    '[Content_Types].xml': CONTENT_TYPES,
    'ppt/presentation.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>\n',
    'ppt/_rels/presentation.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>\n',
    'ppt/slides/slide1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Fixture</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>A paragraph.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>\n',
  }),
  odt: storedArchive({
    mimetype: 'application/vnd.oasis.opendocument.text',
    'content.xml': odfContent('<office:text><text:h text:outline-level="1">Fixture</text:h><text:p>A paragraph.</text:p></office:text>'),
  }),
  ods: storedArchive({
    mimetype: 'application/vnd.oasis.opendocument.spreadsheet',
    'content.xml': odfContent('<office:spreadsheet><table:table table:name="Fixture"><table:table-row><table:table-cell><text:p>Note</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>A paragraph.</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>'),
  }),
  odp: storedArchive({
    mimetype: 'application/vnd.oasis.opendocument.presentation',
    'content.xml': odfContent('<office:presentation><draw:page draw:name="Fixture"><draw:frame><draw:text-box><text:h text:outline-level="1">Fixture</text:h><text:p>A paragraph.</text:p></draw:text-box></draw:frame></draw:page></office:presentation>'),
  }),
};

const coreModule = await instantiateCore(core.file);
for (const extension of coreModule.formats()) {
  const packaged = PACKAGE_FIXTURES[extension];
  const fixture_ = packaged ?? FORMAT_FIXTURES[extension];
  if (fixture_ === undefined) {
    problems.push(`the core reads .${extension} and nothing here renders one — add a fixture beside the others`);
    continue;
  }
  // A packaged format has no string to hand across, so it goes through the byte entry a page draws one with.
  const drawn = packaged
    ? coreModule.renderBytes(packaged, `fixture.${extension}`)
    : coreModule.render(fixture_, `fixture.${extension}`);
  if (!drawn?.html?.trim()) {
    problems.push(`a .${extension} document came back with nothing drawn`);
    continue;
  }
  const strips = drawn.html.match(/<nav class="docs-pager/g) || [];
  if (strips.length !== 1) {
    problems.push(`a .${extension} document carries ${strips.length} Previous/Next strips, and a page can only fill one`);
  } else if (!drawn.html.includes('docs-pager-loading')) {
    problems.push(`a .${extension} document's Previous/Next strip is not the waiting one, so the page has nothing to fill`);
  }
}
// The fence the page colors itself: the language stays on the code element and no token span is in it.
const fencedPlain = await render(core.file, '```rust\nfn main() {}\n```\n');
if (!fencedPlain.html.includes('class="language-rust"')) {
  problems.push('the core dropped the language off a fence, so the page cannot color it');
}

// Same syntax dumps, different regex engine — the desktop's is a C library with no browser build. The markup both have to produce is pinned in one file, and the desktop's half of this is a test beside the fixtures.
const fence = JSON.parse(readFileSync(join(root, 'web', 'fence.json'), 'utf8'));
const fenced = await render(highlight.file, fence.markdown);
if (!fenced.html.includes(fence.code_html)) {
  problems.push('the browser module colors a fence differently from the desktop — see web/fence.json');
  problems.push(`  it rendered: ${fenced.html.slice(0, 400)}`);
}

// The two carrying the front end, where a document is not the question: what they serve is the app's own page, that front end and the boot state the page reads before anything is open. Those exports exist only behind the shell feature, so the two modules above cannot be asked for them — and both of these are asked, because an embed and a site are served by different builds and only one of them used to be looked at.
for (const [name, module] of [
  ['embed', embed],
  ['whole app', app],
]) {
  const shell = await instantiateCore(module.file);

  const boot = shell.boot();
  for (const line of ['window.__leafInitialState', 'window.__leafSettings', 'window.__leafDocumentExts']) {
    if (!boot?.includes(line)) problems.push(`${name}: the boot state does not set ${line}`);
  }

  const page = shell.page();
  if (!page?.includes('assets/app.js')) problems.push(`${name}: the page does not fetch its front end from the host that served it`);
  if (page?.includes('src="leaf-asset') || page?.includes('href="leaf-asset')) problems.push(`${name}: the page carries the desktop's own asset scheme, which no browser can fetch`);

  // The front end is a join of ordered fragments, and the last one ends with the call that boots the page — so a truncated or reordered join shows up here rather than as a blank window.
  const script = shell.script();
  if (!script?.includes('window.ipc')) problems.push(`${name}: the front end does not reach the web view, so the first fragment is missing`);
  if (!/\)\s*;\s*$/.test(script?.trimEnd() ?? '')) problems.push(`${name}: the front end does not end with the call that boots the page`);

  const documentScript = shell.documentScript(fixture, 'notes.md');
  if (!documentScript?.includes('window.leafSetState')) problems.push(`${name}: an opened document does not reach the page as the state call it reads`);
  if (!documentScript?.includes('Hello')) problems.push(`${name}: the document reached the page without its own title`);
}

// ---- the document buffer an edit splices into -------------------------------
//
// The arithmetic under it is the library's `EditableDocument`, shared with the desktop, so what could quietly differ is the dispatch on top: which call an edit reaches, with which offsets, in what order. `web/buffer.json` pins the text after every kind of edit and the desktop's half is a test beside the fixtures; this walks the same file through the built module.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The block the fixture names, found by something its source holds. Sliced as **bytes**, because a block range is a byte offset and this document has an emoji in it — a JavaScript slice of the same numbers would land somewhere else entirely. */
function blockHolding(text, blocks, marker) {
  const bytes = encoder.encode(text);
  const found = blocks.find((span) => decoder.decode(bytes.subarray(span.start, span.end)).includes(marker));
  if (!found) throw new Error(`no block in the buffer holds ${JSON.stringify(marker)}`);
  return found;
}

/** One pinned step as the edit the module takes. */
function pinnedEdit(step, text, blocks) {
  switch (step.kind) {
    case 'splice': {
      // A JavaScript string index already counts UTF-16 units, which is what the splice is given in.
      const at = text.indexOf(step.after);
      if (at === -1) throw new Error(`the buffer does not hold ${JSON.stringify(step.after)}`);
      return { edit: 'splice', start: at + step.after.length, removed: step.removed, inserted: step.inserted };
    }
    case 'task':
      return { edit: 'task', index: step.index };
    case 'block': {
      const span = blockHolding(text, blocks, step.block);
      // A step marked `continuing` is a splice of a typing run after its first, which records no undo point of its own — so one press takes the whole run back however many times it paused.
      return { edit: 'block', start: span.start, end: span.end, text: step.text_in, undo: !step.continuing };
    }
    case 'blocks':
      return {
        edit: 'blocks',
        blocks: step.blocks.map((block) => {
          const span = blockHolding(text, blocks, block.block);
          return { start: span.start, end: span.end, text: block.text_in };
        }),
      };
    // A workbook's cell is named by its own element rather than by a block, and its offsets are counted in bytes the way every block range is.
    case 'sheet_cell': {
      const at = text.indexOf(step.element);
      if (at === -1) throw new Error(`the buffer does not hold ${JSON.stringify(step.element)}`);
      const start = encoder.encode(text.slice(0, at)).length;
      return { edit: 'block', start, end: start + encoder.encode(step.element).length, text: step.text_in };
    }
    case 'cell': {
      const span = blockHolding(text, blocks, step.block);
      return {
        edit: 'block',
        start: span.start,
        end: span.end,
        text: step.text_in,
        cell: { row: step.row, column: step.column, columns: step.columns, text: step.cell_text },
      };
    }
    case 'move':
      return {
        edit: 'move',
        ranges: step.blocks.map((marker) => {
          const span = blockHolding(text, blocks, marker);
          return [span.start, span.end];
        }),
        from: step.from,
        to: step.to,
      };
    case 'field': {
      const edit = { edit: 'field', key: step.key };
      if (step.set !== undefined) edit.set = step.set;
      else if (step.items !== undefined) edit.items = step.items;
      else if (step.rename !== undefined) edit.rename = step.rename;
      else edit.remove = true;
      return edit;
    }
    case 'undo':
      return { edit: 'undo' };
    case 'redo':
      return { edit: 'redo' };
    default:
      return { edit: 'unknown' };
  }
}

const pinned = JSON.parse(readFileSync(join(root, 'web', 'buffer.json'), 'utf8'));
const buffers = await instantiateCore(embed.file);
// Every pinned document on a buffer of its own, in order. A note takes every kind of edit; a workbook takes the one that is only ever its own, because its cell words are in the shared string table rather than in the member the buffer holds.
for (const document of pinned.documents.slice(1)) {
  const other = buffers.buffer.open(document.source, document.path);
  if (!other) {
    problems.push(`the embed module refused to open a buffer over ${document.path}`);
    continue;
  }
  for (const [at, step] of document.steps.entries()) {
    const before = buffers.buffer.source(other);
    const answer = buffers.buffer.edit(other, pinnedEdit(step, before, buffers.buffer.render(other).blocks));
    if (!answer) {
      problems.push(`${document.path} step ${at} (${step.what}) came back with nothing at all`);
      continue;
    }
    if (answer.changed !== step.changed) {
      problems.push(`${document.path} step ${at} (${step.what}) says changed: ${answer.changed} and web/buffer.json pins ${step.changed}`);
    }
    const now = buffers.buffer.source(other);
    if (now !== step.text) {
      problems.push(`${document.path} step ${at} (${step.what}) left the module's buffer holding ${JSON.stringify(now)}, and the desktop's holds ${JSON.stringify(step.text)}`);
    }
  }
  buffers.buffer.close(other);
}

const note = pinned.documents[0];
const held = buffers.buffer.open(note.source, note.path);
if (!held) {
  problems.push(`the embed module refused to open a buffer over ${note.path}`);
} else {
  for (const [at, step] of note.steps.entries()) {
    const before = buffers.buffer.source(held);
    const answer = buffers.buffer.edit(held, pinnedEdit(step, before, buffers.buffer.render(held).blocks));
    if (!answer) {
      problems.push(`buffer step ${at} (${step.what}) came back with nothing at all`);
      continue;
    }
    if (answer.changed !== step.changed) {
      problems.push(`buffer step ${at} (${step.what}) says changed: ${answer.changed} and web/buffer.json pins ${step.changed}`);
    }
    const now = buffers.buffer.source(held);
    if (now !== step.text) {
      problems.push(`buffer step ${at} (${step.what}) left the module's buffer holding ${JSON.stringify(now)}, and the desktop's holds ${JSON.stringify(step.text)}`);
    }
    // The page proves the two copies still agree off this number after every splice, so a wrong one is a resync loop rather than a wrong document.
    if (answer.utf16Len !== now.length) {
      problems.push(`buffer step ${at} (${step.what}) reported ${answer.utf16Len} UTF-16 units for a buffer measuring ${now.length}`);
    }
  }

  const edited = buffers.buffer.state(held);
  if (!edited.dirty || !edited.canUndo) problems.push(`a buffer with edits in it reports dirty: ${edited.dirty}, canUndo: ${edited.canUndo}`);

  // A render off the live buffer, not off the file it was opened from: this is what the page redraws after an edit.
  const redrawn = buffers.buffer.render(held);
  if (!redrawn?.html.includes('The last line.')) problems.push('a render off the buffer does not carry the edit that was made to it');

  // The two lines the page is sent, both built here rather than in a host's own JavaScript, so the shape the page reads has one copy. Never one without the other: a redrawn document under a stale Save button reads as unsaved work that is not there.
  const document_ = buffers.buffer.documentScript(held);
  for (const call of ['window.leafSetState', 'window.leafBlocksResynced']) {
    if (!document_?.includes(call)) problems.push(`the buffer's own document line does not call ${call}`);
  }
  if (!document_?.includes('The last line.')) problems.push("the buffer's own document line carries a document without the edit in it");

  const failed = buffers.buffer.saveScript(held, false, 'the server said no');
  if (!failed?.includes('window.leafSaved') || !failed.includes('the server said no')) {
    problems.push(`a refused save tells the page ${JSON.stringify(failed)}`);
  }
  if (!buffers.buffer.state(held).dirty) problems.push('a refused save marked the buffer clean, so the reader would think it was written');
  const wrote = buffers.buffer.saveScript(held, true, '');
  if (!wrote?.includes('true')) problems.push(`a save that went through tells the page ${JSON.stringify(wrote)}`);
  const clean = buffers.buffer.state(held);
  if (clean.dirty || clean.canUndo) problems.push(`a saved buffer still reports dirty: ${clean.dirty}, canUndo: ${clean.canUndo}`);

  buffers.buffer.close(held);
  if (buffers.buffer.source(held) !== null) problems.push('a closed buffer still answers, so nothing was freed');
}

// The one boot line that decides whether the front end draws the bar, the tab strip, the pane and the theme switch at all. Told on boot rather than taken down later, so a page that is not an embed has to say so as plainly as one that is.
if (!buffers.embedBoot(true)?.includes('window.__leafEmbedded = true')) problems.push('the embed boot state never tells the page it is embedded');
if (!buffers.embedBoot(true)?.includes('"readingUnlocked":true')) problems.push('an embedded editor boots locked, with no padlock drawn to unlock it');
if (!buffers.embedBoot(false)?.includes('"readingUnlocked":false')) problems.push('an embedded reader boots unlocked, so a reader could type into a document the product only meant to show');
if (!buffers.boot()?.includes('window.__leafEmbedded = false')) problems.push('a published site does not say it is not an embed, so the flag reads as absent rather than false');

// A document arrives as bytes and goes back as bytes, spelled the way it came: the mark the read took off is put back on, and a caller holding a file cannot re-spell somebody's document by saving it.
const marked = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('# Marked\n')]);
const markedHandle = buffers.buffer.open(marked, 'marked.md');
if (!markedHandle) {
  problems.push('the embed module refused a document that opens with a byte order mark');
} else {
  if (buffers.buffer.source(markedHandle) !== '# Marked\n') {
    problems.push('the mark reached the text instead of being remembered as a fact about the file');
  }
  const back = buffers.buffer.encoded(markedHandle);
  if (!back || back.length !== marked.length || back.some((byte, at) => byte !== marked[at])) {
    problems.push('a marked document did not come back out spelled the way it went in');
  }
  buffers.buffer.close(markedHandle);
}

// A reader working through documents all afternoon opens and closes a buffer every time, and a slot that was not taken again is a page that grows until it stops.
const first = buffers.buffer.open(note.source, note.path);
buffers.buffer.close(first);
const settledMemory = buffers.memoryBytes();
for (let round = 0; round < 60; round += 1) {
  const one = buffers.buffer.open(note.source, note.path);
  if (one !== first) problems.push(`a closed buffer's slot was not taken again — round ${round} came back with handle ${one} rather than ${first}`);
  buffers.buffer.edit(one, { edit: 'field', key: 'title', set: `round ${round}` });
  buffers.buffer.close(one);
}
if (buffers.memoryBytes() !== settledMemory) {
  problems.push(`60 documents opened and closed grew the module's memory from ${kb(settledMemory)} to ${kb(buffers.memoryBytes())}`);
}

if (problems.length) {
  console.error('the browser modules do not do what they are for:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log('');
console.log(`core       ${kb(core.raw)} raw, ${kb(core.gzip)} gzip, ${kb(core.brotli)} brotli`);
console.log(`+colors    ${kb(highlight.raw)} raw, ${kb(highlight.gzip)} gzip, ${kb(highlight.brotli)} brotli`);
console.log(`embed      ${kb(embed.raw)} raw, ${kb(embed.gzip)} gzip, ${kb(embed.brotli)} brotli`);
console.log(`whole app  ${kb(app.raw)} raw, ${kb(app.gzip)} gzip, ${kb(app.brotli)} brotli`);
console.log(`all four in ${out}`);

if (core.brotli > CORE_CEILING_BROTLI) {
  console.error('');
  console.error(`The core module is ${kb(core.brotli)} compressed, over its ${kb(CORE_CEILING_BROTLI)} ceiling.`);
  console.error('A page pays this before it can draw anything. Either something heavy joined the core, or the highlighter has crept back into it.');
  process.exit(1);
}
