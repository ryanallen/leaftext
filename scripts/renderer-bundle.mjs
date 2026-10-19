// The complete renderer travels outside Git; only its verified pin is committed.
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

export const PIN_PATH = 'site-renderer.json';
export const PIN_LIMIT = 256 * 1024;
export const BUNDLE_LIMIT = 64 * 1024 * 1024;
export const DECODED_LIMIT = 256 * 1024 * 1024;
const FORMAT = 1;
const FILE_LIMIT = 4096;
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function checked(condition, message) {
  if (!condition) throw Error('Renderer bundle: ' + message);
}

function assetPath(path) {
  checked(typeof path === 'string' && path.length < 1024 && path.startsWith('assets/leaftext/'), 'invalid destination');
  checked(!/[\\:\x00-\x1f\x7f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..'), 'unsafe destination ' + path);
  return path;
}

function inventory(files) {
  checked(Array.isArray(files) && files.length > 0 && files.length <= FILE_LIMIT, 'invalid inventory count');
  const seen = new Set();
  let total = 0;
  for (const file of files) {
    assetPath(file.path);
    checked(!seen.has(file.path), 'duplicate destination');
    seen.add(file.path);
    checked(Number.isSafeInteger(file.length) && file.length >= 0 && HASH.test(file.sha256), 'invalid file metadata');
    total += file.length;
    checked(total <= DECODED_LIMIT, 'decoded files exceed limit');
  }
  return files.map(({ path, length, sha256 }) => ({ path, length, sha256 }));
}

export function readPin(bytes) {
  checked(Buffer.isBuffer(bytes) && bytes.length <= PIN_LIMIT, 'pin exceeds limit');
  const pin = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  checked(pin.format === FORMAT && /^\d+\.\d+\.\d+$/.test(pin.version) && COMMIT.test(pin.source), 'unsupported pin identity');
  checked(pin.tag === 'v' + pin.version && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(pin.repository), 'invalid release destination');
  checked(HASH.test(pin.sha256) && Number.isSafeInteger(pin.length) && pin.length > 0 && pin.length <= BUNDLE_LIMIT, 'invalid bundle metadata');
  checked(pin.asset === `renderer-${pin.source}-${pin.sha256}.json.gz`, 'asset identity mismatch');
  inventory(pin.files);
  return pin;
}

export function packRenderer(paths, read, { version, source, repository }) {
  checked(Array.isArray(paths) && paths.length > 0 && paths.length <= FILE_LIMIT, 'invalid asset count');
  const seen = new Set();
  let encoded = 0;
  const files = paths.map(path => {
    assetPath(path);
    checked(!seen.has(path), 'duplicate asset');
    seen.add(path);
    const bytes = read(path);
    checked(Buffer.isBuffer(bytes), 'asset is not bytes: ' + path);
    encoded += Math.ceil(bytes.length / 3) * 4 + 1200;
    checked(encoded <= DECODED_LIMIT, 'encoded inventory exceeds limit');
    return { path, length: bytes.length, sha256: digest(bytes), data: bytes.toString('base64') };
  });
  const json = Buffer.from(JSON.stringify({ format: FORMAT, files }));
  checked(json.length <= DECODED_LIMIT, 'decoded bundle exceeds limit');
  const bundle = gzipSync(json);
  checked(bundle.length <= BUNDLE_LIMIT, 'compressed bundle exceeds limit');
  const sha256 = digest(bundle);
  const pin = { format: FORMAT, version, source, repository, tag: 'v' + version, asset: `renderer-${source}-${sha256}.json.gz`, length: bundle.length, sha256, files: inventory(files) };
  const pinBytes = Buffer.from(JSON.stringify(pin, null, 2) + '\n');
  readPin(pinBytes);
  validateBundle(bundle, pin);
  return { bundle, pin, pinBytes };
}

export function validateBundle(bundle, pin) {
  readPin(Buffer.from(JSON.stringify(pin)));
  checked(Buffer.isBuffer(bundle) && bundle.length <= BUNDLE_LIMIT && bundle.length === pin.length && digest(bundle) === pin.sha256, 'bundle length or digest mismatch');
  const raw = gunzipSync(bundle, { maxOutputLength: DECODED_LIMIT });
  const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  checked(decoded.format === FORMAT, 'unsupported bundle format');
  const files = inventory(decoded.files);
  checked(JSON.stringify(files) === JSON.stringify(inventory(pin.files)), 'bundle inventory differs from pin');
  return decoded.files.map(file => {
    checked(typeof file.data === 'string' && file.data.length === Math.ceil(file.length / 3) * 4, 'invalid encoded length');
    const bytes = Buffer.from(file.data, 'base64');
    checked(bytes.length === file.length && bytes.toString('base64') === file.data && digest(bytes) === file.sha256, 'invalid file bytes: ' + file.path);
    return { path: file.path, bytes };
  });
}

function noLinks(path) {
  let cursor = resolve(path);
  for (;;) {
    try { checked(!fs.lstatSync(cursor).isSymbolicLink(), 'linked installation destination'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

export function installBundle(root, bundle, pin) {
  const files = validateBundle(bundle, pin);
  const parent = join(fs.realpathSync(root), 'assets');
  noLinks(parent);
  const target = join(parent, 'leaftext');
  noLinks(target);
  fs.mkdirSync(parent, { recursive: true });
  const scratch = fs.mkdtempSync(join(parent, '.renderer-'));
  const staged = join(scratch, 'leaftext');
  const backup = join(scratch, 'previous');
  let replaced = false;
  try {
    for (const { path, bytes } of files) {
      const destination = join(staged, path.slice('assets/leaftext/'.length));
      fs.mkdirSync(dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes, { flag: 'wx' });
    }
    if (fs.existsSync(target)) { fs.renameSync(target, backup); replaced = true; }
    try { fs.renameSync(staged, target); }
    catch (error) { if (replaced) fs.renameSync(backup, target); throw error; }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  return files.length;
}

export async function downloadBundle(url, { timeout = 30000, allowHttp = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const address = new URL(url);
      checked(address.protocol === 'https:' || (allowHttp && address.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(address.hostname)), 'unsafe download address');
      checked(!address.username && !address.password, 'credentialed download address');
      const response = await fetch(address, { signal: controller.signal, redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        checked(response.headers.has('location'), 'redirect has no address');
        url = new URL(response.headers.get('location'), address).href;
        continue;
      }
      checked(response.ok, 'download refused with HTTP ' + response.status);
      const declared = response.headers.get('content-length');
      checked(declared === null || (/^\d+$/.test(declared) && Number(declared) <= BUNDLE_LIMIT), 'download exceeds limit');
      const chunks = [];
      let length = 0;
      for await (const bytes of response.body) {
        length += bytes.length;
        if (length > BUNDLE_LIMIT) { controller.abort(); throw Error('Renderer bundle: download exceeds limit'); }
        chunks.push(bytes);
      }
      return Buffer.concat(chunks, length);
    }
    throw Error('Renderer bundle: too many redirects');
  } catch (error) { controller.abort(); throw error; }
  finally { clearTimeout(timer); }
}

export async function installPinned(root, options = {}) {
  const path = join(root, PIN_PATH);
  checked(fs.statSync(path).size <= PIN_LIMIT, 'pin exceeds limit');
  const pin = readPin(fs.readFileSync(path));
  const url = `https://github.com/${pin.repository}/releases/download/${pin.tag}/${pin.asset}`;
  try { return installBundle(root, await downloadBundle(url, options), pin); }
  catch (error) { throw Error(`Cannot install pinned renderer ${pin.asset}: ${error.message}`); }
}

export function selfTest() {
  const paths = ['assets/leaftext/app/leaftext.wasm', 'assets/leaftext/licenses.md'];
  const bytes = new Map(paths.map((path, i) => [path, Buffer.from([0, 255, i, 13, 10])]));
  const identity = { version: '1.2.3', source: 'a'.repeat(40), repository: 'owner/project' };
  const packed = packRenderer(paths, path => bytes.get(path), identity);
  const root = fs.mkdtempSync(join(tmpdir(), 'leaftext-renderer-test-'));
  const checkOld = () => { for (const [path, value] of bytes) assert.deepEqual(fs.readFileSync(join(root, path)), value); };
  try {
    installBundle(root, packed.bundle, packed.pin); checkOld();
    assert.throws(() => packRenderer(paths, () => undefined, identity));
    assert.notEqual(packRenderer(paths, () => Buffer.from('changed'), identity).pin.asset, packed.pin.asset);
    for (const bad of [Buffer.alloc(0), packed.bundle.subarray(0, 20), Buffer.from('corrupt')]) {
      assert.throws(() => installBundle(root, bad, packed.pin)); checkOld();
    }
    for (const change of [
      doc => { doc.format++; },
      doc => { doc.files[0].path = '../private'; },
      doc => { doc.files[0].path = '/absolute'; },
      doc => { doc.files[0].path = 'src/main.rs'; },
      doc => { doc.files.push(doc.files[0]); },
      doc => { doc.files.pop(); },
      doc => { doc.files[0].length++; },
      doc => { doc.files[0].length = DECODED_LIMIT + 1; },
      doc => { doc.files[0].data = '!'.repeat(8); },
    ]) {
      const doc = JSON.parse(gunzipSync(packed.bundle)); change(doc);
      const bad = gzipSync(JSON.stringify(doc)); const sha256 = digest(bad);
      const pin = { ...packed.pin, sha256, length: bad.length, asset: `renderer-${identity.source}-${sha256}.json.gz` };
      assert.throws(() => installBundle(root, bad, pin)); checkOld();
    }
    assert.throws(() => readPin(Buffer.alloc(PIN_LIMIT + 1)));
    assert.throws(() => validateBundle(Buffer.alloc(0), { ...packed.pin, length: BUNDLE_LIMIT + 1 }));
    assert.throws(() => packRenderer([...paths, paths[0]], path => bytes.get(path), identity));
    assert.throws(() => validateBundle(packed.bundle, { ...packed.pin, source: 'b'.repeat(40) }));
    const linked = join(root, 'linked');
    const outside = join(root, 'outside');
    fs.mkdirSync(join(linked, 'assets'), { recursive: true });
    fs.mkdirSync(outside);
    const link = join(linked, 'assets', 'leaftext');
    for (const destination of [outside, join(root, 'absent')]) {
      fs.symlinkSync(destination, link, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => installBundle(linked, packed.bundle, packed.pin), /linked installation/);
      fs.unlinkSync(link);
      assert.deepEqual(fs.readdirSync(outside), []);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('renderer-bundle: exact bytes, immutable identity, bounded validation and intact previous installation pass');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) selfTest();
  else if (process.argv.includes('--prove-built')) {
    const { PUBLISHED } = await import('./site-assets.mjs');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const version = JSON.parse(fs.readFileSync(join(root, 'assets/leaftext/version.json'), 'utf8')).version;
    const began = performance.now();
    const packed = packRenderer(PUBLISHED, path => fs.readFileSync(join(root, path)), { version, source: '0'.repeat(40), repository: 'proof/local' });
    const scratch = fs.mkdtempSync(join(tmpdir(), 'leaftext-renderer-built-'));
    try {
      installBundle(scratch, packed.bundle, packed.pin);
      for (const path of PUBLISHED) assert.deepEqual(fs.readFileSync(join(scratch, path)), fs.readFileSync(join(root, path)));
      console.log(JSON.stringify({ paths: packed.pin.files, compressed: packed.bundle.length, milliseconds: performance.now() - began }));
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  } else if (process.argv.includes('--install')) {
    console.log('Installed ' + await installPinned(process.cwd()) + ' verified renderer assets.');
  } else throw Error('Use --check, --prove-built or --install.');
}
