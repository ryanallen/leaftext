#!/usr/bin/env node
// Turn Gutenberg's RDF tar stream into a small, checked table of download counts.

import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const BLOCK = 512;
const MAX_ENTRY = 8 * 1024 * 1024;
const MAX_BOOKS = 200_000;

function countIn(xml) {
  const id = /<pgterms:ebook\b[^>]*\brdf:about="(?:[^" ]*\/)?ebooks\/(\d+)"/.exec(xml);
  const count = /<pgterms:downloads\b[^>]*>\s*(\d+)\s*<\/pgterms:downloads>/.exec(xml);
  if (!id || !count) return null;
  const book = Number(id[1]);
  const downloads = Number(count[1]);
  if (!Number.isSafeInteger(book) || book > 0xffffffff || !Number.isSafeInteger(downloads) || downloads > 0xffffffff) return null;
  return [book, downloads];
}

async function collect(stream) {
  let held = Buffer.alloc(0);
  let remaining = 0;
  let padding = 0;
  let entry = [];
  let entryBytes = 0;
  let isRdf = false;
  const counts = new Map();
  for await (const chunk of stream) {
    held = Buffer.concat([held, chunk]);
    while (held.length) {
      if (padding) {
        const take = Math.min(padding, held.length);
        held = held.subarray(take);
        padding -= take;
      } else if (remaining) {
        const take = Math.min(remaining, held.length);
        if (isRdf) entry.push(held.subarray(0, take));
        held = held.subarray(take);
        remaining -= take;
        if (!remaining) {
          if (isRdf) {
            const found = countIn(Buffer.concat(entry).toString('utf8'));
            if (found) counts.set(found[0], found[1]);
            if (counts.size > MAX_BOOKS) throw new Error('Gutenberg count archive has too many books');
          }
          entry = [];
          padding = (BLOCK - entryBytes % BLOCK) % BLOCK;
        }
      } else {
        if (held.length < BLOCK) break;
        const header = held.subarray(0, BLOCK);
        held = held.subarray(BLOCK);
        if (header.every((byte) => byte === 0)) return counts;
        const name = header.toString('utf8', 0, 100).split('\0')[0];
        const rawSize = header.toString('ascii', 124, 136).split('\0')[0].trim();
        if (!/^[0-7]+$/.test(rawSize)) throw new Error('Gutenberg count archive has an invalid tar entry');
        entryBytes = parseInt(rawSize, 8);
        if (!Number.isSafeInteger(entryBytes)) throw new Error('Gutenberg count archive has an oversized tar entry');
        remaining = entryBytes;
        isRdf = name.endsWith('.rdf') && header[156] !== 53;
        if (isRdf && entryBytes > MAX_ENTRY) throw new Error('Gutenberg count archive has an oversized RDF entry');
        if (!remaining) padding = 0;
      }
    }
  }
  throw new Error('Gutenberg count archive ended before its last entry');
}

function output(counts, path, minimum = 50_000) {
  if (counts.size < minimum) throw new Error(`Gutenberg count archive has only ${counts.size} books`);
  const lines = [...counts].sort(([a], [b]) => a - b).map(([id, downloads]) => `${id},${downloads}\n`).join('');
  const scratch = `${path}.part`;
  try {
    writeFileSync(scratch, gzipSync(lines, { mtime: 0 }));
    renameSync(scratch, path);
  } finally {
    rmSync(scratch, { force: true });
  }
}

function fixture(name, xml) {
  const bytes = Buffer.from(xml);
  const header = Buffer.alloc(BLOCK);
  header.write(name);
  header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
  header[156] = 48;
  return Buffer.concat([header, bytes, Buffer.alloc((BLOCK - bytes.length % BLOCK) % BLOCK)]);
}

async function check() {
  const archive = Buffer.concat([
    fixture('1.rdf', '<pgterms:ebook rdf:about="ebooks/1"><pgterms:downloads>42</pgterms:downloads></pgterms:ebook>'),
    fixture('2.rdf', '<pgterms:ebook rdf:about="ebooks/2"></pgterms:ebook>'),
    fixture('3.rdf', '<pgterms:ebook rdf:about="ebooks/3"><pgterms:downloads>bad</pgterms:downloads></pgterms:ebook>'),
    // Gutenberg's largest entries pass a megabyte.
    fixture('4.rdf', `<pgterms:ebook rdf:about="ebooks/4">${' '.repeat(1_300_000)}<pgterms:downloads>7</pgterms:downloads></pgterms:ebook>`),
    Buffer.alloc(BLOCK * 2),
  ]);
  const counts = await collect([archive]);
  const dir = mkdtempSync(join(tmpdir(), 'gutenberg-counts-'));
  try {
    const path = join(dir, 'counts.csv.gz');
    output(counts, path, 1);
    if (gunzipSync(readFileSync(path)).toString() !== '1,42\n4,7\n') throw new Error('Gutenberg count fixture gave the wrong output');
    try { output(counts, path); throw new Error('Gutenberg count threshold did not refuse a short archive'); }
    catch (error) { if (!String(error).includes('only 2 books')) throw error; }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write('Gutenberg counts: fixture passed\n');
}

if (process.argv[2] === '--check') await check();
else if (process.argv.length === 3) output(await collect(process.stdin), process.argv[2]);
else throw new Error('Give the output path or --check');
