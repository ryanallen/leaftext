#!/usr/bin/env node
// The release workflows have to find the app's binary in a tree that is now a workspace. `cargo metadata --no-deps` returns no resolve graph, so there is no root package to ask for, and the browser package sorts ahead of the app — picking the first workspace member found it, and v0.1.484's Mac job failed with "Release requires at least one Cargo binary target" having built both chips first.
//
//   node scripts/check-release-package.mjs   (`just verify`)
//
// Two halves, because either alone goes quiet: the tree really does have one package named `leaftext` carrying a `leaftext` binary, and the workflow really does pick it by name rather than by position.
//
// It also holds the one command that finishes a release stopped by a GitHub outage, since that command is a claim about both workflows and lives nowhere they can be read from.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const metadata = JSON.parse(
  execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
);
const packages = metadata.packages || [];
const app = packages.find((one) => one.name === 'leaftext');
if (!app) {
  problems.push('no package named leaftext — the workflows look it up by that name');
} else if (!app.targets.some((target) => target.kind.includes('bin') && target.name === 'leaftext')) {
  problems.push('the leaftext package has no binary target named leaftext');
}

// A workflow that takes the first member is the bug this file exists for, and it only bites when there is more than one package to be first.
const macos = readFileSync(join(root, '.github/workflows/release-distributions.yml'), 'utf8');
if (!macos.includes('item.get("name") == "leaftext"')) {
  problems.push('release-distributions.yml no longer picks the app package by name');
}
for (const guess of ['packages[0]', 'workspace_members']) {
  if (macos.includes(guess)) problems.push(`release-distributions.yml picks a package by position (${guess})`);
}

// The body of one justfile recipe: everything indented under its name, so a claim about what it runs is read off the lines it really runs.
function recipeBody(text, name) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => new RegExp(`^${name}(\\s|:)`).test(line));
  if (at < 0) return '';
  const body = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() && !/^[ \t]/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

// A release stopped by a GitHub outage is finished on the tag it already has, which is what `just publish-release` is for: everything up to the last step survived, so a new version number spends a whole gate again for nothing. The recipe has to start both builds — half the installers is a release nobody can use — hand each of them the tag it was given, and ask GitHub for that tag first, or a version nobody tagged starts two builds that cannot check anything out. And it must write nothing at all, or it becomes a second way to cut a release with none of the gate in front of it.
const justfile = readFileSync(join(root, 'justfile'), 'utf8');
const publish = recipeBody(justfile, 'publish-release');
if (!publish.trim()) {
  problems.push('the justfile has no publish-release recipe, so a tag stranded by an outage can only be finished by hand');
} else {
  for (const workflow of ['release-windows.yml', 'release-distributions.yml']) {
    if (!publish.includes(workflow)) problems.push(`publish-release does not start ${workflow}, so it would publish half the installers`);
  }
  if (!/tag_name=v\{\{ ?version ?\}\}/.test(publish)) {
    problems.push('publish-release does not hand the builds the version it was given as their tag');
  }
  const asks = publish.search(/ls-remote[^\n]*refs\/tags\/v\{\{ ?version ?\}\}/);
  const starts = publish.search(/gh workflow run/);
  if (asks < 0) {
    problems.push('publish-release never asks GitHub whether that tag is there, so a version nobody tagged starts two builds that cannot check it out');
  } else if (starts >= 0 && asks > starts) {
    problems.push('publish-release starts a build before it has asked whether the tag is on GitHub');
  }
  for (const [writes, what] of [
    [/\bgit\s+(?:tag|commit|push|add)\b/, 'writes git'],
    [/prepare-release/, 'runs the release script'],
    [/Cargo\.toml/, 'touches the version'],
    [/\bgh\s+release\s+(?:create|delete|upload)\b/, 'publishes or deletes a release itself'],
  ]) {
    if (writes.test(publish)) problems.push(`publish-release ${what}, so it can be mistaken for cutting a release`);
  }
}

