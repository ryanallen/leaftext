// The public release: check this app copy, then commit and tag it.
//
//   node --experimental-strip-types scripts/prepare-release.mts <version> [--no-sign-commit]
//   node --experimental-strip-types scripts/prepare-release.mts --check    self-test (`just check-release`)
//
// The tree is dirty on purpose: the work being released was written in this checkout and never committed, so the release stages the paths that have work in them by name and commits those. A clean tree is nothing to release.
//
// The gate reads a still copy of the plan tree rather than the live one. Tickets, README rows and skill copies are written straight into the tree the owner reads while a release runs, and one landing mid-gate is real drift that the release did not cause and cannot fix — which is how a release stopped after the old tag had already gone.
//
// Every command the release runs goes through one runner, so the self-test can hand it a fixture and read back the order: what must not happen after a failed gate is proved by the commands that were never reached.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PLAN_ROOT_ENV, dirtyPaths, withPlanSnapshot } from "./plan-tree.mjs";

type CommandResult = { status: number; stdout: string };
type RunOptions = { capture?: boolean; env?: Record<string, string | undefined> };
type Runner = (command: string, args: string[], options?: RunOptions) => CommandResult;
type ReleaseHost = {
  run: Runner;
  enterRepoRoot: () => void;
  packageVersion: () => string;
  withSnapshot: (fn: (root: string) => void) => void;
  recordTag: (tag: string) => void;
  changedPaths: () => string[];
  tagsOnHead: () => string[];
};
type ReleaseOptions = { signCommit: boolean; host?: ReleaseHost };

const versionPattern = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function liveRun(command: string, args: string[], options: RunOptions = {}): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: options.env ?? process.env,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status ?? 1, stdout: typeof result.stdout === "string" ? result.stdout : "" };
}

function required(host: ReleaseHost, command: string, args: string[], options: RunOptions = {}): string {
  const result = host.run(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
  return result.stdout.trim();
}

export function liveHost(): ReleaseHost {
  const host: ReleaseHost = {
    run: liveRun,
    enterRepoRoot: () => {
      process.chdir(required(host, "git", ["rev-parse", "--show-toplevel"], { capture: true }));
    },
    packageVersion: () => {
      const match = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync("Cargo.toml", "utf8"));
      if (!match) {
        throw new Error("Could not find package.version in Cargo.toml.");
      }
      return match[1] ?? "";
    },
    withSnapshot: (fn) => {
      withPlanSnapshot((snapshot: { root: string }) => fn(snapshot.root));
    },
    recordTag: (tag: string) => {
      writeFileSync(".release-tag", tag);
    },
    changedPaths: () => dirtyPaths(process.cwd()),
    tagsOnHead: () => required(host, "git", ["tag", "--points-at", "HEAD"], { capture: true }).split("\n").map((line) => line.trim()).filter(Boolean),
  };
  return host;
}

function normalizeVersion(version: string): string {
  const normalized = version.trim().replace(/^v/, "");
  if (!versionPattern.test(normalized)) {
    throw new Error("Release version must look like 0.1.0, v0.1.0, or 0.1.0-beta.1.");
  }
  return normalized;
}

// A release carries the work sitting in this checkout, so a clean tree is nothing to release — and the commit is the first thing to notice it, after the whole suite has run. The tags on HEAD say which of the two states this is: none, and nothing was written; one, and an earlier release committed and tagged this very commit before its push failed, which is the case where the tag must never go up again.
function assertSomethingToRelease(host: ReleaseHost, changed: string[]): void {
  if (changed.length) {
    return;
  }
  const already = host.tagsOnHead();
  if (already.length) {
    throw new Error(`Nothing is waiting to be released, and this commit is already tagged ${already.join(", ")} — an earlier release committed and tagged before it stopped. Never push that tag again: bump the patch in Cargo.toml and release the new number.`);
  }
  throw new Error("There is nothing to release: this checkout has no work in it.");
}

function assertTagDoesNotExist(host: ReleaseHost, tag: string): void {
  if (host.run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { capture: true }).status === 0) {
    throw new Error(`Local tag ${tag} already exists.`);
  }
  if (host.run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], { capture: true }).status === 0) {
    throw new Error(`Remote tag ${tag} already exists on origin.`);
  }
}

