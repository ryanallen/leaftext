import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grid, join as compose, readPng, writePng } from './compose-shots.mjs';

const root = mkdtempSync(join(tmpdir(), 'leaftext-compose-shots-'));

function image(width, height, color) {
  const rows = Buffer.alloc(width * height * 4);
  for (let at = 0; at < rows.length; at += 4) rows.set([...color, 255], at);
  return { width, height, rows };
}

function pixel(image, x, y) {
  return [...image.rows.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4)];
}

function expect(value, expected, label) {
  if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error(`${label}: expected ${expected}, got ${value}`);
}

try {
  const red = image(4, 4, [255, 0, 0]);
  const blue = image(4, 4, [0, 0, 255]);
  const vertical = compose(red, blue, 'vertical');
  expect([vertical.width, vertical.height], [4, 4], 'vertical size');
  expect(pixel(vertical, 1, 2), [255, 0, 0, 255], 'vertical left');
  expect(pixel(vertical, 2, 2), [0, 0, 255, 255], 'vertical right');
  const diagonal = compose(red, blue, 'diagonal');
  expect(pixel(diagonal, 0, 0), [255, 0, 0, 255], 'diagonal top left');
  expect(pixel(diagonal, 3, 3), [0, 0, 255, 255], 'diagonal bottom right');
  expect(pixel(diagonal, 0, 3), [255, 0, 0, 255], 'diagonal bottom left');
  const tiled = grid([red, blue, blue], 2);
  expect([tiled.width, tiled.height], [8, 8], 'grid size');
  expect(pixel(tiled, 5, 1), [0, 0, 255, 255], 'grid second column');
  expect(pixel(tiled, 1, 5), [0, 0, 255, 255], 'grid second row');
  const roundTrip = join(root, 'round-trip.png');
  writePng(roundTrip, diagonal);
  expect(readPng(roundTrip), diagonal, 'PNG round trip');
  if (!readFileSync(roundTrip).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('output is not PNG');
  console.log('compose-shots: vertical, diagonal, grid, and PNG output pass');
} finally {
  rmSync(root, { recursive: true, force: true });
}