// Both workflows take a tag by hand and check that tag out. Without it the recipe above names two builds that would build whatever the branch happens to be.
const windows = readFileSync(join(root, '.github/workflows/release-windows.yml'), 'utf8');
const jobs = [['release-windows.yml', windows], ['release-distributions.yml', macos]];
for (const [name, text] of jobs) {
  if (!/workflow_dispatch:[\s\S]*?tag_name:/.test(text)) {
    problems.push(`${name} no longer takes a tag by hand, so a stranded release cannot be finished`);
  }
  if (!text.includes('ref: refs/tags/${{ inputs.tag_name || github.ref_name }}')) {
    problems.push(`${name} no longer checks out the tag it was handed`);
  }
}

// The two jobs are two copies on purpose — one shared step would need an action file and a shell neither of them uses — so the thing that holds them to each other is here. The fault was never that the logic is written twice; it is that the copies were allowed to say different things: the Windows job asked once, and the macOS job retried the upload alone, which is refused every attempt for a release nobody made.
const waited = new Map();
for (const [name, text] of jobs) {
  const from = text.indexOf('name: Upload release assets');
  const to = text.indexOf('name: Delete old releases');
  if (from < 0 || to < 0) {
    problems.push(`${name} no longer has both a publishing step and a step deleting the older releases`);
    continue;
  }
  if (to < from) {
    problems.push(`${name} deletes the older releases before it has published this one, so a refused publish takes the last download with it`);
    continue;
  }
  const step = text.slice(from, to);
  // A line whose first word is the loop, so the word inside a comment cannot answer for one: both steps carry prose with "for" in it, and a step that had lost its retry would otherwise read as having one.
  const loop = step.search(/^[ \t]*(?:for|while|until)\b/m);
  const asks = step.indexOf('gh release create');
  const uploads = step.indexOf('gh release upload');
  if (loop < 0) {
    problems.push(`${name} publishes without asking again, so a GitHub outage of any length costs a version number`);
  } else if (asks < 0 || asks < loop) {
    problems.push(`${name} retries the upload without retrying the making of the release, and an upload to a release nobody made is refused every attempt`);
  } else if (uploads < 0 || uploads < loop) {
    problems.push(`${name} makes the release inside its retry and uploads outside it`);
  }
  if (!/just publish-release/.test(step)) {
    problems.push(`${name} gives up without naming the command that finishes the release on the tag already up, which is what sends the next person after a new version number`);
  }
  if (!/throw|exit 1/.test(step)) {
    problems.push(`${name} treats a publish nobody accepted as a success, so the job goes green with nothing to download`);
  }
  const list = /waits\s*=\s*@?\(([^)]*)\)/.exec(step);
  const waits = list ? (list[1].match(/\d+/g) || []).map(Number) : [];
  if (!waits.length) problems.push(`${name} has no list of waits, so how long it keeps asking cannot be read or compared`);
  waited.set(name, waits);
}
const budgets = [...waited.values()].map((waits) => waits.join(' '));
if (budgets.length === 2 && budgets[0] !== budgets[1]) {
  problems.push(`the two jobs keep asking for different lengths of time (${budgets.join(' against ')}), so an outage publishes one installer and not the other`);
}
for (const [name, waits] of waited) {
  const spent = waits.reduce((sum, one) => sum + one, 0);
  // About five minutes: long enough to ride out a blip, which is what most of them are, and short enough that a longer outage is finished by hand rather than by twenty runner-minutes that fail anyway.
  if (waits.length && (spent < 240 || spent > 420)) {
    problems.push(`${name} spends ${spent} seconds asking rather than about five minutes: a shorter run reaches a person for a blip, and a longer one burns runner time on an outage that hand-publishing answers`);
  }
  if (waits.some((one, at) => at > 0 && one < waits[at - 1])) {
    problems.push(`${name} does not widen the gaps between attempts, so it asks hardest exactly when GitHub is least likely to answer`);
  }
}

if (problems.length) {
  console.error('the release workflows cannot be trusted to find the app:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`release: ${packages.length} packages in the tree, the workflows name the one that carries the app, one command finishes a stranded tag on both of them without writing anything, and both jobs retry the making of the release with the upload for the same widening five minutes, name that command when they give up, and delete no older release until their own has published`);
