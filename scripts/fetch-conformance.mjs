#!/usr/bin/env node
// The published conformance suites for the formats this app reads, downloaded
// into target/conformance/ where the tests look for them.
//
//   just conformance          fetch anything missing or out of date
//   just conformance --force  fetch it all again
//
// Fetched, not vendored: 15 MB of third-party corpora under several licenses, in
// a repository that also serves a website. `just verify` never runs this and
// stays offline — every conformance test prints one line and returns when the
// corpus is not there.
//
// SOURCES below is the one answer to "which version of each suite do we test
// against". Nothing polls upstream; a pin moves only when somebody edits it, and
// the run after the edit names every case the new version added or changed,
// because an unlisted failure fails the run.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- the pins ---------------------------------------------------------------

const SOURCES = [
  {
    id: 'commonmark',
    label: 'CommonMark 0.31.2',
    kind: 'file',
    url: 'https://spec.commonmark.org/0.31.2/spec.json',
    file: 'spec.json',
    sha256: 'd431b29d97b6f73e69d547109cf5081578fac931e72afe95639ebe766c1b2a20',
  },
  {
    id: 'gfm',
    label: 'GitHub Flavored Markdown',
    kind: 'file',
    url: 'https://raw.githubusercontent.com/github/cmark-gfm/499789b49373bfa045d0e7547e5ee63444c77bca/test/spec.txt',
    file: 'spec.txt',
    sha256: '7d8e5814befec287ac116786d81ff14e0adc9b13295b4494649e995408fd871c',
  },
  {
    id: 'json',
    label: 'JSONTestSuite',
    kind: 'clone',
    repo: 'https://github.com/nst/JSONTestSuite',
    commit: '1ef36fa01286573e846ac449e8683f8833c5b26a',
    // A full clone is 215 MB, almost all of it compiled parsers for other
    // languages. The tests are 826 KB of it.
    sparse: ['/test_parsing/'],
  },
  {
    id: 'yaml',
    label: 'yaml-test-suite',
    kind: 'clone',
    repo: 'https://github.com/yaml/yaml-test-suite',
    // The `data` branch: one folder per case, not the generated tarballs.
    commit: '6ad3d2c62885d82fc349026c136ef560838fdf3d',
  },
  {
    id: 'xml',
    label: 'W3C XML conformance',
    kind: 'zip',
    url: 'https://www.w3.org/XML/Test/xmlts20130923.zip',
    sha256: 'f9510b3532926e1b4c2e54855b021e4b8a66ec98a5337dcf4ff07e8a41968deb',
  },
  {
    id: 'html5lib',
    label: 'html5lib tokenizer',
    kind: 'clone',
    repo: 'https://github.com/html5lib/html5lib-tests',
    commit: '224991ec10db04f056a89eed8b0bd8695fd2950e',
    sparse: ['/tokenizer/'],
  },
];

// ---- fetching ---------------------------------------------------------------

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = join(root, 'target', 'conformance');
const force = process.argv.includes('--force');

/// What the source is pinned to. The stamp beside a suite holds the pin it was
/// fetched at, so moving a pin refetches and leaving it alone costs nothing.
function pinOf(source) {
  return source.commit ?? source.sha256;
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with ${result.status ?? result.error}`);
  }
}

async function download(url, sha256) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== sha256) {
    throw new Error(`${url}\n  pinned at ${sha256}\n  served   ${got}`);
  }
  return bytes;
}

async function fetchSource(source) {
  const into = join(corpus, source.id);
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });

  if (source.kind === 'file') {
    writeFileSync(join(into, source.file), await download(source.url, source.sha256));
  } else if (source.kind === 'zip') {
    const archive = join(corpus, `${source.id}.zip`);
    writeFileSync(archive, await download(source.url, source.sha256));
    // bsdtar reads zip, and ships with both Windows and macOS — no unpacker to
    // install and no dependency to add.
    const result = spawnSync('tar', ['-xf', archive, '-C', into], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`unpacking ${archive} failed`);
    rmSync(archive, { force: true });
  } else {
    // Fetch the pinned commit alone, with only the paths we read: no history, and
    // no blob downloaded for a file outside the sparse list.
    git(['init', '--quiet', into]);
    git(['remote', 'add', 'origin', source.repo], into);
    if (source.sparse) {
      git(['config', 'core.sparseCheckout', 'true'], into);
      const info = join(into, '.git', 'info');
      mkdirSync(info, { recursive: true });
      writeFileSync(join(info, 'sparse-checkout'), `${source.sparse.join('\n')}\n`);
    }
    git(['fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', source.commit], into);
    git(['checkout', '--quiet', 'FETCH_HEAD'], into);
  }

  writeFileSync(join(corpus, `${source.id}.pin`), `${pinOf(source)}\n`);
}

mkdirSync(corpus, { recursive: true });
for (const source of SOURCES) {
  const stamp = join(corpus, `${source.id}.pin`);
  const have = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : null;
  if (!force && have === pinOf(source) && existsSync(join(corpus, source.id))) {
    console.log(`${source.label}: already at ${pinOf(source).slice(0, 12)}`);
    continue;
  }
  console.log(`${source.label}: fetching ${pinOf(source).slice(0, 12)}`);
  await fetchSource(source);
}
console.log(`conformance: ${SOURCES.length} suites under target/conformance`);
