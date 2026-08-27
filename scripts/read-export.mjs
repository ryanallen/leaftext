#!/usr/bin/env node
// Open a PDF the app wrote and say whether it printed drawings or waiting frames. A diagram the page had not drawn goes onto the paper as its own source text painted through a fill with zero alpha — invisible to a reader, present to a machine — and nothing else on the page paints that way. So the file is read off its own ink: every line of text shown under a zero-alpha graphics state is a frame, and a file with none printed what was drawn.
//
//   node scripts/read-export.mjs <file.pdf>   count the hidden lines sheet by sheet; exit 1 where there is one (`just read-export`)
//   node scripts/read-export.mjs --check      prove the reader on two files it writes itself (`just verify`)
//
// Four passes reached a green gate on a broken export because every check read the page and none read the file. This is the half that reads the file, and a phase about exporting is ticked against it and against nothing else.

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

// The file as one Latin-1 string, so every byte is one character and an offset in the text is an offset in the file.
function objectsOf(bytes) {
  const text = bytes.toString('latin1');
  const objects = new Map();
  const pattern = /(\d+) \d+ obj\s*([\s\S]*?)\bendobj/g;
  let match;
  while ((match = pattern.exec(text))) {
    const number = Number(match[1]);
    const body = match[2];
    const at = body.search(/stream\r?\n/);
    if (at < 0) {
      objects.set(number, { dict: body, stream: null });
      continue;
    }
    const dict = body.slice(0, at);
    const start = at + body.slice(at).match(/stream\r?\n/)[0].length;
    const end = body.lastIndexOf('endstream');
    let raw = Buffer.from(body.slice(start, end).replace(/\r?\n$/, ''), 'latin1');
    if (/\/FlateDecode/.test(dict)) {
      try {
        raw = inflateSync(raw);
      } catch {
        raw = Buffer.alloc(0);
      }
    }
    objects.set(number, { dict, stream: raw });
  }
  // A compressed object stream holds whole dictionaries of its own, and the graphics states are often in one.
  for (const [, object] of [...objects]) {
    if (!object.stream || !/\/Type\s*\/ObjStm/.test(object.dict)) continue;
    const first = Number((object.dict.match(/\/First\s+(\d+)/) || [])[1]);
    const count = Number((object.dict.match(/\/N\s+(\d+)/) || [])[1]);
    if (!first || !count) continue;
    const inner = object.stream.toString('latin1');
    const offsets = inner.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i += 1) {
      const number = offsets[2 * i];
      const from = first + offsets[2 * i + 1];
      const to = i + 1 < count ? first + offsets[2 * i + 3] : inner.length;
      if (!objects.has(number)) objects.set(number, { dict: inner.slice(from, to), stream: null });
    }
  }
  return objects;
}

// `<< ... >>` after `key`, balanced, or the object it points at.
function dictAfter(text, key, objects) {
  const at = text.search(new RegExp(`${key}\\s*`));
  if (at < 0) return '';
  const rest = text.slice(at + key.length);
  const ref = rest.match(/^\s*(\d+)\s+\d+\s+R/);
  if (ref) return (objects.get(Number(ref[1])) || {}).dict || '';
  const open = rest.indexOf('<<');
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < rest.length - 1; i += 1) {
    if (rest[i] === '<' && rest[i + 1] === '<') {
      depth += 1;
      i += 1;
    } else if (rest[i] === '>' && rest[i + 1] === '>') {
      depth -= 1;
      i += 1;
      if (depth === 0) return rest.slice(open, i + 1);
    }
  }
  return '';
}

// The graphics states whose fill alpha is zero: `/ca 0`, spelled with or without a fraction.
function hiddenStates(objects) {
  const hidden = new Set();
  for (const [number, object] of objects) {
    if (/\/Type\s*\/ExtGState/.test(object.dict) || /\/ca\s+/.test(object.dict)) {
      if (/\/ca\s+0(?:\.0+)?(?![\d.])/.test(object.dict)) hidden.add(number);
    }
  }
  return hidden;
}

// How many characters a text operand shows: a hex string of two-byte glyph ids, or a literal string.
function charactersShown(operand) {
  let count = 0;
  const hex = operand.match(/<([0-9A-Fa-f\s]*)>/g) || [];
  for (const run of hex) count += Math.ceil(run.replace(/[<>\s]/g, '').length / 4);
  const literal = operand.match(/\((?:\\.|[^\\)])*\)/g) || [];
  for (const run of literal) count += run.length - 2;
  return count;
}

