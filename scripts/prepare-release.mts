// The public release: check this app copy, then commit and tag it.
//
//   node --experimental-strip-types scripts/prepare-release.mts <version> [--no-sign-commit]
//   node --experimental-strip-types scripts/prepare-release.mts --check    self-test (`just check-release`)
//
// The tree is dirty on purpose when a handoff has just been submitted, so the guard is exactness rather than cleanliness: every path with work in it has to be one a submit left, at the bytes it left there, and those paths alone are staged and committed.
//
// The gate reads a still copy of the plan tree rather than the live one. Tickets, README rows and skill copies are written straight into the tree the owner reads while a release runs, and one landing mid-gate is real drift that the release did not cause and cannot fix — which is how a release stopped after the old tag had already gone.
//
// Every command the release runs goes through one runner, so the self-test can hand it a fixture and read back the order: what must not happen after a failed gate is proved by the commands that were never reached.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PLAN_ROOT_ENV, clearPendingRelease, dirtyPaths, isManaged, pendingReleaseRefusal, readPendingRelease, releaseReservation, reserve, withPlanSnapshot, workspaceParent } from "./agent-workspace.mjs";
import { sessionOf } from "./hook-payload.mjs";

type CommandResult = { status: number; stdout: string };
type RunOptions = { capture?: boolean; env?: Record<string, string | undefined> };
type Runner = (command: string, args: string[], options?: RunOptions) => CommandResult;
/// What the submits since the last release left: the refusal where the tree holds anything else, and the paths to commit.
type Handoff = { refusal: string; paths: string[] };
type ReleaseHost = {
  run: Runner;
  enterRepoRoot: () => void;
  packageVersion: () => string;
  managed: () => boolean;
  withSnapshot: (fn: (root: string) => void) => void;
  recordTag: (tag: string) => void;
  holdPrimary: (fn: () => void) => void;
  handoff: () => Handoff;
  clearHandoff: () => void;
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
    managed: () => isManaged(process.cwd()),
    withSnapshot: (fn) => {
      withPlanSnapshot((snapshot: { root: string }) => fn(snapshot.root));
    },
    recordTag: (tag: string) => {
      writeFileSync(".release-tag", tag);
    },
    // The same claim a submit takes, held from the receipt being read to the last push: a handoff landing midway would otherwise arrive after the tree was checked and ride out untested on the commit.
    holdPrimary: (fn: () => void) => {
      const parent = workspaceParent();
      reserve(parent, sessionOf(""));
      try {
        fn();
      } finally {
        releaseReservation(parent);
      }
    },
    handoff: () => {
      const root = process.cwd();
      const paths = dirtyPaths(root);
      return { refusal: pendingReleaseRefusal({ root, dirty: paths, receipt: readPendingRelease(workspaceParent()) }), paths };
    },
    clearHandoff: () => {
      clearPendingRelease(workspaceParent());
    },
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

// The tree is dirty on purpose after a submit — that is how what arrived is read before it ships — so the guard is not cleanliness any more but exactness: everything in the tree has to be bytes a handoff left, and anything else still stops the release.
function assertOnlyHandedOverWork(host: ReleaseHost): string[] {
  const handoff = host.handoff();
  if (handoff.refusal) {
    throw new Error(handoff.refusal);
  }
  return handoff.paths;
}

// A release carries what a submit handed over, so nothing handed over is nothing to release — and the commit is the first thing to notice it, after the whole suite has run. The tags on HEAD say which of the two states this is: none, and nobody handed anything over; one, and an earlier release committed and tagged this very commit before its push failed, which is the case where the tag must never go up again.
function assertSomethingWasHandedOver(host: ReleaseHost, handedOver: string[]): void {
  if (handedOver.length) {
    return;
  }
  const already = host.tagsOnHead();
  if (already.length) {
    throw new Error(`Nothing is waiting to be released, and this commit is already tagged ${already.join(", ")} — an earlier release committed and tagged before it stopped. Never push that tag again: bump the patch in Cargo.toml and release the new number.`);
  }
  throw new Error("Nothing was handed over, so there is nothing to release: no work is waiting in this copy and no receipt names any. Hand a session's work over with `node scripts/agent-workspace.mjs submit <session>` first.");
}

// One public release, in one place: a session's copy hands its work over instead, or two agents tag over each other.
function assertPrimaryCheckout(host: ReleaseHost): void {
  if (host.managed()) {
    throw new Error("A public release runs in the primary checkout. This is a managed workspace: hand the work over with `node scripts/agent-workspace.mjs private`, then submit the handoff from the primary copy.");
  }
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
  assertPrimaryCheckout(host);
  if (host.packageVersion() !== normalized) {
    throw new Error(`Cargo.toml version does not match ${normalized}.`);
  }
  const commitArgs = options.signCommit
    ? ["commit", "-S", "-m", `Release ${tag} [release-prep]`]
    : ["-c", "commit.gpgsign=false", "commit", "--no-gpg-sign", "-m", `Release ${tag} [release-prep]`];
  const tagArgs = options.signCommit
    ? ["tag", "-s", tag, "-m", `Release ${tag}`]
    : ["-c", "tag.gpgSign=false", "tag", "-a", "--no-sign", tag, "-m", `Release ${tag}`];
  // The claim is held across the whole release: what the receipt was checked against has to be what gets committed, and a submit is the one other thing that writes this tree.
  host.holdPrimary(() => {
    const handedOver = assertOnlyHandedOverWork(host);
    assertSomethingWasHandedOver(host, handedOver);
    assertTagDoesNotExist(host, tag);
    // The whole release is inside the copy, so nothing it does can be reached without the gate that passed first. The old release path was two processes — check and tag, then push after the first had exited — which is why a push could outlive whatever the gate had read.
    host.withSnapshot((root) => {
      required(host, "just", ["verify"], { env: { ...process.env, [PLAN_ROOT_ENV]: root } });
      // Only now: a gate that stops here leaves the last released tag exactly where it was.
      retireOldTags(host, tag);
      if (handedOver.length) {
        required(host, "git", ["add", "--", ...handedOver]);
      }
      required(host, "git", commitArgs);
      // Only once the commit holds those bytes: a release that stopped before it leaves the receipt for the next attempt to check the same tree against.
      host.clearHandoff();
      required(host, "git", tagArgs);
      host.recordTag(tag);
      required(host, "git", ["push", "origin", "HEAD"]);
      // The tag on its own, after main: a push carrying several tags makes no push event, so no build starts.
      required(host, "git", ["push", "origin", tag]);
    });
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
    managed: () => false,
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
    holdPrimary: (fn) => {
      record("primary reserved");
      try {
        fn();
      } finally {
        record("primary released");
      }
    },
    // A submitted handoff waiting to be released: two paths, and nothing else in the tree.
    handoff: () => {
      record("receipt read");
      return { refusal: "", paths: ["Cargo.toml", "src/lib.rs"] };
    },
    clearHandoff: () => {
      record("receipt cleared");
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
    ["the primary copy was reserved", clean.calls.indexOf("primary reserved")],
    ["the receipt was read", clean.calls.indexOf("receipt read")],
    ["the plan tree was copied", clean.calls.indexOf("snapshot taken")],
    ["the check suite ran", clean.calls.indexOf("just verify")],
    ["the old tags went", at("git tag -d")],
    ["the handed-over paths were staged", at("git add --")],
    ["the release was committed", at("commit --no-gpg-sign")],
    ["the receipt was cleared", clean.calls.indexOf("receipt cleared")],
    ["the new tag was made", at("tag -a --no-sign")],
    ["main was pushed", at("git push origin HEAD")],
    ["the tag was pushed", at("git push origin v1.2.3")],
    ["the plan copy was taken down", clean.calls.indexOf("snapshot removed")],
    ["the primary copy was given back", clean.calls.indexOf("primary released")],
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
  // Only what the receipt names: a release stages the handed-over paths by name rather than everything the tree happens to hold.
  if (!clean.calls.includes("git add -- Cargo.toml src/lib.rs")) fails.push(`a release did not stage the paths the handoff left: ${clean.calls.filter((call) => call.startsWith("git add")).join(", ") || "it staged nothing"}`);
  if (clean.calls.some((call) => /^git add (-A|--all|\.)(\s|$)/.test(call))) fails.push("a release staged the whole tree rather than the paths the handoff left");

  // A tree holding work no handoff left: refused before the gate, before the tag check, and before anything is staged — and the claim goes back.
  const strange = fixture(() => null, {
    handoff: () => ({ refusal: "src/stray.rs has work in it that no handoff left", paths: [] }),
  });
  const strangeFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: strange.host }));
  if (!strangeFailed.includes("no handoff left")) fails.push(`a release ran with work in the tree that no handoff left: ${strangeFailed || "it passed"}`);
  if (strange.calls.includes("just verify")) fails.push("a tree holding work nobody handed over reached the gate");
  if (strange.calls.includes("snapshot taken")) fails.push("a tree holding work nobody handed over copied the plan tree before being refused");
  if (strange.calls.includes("receipt cleared")) fails.push("a refused release cleared the receipt of what is waiting to be released");
  for (const call of strange.calls) {
    if (TAG_WORK.test(call)) fails.push(`a tree holding work nobody handed over still ran ${call}`);
  }
  if (!strange.calls.includes("primary released")) fails.push("a refused release kept the primary reservation");

  // Nothing handed over at all: refused before the tag check and the gate, since the commit is otherwise the first thing to say so and it says it after the whole suite has run.
  const empty = fixture(() => null, { handoff: () => ({ refusal: "", paths: [] }) });
  const emptyFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: empty.host }));
  if (!emptyFailed.includes("nothing to release")) fails.push(`a release with nothing handed over was not told so: ${emptyFailed || "it passed"}`);
  if (empty.calls.includes("just verify")) fails.push("a release with nothing handed over ran the whole gate before it could say so");
  if (empty.calls.includes("snapshot taken")) fails.push("a release with nothing handed over copied the plan tree before being refused");
  for (const call of empty.calls) {
    if (TAG_WORK.test(call)) fails.push(`a release with nothing handed over still ran ${call}`);
  }
  if (!empty.calls.includes("primary released")) fails.push("a release with nothing handed over kept the primary reservation");

  // The same empty state one step later: a release that committed and tagged, then failed its push. The tag it left is the one fact separating the two, and it must never go up again.
  const stopped = fixture(() => null, { handoff: () => ({ refusal: "", paths: [] }), tagsOnHead: () => ["v1.2.2"] });
  const stoppedFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: stopped.host }));
  if (!stoppedFailed.includes("v1.2.2")) fails.push(`a release resuming after a failed push was not told which tag is already on the commit: ${stoppedFailed || "it passed"}`);
  if (!/bump the patch/i.test(stoppedFailed)) fails.push("a release resuming after a failed push was not told to bump the patch rather than push that tag again");
  if (stopped.calls.includes("just verify")) fails.push("a release resuming after a failed push ran the whole gate before it could say so");
  for (const call of stopped.calls) {
    if (TAG_WORK.test(call)) fails.push(`a release resuming after a failed push still ran ${call}`);
  }

  // A commit that fails: the receipt stays, so the next attempt checks the same tree against the same bytes rather than meeting a tree it cannot account for.
  const noCommit = fixture((command, args) => (command === "git" && args.includes("commit") ? { status: 1, stdout: "" } : null));
  const commitFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: noCommit.host }));
  if (!commitFailed.includes("commit")) fails.push(`a failed commit did not stop the release: ${commitFailed || "it passed"}`);
  if (noCommit.calls.includes("receipt cleared")) fails.push("a release whose commit failed threw away the receipt of what is waiting to be released");
  if (!noCommit.calls.includes("primary released")) fails.push("a release whose commit failed kept the primary reservation");

  // A gate that fails: nothing is committed, tagged or pushed, and the copy still goes.
  const broken = fixture((command) => (command === "just" ? { status: 1, stdout: "" } : null));
  const gateFailed = refused(() => prepareRelease("1.2.3", { signCommit: false, host: broken.host }));
  if (!gateFailed.includes("just verify")) fails.push(`a failed gate did not stop the release: ${gateFailed || "it passed"}`);
  for (const call of broken.calls) {
    if (TAG_WORK.test(call)) fails.push(`a failed gate still ran ${call}`);
  }
  if (broken.calls.some((call) => call.includes("tag -d") || call.includes("--delete"))) fails.push("a failed gate took down the last released tag");
  if (!broken.calls.includes("snapshot removed")) fails.push("a failed gate left its copy of the plan tree behind");
  if (broken.calls.includes("receipt cleared")) fails.push("a failed gate threw away the receipt of what is waiting to be released");
  if (!broken.calls.includes("primary released")) fails.push("a failed gate kept the primary reservation");

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
  const managed = fixture(() => null, { managed: () => true });
  if (!refused(() => prepareRelease("1.2.3", { signCommit: false, host: managed.host })).includes("primary checkout")) {
    fails.push("a managed workspace was allowed to make a public release");
  }
  if (managed.calls.includes("snapshot taken")) fails.push("a managed workspace copied the plan tree before being refused");
  if (managed.calls.includes("primary reserved")) fails.push("a managed workspace took the primary reservation before being refused");

  const mismatched = fixture(() => null, { packageVersion: () => "9.9.9" });
  if (!refused(() => prepareRelease("1.2.3", { signCommit: false, host: mismatched.host })).includes("does not match")) {
    fails.push("a release ran with a version the package does not carry");
  }

  if (refused(() => normalizeVersion("not-a-version")) === "") fails.push("a version that is not one was accepted");

  if (fails.length) {
    console.error("prepare-release: failed");
    for (const line of fails) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("prepare-release: ok (one command from the gate to the push, all of it inside a still copy of the plan tree and under the primary reservation; the handed-over paths are staged by name and their receipt cleared only once the commit holds them; the old tags go only after the gate passes, and a failed gate, a moving tree, a workspace, work nobody handed over, nothing handed over at all or a wrong version reaches no tag cleanup, staging, commit, tag or push, and a release meeting the empty tree an earlier one left names the tag already on the commit and says to bump the patch)");
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
