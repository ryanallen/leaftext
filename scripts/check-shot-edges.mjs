#!/usr/bin/env node
// Which documentation pictures carry a black strip nobody drew. A window screenshot sized to `GetWindowRect` spans the invisible resize border, and `PrintWindow` renders nothing into it — so the bitmap's own initialized black ships to leaftext.com as a solid column down three sides of the app.
//
//   node scripts/check-shot-edges.mjs          every picture in imgs/, worst first
//   node scripts/check-shot-edges.mjs --check  exit 1 if any has one (`just verify`)
//   node scripts/check-shot-edges.mjs <file>   one picture, before it is filed
//
// A whole edge of pure `#000000` is the signature: the app draws no pure black anywhere, so a full row or column of it is the bitmap showing through rather than anything a reader would see. Measured in whole edges, not stray pixels — a dark theme's page color is near-black, not black, and it would take a real fault to make one exactly `#000000`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imgs = join(root, 'imgs');

/** Bytes per pixel for the PNG color types the app's own encoder writes, plus the two a grayscale tool might. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decode a non-interlaced 8-bit PNG to `{ width, height, rgba }`. Enough for what this repo ships and loud about anything else, because a picture this cannot read is one it must not call clean. */
function decode(bytes) {
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8;
  let head = null;
  let palette = null;
  let alpha = null;
  const parts = [];
  while (at < bytes.length) {
    const size = bytes.readUInt32BE(at);
    const kind = bytes.toString('ascii', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + size);
    if (kind === 'IHDR') {
      head = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12],
      };
    } else if (kind === 'PLTE') palette = Buffer.from(data);
    else if (kind === 'tRNS') alpha = Buffer.from(data);
    else if (kind === 'IDAT') parts.push(Buffer.from(data));
    else if (kind === 'IEND') break;
    at += size + 12;
  }
  if (!head) throw new Error('no IHDR');
  if (head.depth !== 8) throw new Error(`${head.depth}-bit PNG; this reads 8-bit only`);
  if (head.interlace) throw new Error('interlaced PNG; this reads non-interlaced only');
  const channels = CHANNELS[head.color];
  if (!channels) throw new Error(`color type ${head.color} is not one this reads`);

  const { width, height } = head;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts));
  const flat = Buffer.alloc(stride * height);
  // Undo the per-row filter. The app's own encoder writes every row unfiltered, but a picture taken with another tool arrives filtered and would otherwise read as noise.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? flat[y * stride + x - channels] : 0;
      const up = y > 0 ? flat[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? flat[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const guess = left + up - upLeft;
        const dl = Math.abs(guess - left);
        const du = Math.abs(guess - up);
        const dul = Math.abs(guess - upLeft);
        value += dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
      }
      flat[y * stride + x] = value & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const from = i * channels;
    const to = i * 4;
    if (head.color === 3) {
      const index = flat[from];
      rgba[to] = palette[index * 3];
      rgba[to + 1] = palette[index * 3 + 1];
      rgba[to + 2] = palette[index * 3 + 2];
      rgba[to + 3] = alpha && index < alpha.length ? alpha[index] : 255;
    } else if (head.color === 0 || head.color === 4) {
      rgba[to] = rgba[to + 1] = rgba[to + 2] = flat[from];
      rgba[to + 3] = head.color === 4 ? flat[from + 1] : 255;
    } else {
      rgba[to] = flat[from];
      rgba[to + 1] = flat[from + 1];
      rgba[to + 2] = flat[from + 2];
      rgba[to + 3] = head.color === 6 ? flat[from + 3] : 255;
    }
  }
  return { width, height, rgba };
}

/** Near enough to black that nothing in the app drew it. Not exactly `#000000`: a documentation picture goes out through the palette encoder, which moves a pixel, so a photographed border lands a shade or two off. */
const INK = 12;

/** How many whole rows or columns of that black each side opens with. */
function blackEdges({ width, height, rgba }) {
  const black = (x, y) => {
    const at = (y * width + x) * 4;
    return rgba[at] <= INK && rgba[at + 1] <= INK && rgba[at + 2] <= INK && rgba[at + 3] === 255;
  };
  const column = (x) => {
    for (let y = 0; y < height; y++) if (!black(x, y)) return false;
    return true;
  };
  const row = (y) => {
    for (let x = 0; x < width; x++) if (!black(x, y)) return false;
    return true;
  };
  let left = 0;
  while (left < width && column(left)) left++;
  let right = 0;
  while (right < width - left && column(width - 1 - right)) right++;
  let top = 0;
  while (top < height && row(top)) top++;
  let bottom = 0;
  while (bottom < height - top && row(height - 1 - bottom)) bottom++;
  return { left, right, top, bottom };
}

/** The name to say a picture by: its path under the repo, or whatever was typed for one outside it. */
function short(path) {
  return path.startsWith(root) ? path.slice(root.length + 1).split('\\').join('/') : path;
}

function pictures(dir) {
  const out = [];
  for (const name of readdirSync(join(imgs, dir))) {
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(imgs, rel)).isDirectory()) out.push(...pictures(rel));
    else if (name.endsWith('.png')) out.push(rel);
  }
  return out;
}

// A file named on the command line is a retake being looked at before it is filed; with none, the whole folder.
const asked = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const looking = asked.length ? asked : pictures('').map((name) => join(imgs, name));

const found = [];
const unreadable = [];
for (const name of looking) {
  try {
    const edges = blackEdges(decode(readFileSync(name)));
    const worst = Math.max(edges.left, edges.right, edges.top, edges.bottom);
    if (worst) found.push({ name, edges, worst });
  } catch (error) {
    unreadable.push(`${name}: ${error.message}`);
  }
}
found.sort((a, b) => b.worst - a.worst);

for (const { name, edges } of found) {
  const sides = ['left', 'right', 'top', 'bottom'].filter((side) => edges[side]);
  console.log(`  ${short(name)}  ${sides.map((side) => `${side} ${edges[side]}px`).join(', ')}`);
}
for (const problem of unreadable) console.log(`  ${problem}`);
console.log(`${found.length} of the ${looking.length} pictures read carry a black edge nobody drew`);

if (process.argv.includes('--check') && (found.length || unreadable.length)) {
  console.error('a black edge is the invisible resize border, photographed: scripts/capture-screenshot.ps1 takes the visible frame, so retake the picture.');
  process.exit(1);
}