// Walk one content stream: `gs` picks a state, `q` and `Q` save and restore it, and a text object (`BT` to `ET`) showing anything under a hidden state is one hidden line — the web view writes one text object per line and one show op per kerning pair, so the pairs are joined here rather than counted.
function hiddenLinesIn(content, hiddenNames) {
  const lines = [];
  const stack = [];
  let hidden = false;
  let pending = '';
  let glyphs = 0;
  const tokens = content.match(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|\[[^\]]*\]|\/[^\s/\[\]<>()]+|[^\s\[\]<>()/]+/g) || [];
  for (const token of tokens) {
    if (token === 'q') {
      stack.push(hidden);
    } else if (token === 'Q') {
      hidden = stack.length ? stack.pop() : false;
    } else if (token === 'gs') {
      hidden = hiddenNames.has(pending);
    } else if (token === 'BT') {
      glyphs = 0;
    } else if (token === 'ET') {
      if (glyphs) lines.push(glyphs);
      glyphs = 0;
    } else if (token === 'Tj' || token === 'TJ' || token === "'" || token === '"') {
      if (hidden) glyphs += charactersShown(pending);
    }
    pending = token;
  }
  return lines;
}

// Every sheet in the file, with its size in points and the hidden lines on it.
export function readExport(bytes) {
  const objects = objectsOf(bytes);
  const hidden = hiddenStates(objects);
  const sheets = [];
  for (const [, object] of objects) {
    if (!/\/Type\s*\/Page(?![s])/.test(object.dict)) continue;
    const box = (object.dict.match(/\/MediaBox\s*\[([^\]]*)\]/) || ['', ''])[1].trim().split(/\s+/).map(Number);
    const resources = dictAfter(object.dict, '/Resources', objects);
    const states = dictAfter(resources, '/ExtGState', objects);
    const names = new Set();
    for (const [, name, number] of states.matchAll(/\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g)) {
      if (hidden.has(Number(number))) names.add('/' + name);
    }
    const contents = object.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/);
    const refs = contents ? [...contents[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1])) : [];
    let lines = [];
    for (const ref of refs) {
      const stream = objects.get(ref);
      if (stream && stream.stream) lines = lines.concat(hiddenLinesIn(stream.stream.toString('latin1'), names));
    }
    sheets.push({
      width: box.length === 4 ? box[2] - box[0] : 0,
      height: box.length === 4 ? box[3] - box[1] : 0,
      hiddenLines: lines.length,
      hiddenGlyphs: lines.reduce((sum, n) => sum + n, 0),
    });
  }
  return sheets;
}

// A one-sheet PDF showing one line of text through the graphics state given, uncompressed, with a true cross-reference table so any reader opens it.
function smallPdf(state) {
  const parts = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> /ExtGState << /G0 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /ExtGState ${state} >>`,
  ];
  const content = 'q /G0 gs BT /F1 12 Tf 10 40 Td (graph TD) Tj ET Q';
  parts.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let out = '%PDF-1.4\n';
  const offsets = [];
  parts.forEach((part, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${part}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${parts.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${parts.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function selfCheck() {
  const cases = [
    ['a line shown through a zero-alpha fill is a waiting frame', '/ca 0 /CA 0', 1, 8],
    ['a line shown through ordinary ink is drawn', '/ca 1 /CA 1', 0, 0],
    ['a fill alpha written as a fraction of zero is still hidden', '/ca 0.0', 1, 8],
  ];
  const failures = [];
  cases.forEach(([name, state, runs, characters], i) => {
    const file = join(tmpdir(), `leaftext-read-export-${process.pid}-${i}.pdf`);
    writeFileSync(file, smallPdf(state));
    try {
      const [sheet] = readExport(readFileSync(file));
      if (!sheet) failures.push(`${name}: no sheet was found`);
      else if (sheet.hiddenLines !== runs || sheet.hiddenGlyphs !== characters) {
        failures.push(`${name}: ${sheet.hiddenLines} hidden lines holding ${sheet.hiddenGlyphs} glyphs, wanted ${runs} holding ${characters}`);
      }
    } finally {
      unlinkSync(file);
    }
  });
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(`read-export: ${cases.length} files written, read back and thrown away — hidden ink is counted, ordinary ink is not`);
}

function main() {
  const [arg] = process.argv.slice(2);
  if (arg === '--check') return selfCheck();
  if (!arg) {
    console.error('usage: node scripts/read-export.mjs <file.pdf>   |   node scripts/read-export.mjs --check');
    process.exit(2);
  }
  const sheets = readExport(readFileSync(arg));
  if (!sheets.length) {
    console.error(`${arg}: no sheet found — not a PDF this reader can open`);
    process.exit(2);
  }
  let hidden = 0;
  sheets.forEach((sheet, i) => {
    hidden += sheet.hiddenLines;
    console.log(`sheet ${i + 1}: ${Math.round(sheet.width)} by ${Math.round(sheet.height)} points, ${sheet.hiddenLines} hidden lines holding ${sheet.hiddenGlyphs} glyphs`);
  });
  if (hidden) {
    console.error(`${arg}: ${hidden} lines of invisible ink — a diagram was printed as a waiting frame`);
    process.exit(1);
  }
  console.log(`${arg}: no invisible ink — every diagram on the paper was drawn`);
}

main();
