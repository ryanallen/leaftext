// Where a reader meets Leaftext, for everything in this tree written in JavaScript or TypeScript: the site build, the discovery generator and the three release tools.
//
// One line in `Cargo.toml` owns the address — `[package.metadata.leaftext] public-repository` — and this is the only reading of it outside Rust, where `src/public_repository.rs` is the same rule for the two build scripts. Nothing here writes the address down: a second spelling is exactly the drift `just check-repo-address` exists to refuse.
//
// It is named metadata rather than Cargo's own `repository` field because that field means where this source lives, which is the private repository. This names the public home the app checks for updates against, the installer points Help at, the site publishes as its project address and every release is made in.
//
// **The public side has no manifest.** `site-assets.mjs` crosses to `ryanallen/leaftext` and bakes the front page there, where there is no `Cargo.toml` at all — so the private build writes the address into `version.json` beside the version, and `projectFrom` reads it back out of whatever the bake was handed. That is why the reading and the validation are separate: the source of the text changes, the rule about what a public repository address may be does not.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The owner and repository name a public repository URL carries, or why it is not one.
 *
 * Strict on purpose: the value ends up as a link somebody presses, as a GitHub API route the app fetches and as the repository a release is published into, so an address that is not exactly one owner and one name on `github.com` over HTTPS is refused while a build is watching rather than after an installer carries it.
 */
export function ownerAndName(url) {
  const refuse = (why) => {
    throw new Error(`${url} is not a public repository address: ${why}`);
  };
  if (typeof url !== 'string' || !url.startsWith('https://github.com/')) refuse('it has to be https://github.com/<owner>/<name>');
  const path = url.slice('https://github.com/'.length);
  // A password or a fragment in the middle of a path still leaves two segments, so each is refused by name rather than by what the split happens to give back.
  for (const [mark, why] of [['@', 'it carries credentials'], ['?', 'it carries a query'], ['#', 'it carries a fragment']]) {
    if (path.includes(mark)) refuse(why);
  }
  const parts = path.split('/');
  if (parts.length !== 2) refuse('it names something other than one owner and one repository');
  if (parts.some((part) => !part)) refuse('one of its two names is empty');
  if (parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) refuse('a name holds something GitHub does not allow in one');
  return { owner: parts[0], name: parts[1] };
}

/** Every route this tree asks for, built from one validated URL so no caller composes a second one. */
export function projectFrom(url) {
  const { owner, name } = ownerAndName(url);
  return {
    url,
    owner,
    name,
    /** What `gh` is told, and what a workflow guard compares itself against. */
    slug: `${owner}/${name}`,
    /** Where the updater asks whether this copy is current. */
    api: `https://api.github.com/repos/${owner}/${name}/releases/latest`,
    /** The listing a reader is sent to when they want to see every file. */
    releases: `${url}/releases`,
    /** Where a download button points: fixed, because it only answers while the asset names never move. */
    download: `${url}/releases/latest/download`,
  };
}

/** The `public-repository` line under `[package.metadata.leaftext]`. The section header is matched as a whole line, so a key of the same name under another table cannot answer for it. */
export function publicRepositoryIn(manifest) {
  let inside = false;
  for (const raw of manifest.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inside = line === '[package.metadata.leaftext]';
      continue;
    }
    if (!inside || !line.startsWith('public-repository')) continue;
    const found = /^public-repository\s*=\s*"([^"]*)"/.exec(line);
    if (!found) throw new Error(`public-repository is not a quoted string: ${line}`);
    return found[1];
  }
  throw new Error('Cargo.toml names no public-repository under [package.metadata.leaftext], and the app, the installer, the site and the release path all read it from there');
}

/**
 * The project this checkout builds.
 *
 * `handed` is the parsed `version.json` a public-side bake was given, which is the one run with no `Cargo.toml` under it. Passing nothing reads the manifest, which is every other caller.
 */
export function project(handed = null) {
  if (handed) {
    if (typeof handed.repository !== 'string') throw new Error('the handed-over version.json names no repository, so the site cannot say where its own project is');
    return projectFrom(handed.repository);
  }
  return projectFrom(publicRepositoryIn(readFileSync(join(root, 'Cargo.toml'), 'utf8')));
}

// `node scripts/project.mjs --slug` and friends, for a caller that is not JavaScript. Nothing in this tree needs it yet, and it is here because the alternative to one line of shell asking the reader is a second spelling of the address in whatever asked.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const asked = process.argv[2] ?? '--url';
  const answers = project();
  const key = asked.replace(/^--/, '');
  if (!(key in answers)) {
    console.error(`project.mjs answers ${Object.keys(answers).map((one) => `--${one}`).join(', ')}`);
    process.exit(1);
  }
  console.log(answers[key]);
}