// Exactly one tag exists at a time, here and on GitHub: the build prunes older releases when it publishes, so a tag left behind comes back on the next push carrying tags — and a push carrying more than three makes no push event at all, which starts no build while the tag sits there looking shipped. The remote delete is allowed to fail: a tag the build already pruned is not there to remove.
function retireOldTags(host: ReleaseHost, keep: string): void {
  const others = required(host, "git", ["tag", "-l"], { capture: true })
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name && name !== keep);
  if (!others.length) {
    return;
  }
  required(host, "git", ["tag", "-d", ...others]);
  host.run("git", ["push", "origin", "--delete", ...others]);
}

export function prepareRelease(version: string, options: ReleaseOptions = { signCommit: true }): string {
  const host = options.host ?? liveHost();
  const normalized = normalizeVersion(version);
  const tag = `v${normalized}`;
  host.enterRepoRoot();
  if (host.packageVersion() !== normalized) {
    throw new Error(`Cargo.toml version does not match ${normalized}.`);
  }
  const commitArgs = options.signCommit
    ? ["commit", "-S", "-m", `Release ${tag} [release-prep]`]
    : ["-c", "commit.gpgsign=false", "commit", "--no-gpg-sign", "-m", `Release ${tag} [release-prep]`];
  const tagArgs = options.signCommit
    ? ["tag", "-s", tag, "-m", `Release ${tag}`]
    : ["-c", "tag.gpgSign=false", "tag", "-a", "--no-sign", tag, "-m", `Release ${tag}`];
  const changed = host.changedPaths();
  assertSomethingToRelease(host, changed);
  assertTagDoesNotExist(host, tag);
  // The whole release is inside the copy, so nothing it does can be reached without the gate that passed first. The old release path was two processes — check and tag, then push after the first had exited — which is why a push could outlive whatever the gate had read.
  host.withSnapshot((root) => {
    required(host, "just", ["verify"], { env: { ...process.env, [PLAN_ROOT_ENV]: root } });
    // Only now: a gate that stops here leaves the last released tag exactly where it was.
    retireOldTags(host, tag);
    required(host, "git", ["add", "--", ...changed]);
    required(host, "git", commitArgs);
    required(host, "git", tagArgs);
    host.recordTag(tag);
    required(host, "git", ["push", "origin", "HEAD"]);
    // The tag on its own, after main: a push carrying several tags makes no push event, so no build starts.
    required(host, "git", ["push", "origin", tag]);
  });
  return tag;
}

// ---------------------------------------------------------------------------
// Self-test, on a fixture host that runs nothing.
// ---------------------------------------------------------------------------

type Fixture = { host: ReleaseHost; calls: string[]; envs: Array<Record<string, string | undefined> | undefined> };

/// A release that touches no repository: every command is recorded before it is answered, so what a failure never reached is readable. A case supplies answers rather than its own runner, or a command it meant to fail would go unrecorded and the absence proved nothing.
function fixture(answer: (command: string, args: string[]) => CommandResult | null = () => null, overrides: Partial<ReleaseHost> = {}): Fixture {
  const calls: string[] = [];
  const envs: Array<Record<string, string | undefined> | undefined> = [];
  // Both lists stay the same length, so the environment a call carried is read at that call's own place.
  const record = (line: string, env?: Record<string, string | undefined>) => {
    calls.push(line);
    envs.push(env);
  };
  const host: ReleaseHost = {
    run: (command, args, options = {}) => {
      record(`${command} ${args.join(" ")}`, options.env);
      const said = answer(command, args);
      if (said) return said;
      // A tag nobody has yet, and a clean tree.
      if (args[0] === "rev-parse" && args.includes("--verify")) return { status: 1, stdout: "" };
      if (args[0] === "ls-remote") return { status: 1, stdout: "" };
      return { status: 0, stdout: "" };
    },
    enterRepoRoot: () => {
      record("enter repo root");
    },
    packageVersion: () => "1.2.3",
    withSnapshot: (fn) => {
      record("snapshot taken");
      try {
        fn("/snapshot/docs");
      } finally {
        record("snapshot removed");
      }
    },
    recordTag: (tag) => {
      record(`record ${tag}`);
    },
    // Work sitting in the checkout, waiting to be released: two paths.
    changedPaths: () => {
      record("changed paths read");
      return ["Cargo.toml", "src/lib.rs"];
    },
    // A read, not tag work: it is recorded under its own name so the loops proving a refusal reached no tag can stay about the commands that write one.
    tagsOnHead: () => {
      record("tags on HEAD read");
      return [];
    },
    ...overrides,
  };
  return { host, calls, envs };
}

