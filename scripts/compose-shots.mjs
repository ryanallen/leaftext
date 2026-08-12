import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(kind, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(kind, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function paeth(left, above, corner) {
  const estimate = left + above - corner;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const cornerDistance = Math.abs(estimate - corner);
  return leftDistance <= aboveDistance && leftDistance <= cornerDistance ? left : aboveDistance <= cornerDistance ? above : corner;
}

function readPng(path) {
  const png = readFileSync(path);
  if (!png.subarray(0, 8).equals(signature)) throw new Error(`${path} is not a PNG`);
  let cursor = 8;
  let width;
  let height;
  let color;
  const data = [];
  while (cursor < png.length) {
    const length = png.readUInt32BE(cursor);
    const kind = png.toString('ascii', cursor + 4, cursor + 8);
    const body = png.subarray(cursor + 8, cursor + 8 + length);
    cursor += length + 12;
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[10] !== 0 || body[11] !== 0 || body[12] !== 0) throw new Error(`${path} uses an unsupported PNG layout`);
      color = body[9];
      if (color !== 2 && color !== 6) throw new Error(`${path} must be RGB or RGBA`);
    }
    if (kind === 'IDAT') data.push(body);
    if (kind === 'IEND') break;
  }
  if (!width || !height || color === undefined) throw new Error(`${path} has no PNG header`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const packed = inflateSync(Buffer.concat(data));
  if (packed.length !== height * (stride + 1)) throw new Error(`${path} has unexpected scanlines`);
  const rows = Buffer.alloc(width * height * 4);
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = packed[source++];
    const row = packed.subarray(source, source + stride);
    source += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = y ? packed[(y - 1) * (stride + 1) + 1 + x] : 0;
      const corner = y && x >= channels ? packed[(y - 1) * (stride + 1) + 1 + x - channels] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + above) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + above) / 2)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, above, corner)) & 255;
      else if (filter !== 0) throw new Error(`${path} uses an unsupported PNG filter`);
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      rows[to] = row[from];
      rows[to + 1] = row[from + 1];
      rows[to + 2] = row[from + 2];
      rows[to + 3] = channels === 4 ? row[from + 3] : 255;
    }
  }
  return { width, height, rows };
}

function writePng(path, image) {
  const scanlines = Buffer.alloc(image.height * (image.width * 4 + 1));
  for (let y = 0; y < image.height; y++) image.rows.copy(scanlines, y * (image.width * 4 + 1) + 1, y * image.width * 4, (y + 1) * image.width * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(path, Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

function sameSize(images) {
  const first = images[0];
  if (!images.length || images.some((image) => image.width !== first.width || image.height !== first.height)) throw new Error('all source shots must have the same dimensions');
  return first;
}

function join(first, second, seam) {
  sameSize([first, second]);
  const rows = Buffer.alloc(first.rows.length);
  for (let y = 0; y < first.height; y++) {
    for (let x = 0; x < first.width; x++) {
      const useFirst = seam === 'vertical' ? x < first.width / 2 : x < first.width * (1 - y / first.height);
      const at = (y * first.width + x) * 4;
      (useFirst ? first.rows : second.rows).copy(rows, at, at, at + 4);
    }
  }
  return { width: first.width, height: first.height, rows };
}

function grid(images, columns) {
  const first = sameSize(images);
  if (!Number.isInteger(columns) || columns < 1) throw new Error('grid columns must be a positive integer');
  const rows = Math.ceil(images.length / columns);
  const out = Buffer.alloc(first.width * columns * first.height * rows * 4, 255);
  for (let index = 0; index < images.length; index++) {
    const left = (index % columns) * first.width;
    const top = Math.floor(index / columns) * first.height;
    for (let y = 0; y < first.height; y++) images[index].rows.copy(out, ((top + y) * first.width * columns + left) * 4, y * first.width * 4, (y + 1) * first.width * 4);
  }
  return { width: first.width * columns, height: first.height * rows, rows: out };
}

function usage() {
  throw new Error('usage: compose-shots.mjs <vertical|diagonal|grid> <out.png> <shots...>; grid takes its column count before the shots');
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) {
  try {
    const [mode, output, ...rest] = process.argv.slice(2);
    if (!mode || !output) usage();
    if (mode === 'vertical' || mode === 'diagonal') {
      if (rest.length !== 2) usage();
      writePng(output, join(readPng(rest[0]), readPng(rest[1]), mode));
    } else if (mode === 'grid') {
      const [columns, ...sources] = rest;
      if (!sources.length) usage();
      writePng(output, grid(sources.map(readPng), Number(columns)));
    } else usage();
  } catch (error) {
    console.error(`compose-shots: ${error.message}`);
    process.exitCode = 1;
  }
}

export { grid, join, readPng, writePng };
