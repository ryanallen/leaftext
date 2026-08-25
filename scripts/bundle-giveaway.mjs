#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { SYSTEM_FILES } from './check-learn-snapshots.mjs';
import { planTree } from './plan-tree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const giveaway = join(planTree(root), 'learn', 'ticket-workflow-linkedin');
const archivePath = join(giveaway, 'ryans-product-team-template.zip');
const fixedTime = 0;
const fixedDate = 33;

function systemPaths(rows) {
  return rows.map(([path]) => path).filter((path) => path.startsWith('system/'));
}

function folderEntries(folder, rows) {
  return systemPaths(rows).map((name) => ({ name, bytes: readFileSync(join(folder, ...name.split('/'))) }));
}

function localHeader(entry, compressed, checksum, offset) {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(fixedTime, 10);
  header.writeUInt16LE(fixedDate, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(entry.bytes.length, 22);
  header.writeUInt16LE(name.length, 26);
  name.copy(header, 30);
  return { bytes: Buffer.concat([header, compressed]), name, offset, checksum, compressedSize: compressed.length };
}

function centralHeader(entry, local) {
  const header = Buffer.alloc(46 + local.name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(fixedTime, 12);
  header.writeUInt16LE(fixedDate, 14);
  header.writeUInt32LE(local.checksum, 16);
  header.writeUInt32LE(local.compressedSize, 20);
  header.writeUInt32LE(entry.bytes.length, 24);
  header.writeUInt16LE(local.name.length, 28);
  header.writeUInt32LE(local.offset, 42);
  local.name.copy(header, 46);
  return header;
}

export function writeArchive(entries) {
  const local = [];
  let offset = 0;
  for (const entry of entries) {
    const compressed = deflateRawSync(entry.bytes, { level: 9 });
    const record = localHeader(entry, compressed, crc32(entry.bytes) >>> 0, offset);
    local.push(record);
    offset += record.bytes.length;
  }
  const central = entries.map((entry, index) => centralHeader(entry, local[index]));
  const centralSize = central.reduce((total, entry) => total + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local.map((entry) => entry.bytes), ...central, end]);
}

export function readArchive(archive) {
  if (archive.length < 22 || archive.readUInt32LE(archive.length - 22) !== 0x06054b50) throw new Error('the archive has no readable ending');
  const end = archive.length - 22;
  const count = archive.readUInt16LE(end + 10);
  const centralSize = archive.readUInt32LE(end + 12);
  let cursor = archive.readUInt32LE(end + 16);
  if (cursor + centralSize !== end) throw new Error('the archive directory does not meet its ending');
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('the archive directory is broken');
    const method = archive.readUInt16LE(cursor + 10);
    const time = archive.readUInt16LE(cursor + 12);
    const date = archive.readUInt16LE(cursor + 14);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameSize = archive.readUInt16LE(cursor + 28);
    const extraSize = archive.readUInt16LE(cursor + 30);
    const commentSize = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameSize);
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`${name} has no readable entry`);
    const localNameSize = archive.readUInt16LE(localOffset + 26);
    const localExtraSize = archive.readUInt16LE(localOffset + 28);
    const dataAt = localOffset + 30 + localNameSize + localExtraSize;
    const packed = archive.subarray(dataAt, dataAt + compressedSize);
    const bytes = method === 8 ? inflateRawSync(packed) : method === 0 ? packed : null;
    if (bytes === null) throw new Error(`${name} uses compression this reader does not support`);
    if (bytes.length !== size || (crc32(bytes) >>> 0) !== checksum) throw new Error(`${name} is damaged`);
    entries.push({ name, bytes, time, date });
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  if (new Set(entries.map((entry) => entry.name)).size !== entries.length) throw new Error('the archive names one entry twice');
  return entries;
}

export function archiveProblems(rows, folder, archive) {
  let packed;
  try {
    packed = readArchive(archive);
  } catch (error) {
    return [error.message];
  }
  const wanted = new Map(folderEntries(folder, rows).map((entry) => [entry.name, entry.bytes]));
  const found = new Map(packed.map((entry) => [entry.name, entry.bytes]));
  const problems = [];
  for (const [name, bytes] of wanted) {
    if (!found.has(name)) problems.push(`${name} is missing from the archive`);
    else if (!found.get(name).equals(bytes)) problems.push(`${name} has drifted from the folder`);
  }
  for (const name of found.keys()) if (!wanted.has(name)) problems.push(`${name} is in the archive and not in the folder table`);
  return problems;
}

function selfTest() {
  const stand = mkdtempSync(join(tmpdir(), 'leaftext-giveaway-'));
  try {
    mkdirSync(join(stand, 'system'));
    writeFileSync(join(stand, 'system', 'a.txt'), 'one');
    writeFileSync(join(stand, 'system', 'b.txt'), 'two');
    const rows = [['system/a.txt'], ['system/b.txt']];
    const entries = folderEntries(stand, rows);
    const archive = writeArchive(entries);
    const faults = [];
    if (!archive.equals(writeArchive(entries))) faults.push('the same folder produced different archive bytes twice');
    const clean = archiveProblems(rows, stand, archive);
    if (clean.length) faults.push(`a round trip changed its input: ${clean[0]}`);
    const times = readArchive(archive);
    if (times.map((entry) => entry.name).join() !== systemPaths(rows).join()) faults.push('the round trip changed the entry names');
    if (times.some((entry) => entry.time !== fixedTime || entry.date !== fixedDate)) faults.push('the writer used a changing timestamp');
    const missing = archiveProblems(rows, stand, writeArchive(entries.slice(0, 1)));
    if (missing.length !== 1 || !missing[0].includes('b.txt') || !missing[0].includes('missing')) faults.push('the reader let an expected entry go missing');
    const extra = archiveProblems(rows, stand, writeArchive([...entries, { name: 'system/c.txt', bytes: Buffer.from('three') }]));
    if (extra.length !== 1 || !extra[0].includes('c.txt')) faults.push('the reader let an unlisted entry into the archive');
    const drifted = archiveProblems(rows, stand, writeArchive([{ name: 'system/a.txt', bytes: Buffer.from('changed') }, entries[1]]));
    if (drifted.length !== 1 || !drifted[0].includes('a.txt') || !drifted[0].includes('drifted')) faults.push('the reader let changed entry bytes through');
    const damaged = Buffer.from(archive);
    damaged[30 + Buffer.byteLength(entries[0].name)] ^= 1;
    if (archiveProblems(rows, stand, damaged).length !== 1) faults.push('the reader let damaged archive bytes through');
    if (faults.length) throw new Error(`the archive reading is wrong:\n  ${faults.join('\n  ')}`);
  } finally {
    rmSync(stand, { recursive: true });
  }
}

function main() {
  const entries = folderEntries(giveaway, SYSTEM_FILES);
  if (process.argv.includes('--check')) {
    selfTest();
    const problems = archiveProblems(SYSTEM_FILES, giveaway, readFileSync(archivePath));
    if (problems.length) throw new Error(`the giveaway archive has drifted:\n  ${problems.join('\n  ')}`);
    console.log(`giveaway: ${entries.length} files match the archive entry by entry`);
    return;
  }
  writeFileSync(archivePath, writeArchive(entries));
  console.log(`giveaway: wrote ${entries.length} files from the system table`);
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) {
  try {
    main();
  } catch (error) {
    console.error(`giveaway: ${error.message}`);
    process.exitCode = 1;
  }
}