function refused(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

/// What no failure may ever reach — staging included, since the index is the release's own write as much as the commit is.
const TAG_WORK = /^git (add|commit|tag|push)|^git .*(tag -d|--delete)/;

function selfTest(): void {
  const fails: string[] = [];

  // A release that passes, in the order it is documented in: gate, then the old tags, then the commit, the tag, main, and the tag on its own.
  const clean = fixture((_command, args) => (args[0] === "tag" && args[1] === "-l" ? { status: 0, stdout: "v1.0.0\nv1.1.0\n" } : null));
  const tag = prepareRelease("1.2.3", { signCommit: false, host: clean.host });
  if (tag !== "v1.2.3") fails.push(`a passing release answered ${tag} rather than its tag`);
  const at = (want: string) => clean.calls.findIndex((call) => call.includes(want));
  const order: Array<[string, number]> = [
    ["the work in the tree was read", clean.calls.indexOf("changed paths read")],
    ["the plan tree was copied", clean.calls.indexOf("snapshot taken")],
    ["the check suite ran", clean.calls.indexOf("just verify")],
    ["the old tags went", at("git tag -d")],
    ["the changed paths were staged", at("git add --")],
    ["the release was committed", at("commit --no-gpg-sign")],
    ["the new tag was made", at("tag -a --no-sign")],
    ["main was pushed", at("git push origin HEAD")],
    ["the tag was pushed", at("git push origin v1.2.3")],
    ["the plan copy was taken down", clean.calls.indexOf("snapshot removed")],
  ];
  for (const [what, where] of order) {
    if (where < 0) fails.push(`a passing release never reached the step where ${what}`);
  }
  for (let i = 1; i < order.length; i += 1) {
    const [before, beforeAt] = order[i - 1]!;
    const [after, afterAt] = order[i]!;
    if (beforeAt >= 0 && afterAt >= 0 && beforeAt > afterAt) fails.push(`${after} before ${before}`);
  }
  if (!clean.calls.some((call) => call.includes("push origin --delete"))) fails.push("the old tags were left on the remote, so they come back on the next push carrying tags");
  const held = clean.envs[clean.calls.indexOf("just verify")];
  if (held?.[PLAN_ROOT_ENV] !== "/snapshot/docs") fails.push("the check suite was not pointed at the plan copy");
  // By name, never the whole tree: a release commits the paths it read and nothing the tree happens to pick up while the gate runs.
  if (!clean.calls.includes("git add -- Cargo.toml src/lib.rs")) fails.push(`a release did not stage the paths with work in them: ${clean.calls.filter((call) => call.startsWith("git add")).join(", ") || "it staged nothing"}`);
  if (clean.calls.some((call) => /^git add (-A|--all|\.)(\s|$)/.test(call))) fails.push("a release staged the whole tree rather than the paths it read");

  // A clean tree: refused before the tag check and the gate, since the commit is otherwise the first thing to say so and it says it after the whole suite has run.
  const empty = fixture(() => null, { changedPaths: () => [] });
  const emptyFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: empty.host }));
  if (!emptyFailed.includes("nothing to release")) fails.push(`a release with a clean tree was not told so: ${emptyFailed || "it passed"}`);
  if (empty.calls.includes("just verify")) fails.push("a release with a clean tree ran the whole gate before it could say so");
  if (empty.calls.includes("snapshot taken")) fails.push("a release with a clean tree copied the plan tree before being refused");
  for (const call of empty.calls) {
    if (TAG_WORK.test(call)) fails.push(`a release with a clean tree still ran ${call}`);
  }

  // The same empty state one step later: a release that committed and tagged, then failed its push. The tag it left is the one fact separating the two, and it must never go up again.
  const stopped = fixture(() => null, { changedPaths: () => [], tagsOnHead: () => ["v1.2.2"] });
  const stoppedFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: stopped.host }));
  if (!stoppedFailed.includes("v1.2.2")) fails.push(`a release resuming after a failed push was not told which tag is already on the commit: ${stoppedFailed || "it passed"}`);
  if (!/bump the patch/i.test(stoppedFailed)) fails.push("a release resuming after a failed push was not told to bump the patch rather than push that tag again");
  if (stopped.calls.includes("just verify")) fails.push("a release resuming after a failed push ran the whole gate before it could say so");
  for (const call of stopped.calls) {
    if (TAG_WORK.test(call)) fails.push(`a release resuming after a failed push still ran ${call}`);
  }

  // A commit that fails: the release stops there, with nothing tagged and nothing pushed.
  const noCommit = fixture((command, args) => (command === "git" && args.includes("commit") ? { status: 1, stdout: "" } : null));
  const commitFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: noCommit.host }));
  if (!commitFailed.includes("commit")) fails.push(`a failed commit did not stop the release: ${commitFailed || "it passed"}`);
  if (noCommit.calls.some((call) => /^git (tag -a|push)/.test(call))) fails.push("a release whose commit failed still tagged or pushed");

  // A gate that fails: nothing is committed, tagged or pushed, and the copy still goes.
  const broken = fixture((command) => (command === "just" ? { status: 1, stdout: "" } : null));
  const gateFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: broken.host }));
  if (!gateFailed.includes("just verify")) fails.push(`a failed gate did not stop the release: ${gateFailed || "it passed"}`);
  for (const call of broken.calls) {
    if (TAG_WORK.test(call)) fails.push(`a failed gate still ran ${call}`);
  }
  if (broken.calls.some((call) => call.includes("tag -d") || call.includes("--delete"))) fails.push("a failed gate took down the last released tag");
  if (!broken.calls.includes("snapshot removed")) fails.push("a failed gate left its copy of the plan tree behind");

  // Nothing the release does may outlive the plan copy the gate read: the old path was two processes, and the push in the second one had no copy behind it at all.
  const outside = clean.calls.indexOf("snapshot removed");
  for (let i = outside + 1; i < clean.calls.length; i += 1) {
    if (TAG_WORK.test(clean.calls[i]!)) fails.push(`${clean.calls[i]} ran after the plan copy had gone`);
  }

  // A plan tree that will not hold still: the gate never runs, so no tag work can follow it.
  const moving = fixture(() => null, {
    withSnapshot: () => {
      throw new Error("the plan tree changed every time it was copied");
    },
  });
  const movingFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: moving.host }));
  if (!movingFailed.includes("changed every time")) fails.push(`a moving plan tree did not stop the release: ${movingFailed || "it passed"}`);
  if (moving.calls.includes("just verify")) fails.push("a release checked itself against a plan tree that would not hold still");
  for (const call of moving.calls) {
    if (TAG_WORK.test(call)) fails.push(`a release with no plan copy still ran ${call}`);
  }

  // The refusals that come before any of it.
  const mismatched = fixture(() => null, { packageVersion: () => "9.9.9" });
  if (!refused(() => prepareRelease("1.2.3", { signCommit: false, host: mismatched.host })).includes("does not match")) {
    fails.push("a release ran with a version the package does not carry");
  }
  if (mismatched.calls.includes("snapshot taken")) fails.push("a wrong version copied the plan tree before being refused");
  for (const call of mismatched.calls) {
    if (TAG_WORK.test(call)) fails.push(`a wrong version still ran ${call}`);
  }

  if (refused(() => normalizeVersion("not-a-version")) === "") fails.push("a version that is not one was accepted");

  if (fails.length) {
    console.error("prepare-release: failed");
    for (const line of fails) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("prepare-release: ok (one command from the gate to the push, all of it inside a still copy of the plan tree; the paths with work in them are staged by name rather than the whole tree; the old tags go only after the gate passes, and a failed gate, a moving tree, a clean tree or a wrong version reaches no tag cleanup, staging, commit, tag or push, and a release meeting the empty tree an earlier one left names the tag already on the commit and says to bump the patch)");
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  if (process.argv.includes("--check")) {
    selfTest();
  } else {
    const version = process.argv[2];
    const signCommit = !process.argv.includes("--no-sign-commit");
    if (!version) {
      throw new Error("Usage: node --experimental-strip-types scripts/prepare-release.mts <version> [--no-sign-commit]");
    }
    prepareRelease(version, { signCommit });
  }
}
