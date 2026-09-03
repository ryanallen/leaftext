#!/usr/bin/env node
// One document per format the app reads, for the checks that render or count them.
//
// It lives beside `build-web.mjs` rather than inside it because that script builds four wasm modules the moment it is imported, and a check that only wants to know which spellings have a fixture must not pay for a build. So the tables are here, this file builds nothing, and both readers import them: `build-web.mjs` renders each one through the real module, and `check-web-fixtures.mjs` asks `just verify` the cheaper half of the same question with no wasm target in sight.
//
// **A spelling with no fixture here is a spelling the published site cannot be proved to draw.** `src/format.rs` is the one table of what the app reads; every spelling in it owes an entry in one of the two tables below. The macro-enabled Office spellings were added to that table and not to these, and the site stopped publishing for a day without anything saying so.

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

// The six packaged formats, nine spellings between them, are a zip rather than a string, so their fixtures are built rather than typed. A stored archive is the whole of what the reader needs — no deflate, one member per name — and building one here keeps the check honest about what a page is handed: a `.docx` reaches the module as bytes or not at all.
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

const WORD_PARTS = {
  '[Content_Types].xml': CONTENT_TYPES,
  'word/document.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Fixture</w:t></w:r></w:p><w:p><w:r><w:t>A paragraph.</w:t></w:r></w:p></w:body></w:document>\n',
};
const EXCEL_PARTS = {
  '[Content_Types].xml': CONTENT_TYPES,
  'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fixture" sheetId="1" r:id="rId1"/></sheets></workbook>\n',
  'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>\n',
  'xl/sharedStrings.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" uniqueCount="2"><si><t>Note</t></si><si><t>A paragraph.</t></si></sst>\n',
  'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>\n',
};
const SLIDES_PARTS = {
  '[Content_Types].xml': CONTENT_TYPES,
  'ppt/presentation.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>\n',
  'ppt/_rels/presentation.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>\n',
  'ppt/slides/slide1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Fixture</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>A paragraph.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>\n',
};

// The whole of what a macro spelling is, is the plain package carrying a macro part as well — so the fixture carries one rather than being the plain format under another name. Nothing opens those bytes: the reader asks for `word/document.xml` either way, which is the fact the fixture is here to prove.
const MACRO_PART = 'Not a real macro. The reader never opens this part.\n';

const PACKAGE_FIXTURES = {
  docx: storedArchive(WORD_PARTS),
  docm: storedArchive({ ...WORD_PARTS, 'word/vbaProject.bin': MACRO_PART }),
  xlsx: storedArchive(EXCEL_PARTS),
  xlsm: storedArchive({ ...EXCEL_PARTS, 'xl/vbaProject.bin': MACRO_PART }),
  pptx: storedArchive(SLIDES_PARTS),
  pptm: storedArchive({ ...SLIDES_PARTS, 'ppt/vbaProject.bin': MACRO_PART }),
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

export { FORMAT_FIXTURES, PACKAGE_FIXTURES, storedArchive };
