#!/usr/bin/env node
// Serve and drive the embed sample in one foreground run.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenLocally, staticServer } from './serve-static.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = join(root, 'web', 'dist', 'leaftext-embed.wasm');
if (!existsSync(modulePath)) {
  console.error('the embed module is not built yet — run: just build-web');
  process.exit(1);
}

const server = staticServer(root);
const port = 8500 + (process.pid % 400);
const listened = await listenLocally(server, port, { quiet: true });
if (!listened.address) {
  console.error(listened.message);
  process.exit(1);
}

const url = `${listened.address}/web/embed/sample.html`;
const steps = process.argv.slice(2);
const child = spawn(process.execPath, [join(root, 'scripts', 'drive-web.mjs'), url, ...steps], {
  cwd: root,
  stdio: 'inherit',
});
const code = await new Promise((done) => child.once('exit', (value) => done(value ?? 1)));
await new Promise((done) => server.close(done));
process.exit(code);
