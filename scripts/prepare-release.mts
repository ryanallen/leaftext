// The public release: check this app copy, then commit and tag it.
//
//   LEAFTEXT_RELEASE_PATHS='["path"]' node --experimental-strip-types scripts/prepare-release.mts <version> <message...> [--no-sign-commit]
//   LEAFTEXT_RELEASE_PATHS='["path"]' node --experimental-strip-types scripts/prepare-release.mts --land <message...>    get this pass's work onto main now (`just land`)
//   node --experimental-strip-types scripts/prepare-release.mts --check                self-test (`just check-release`)
//
// Every commit names its work — the ticket in plain words, or what changed where no ticket carries it. A history that says one repeated title cannot answer which commit brought what, so a blank message is refused before anything is read rather than filled in with a placeholder.
//
// The landing runs first and on its own: it stages only the paths this pass names, commits and pushes main, with no gate, no version and no tag. Other sessions' paths stay in the checkout. A release spends an hour in docs, comments and the whole suite, and every minute of that is a minute its own work sits uncommitted where another session can collide with it.
//
// The tree is dirty on purpose: the work being released was written in this checkout and never committed, so the caller names its paths and the release intersects that list with the work on disk. A clean owned set is nothing to release, however much work another session has beside it.
//
// The gate reads a still copy of the plan tree rather than the live one. Tickets, README rows and skill copies are written straight into the tree the owner reads while a release runs, and one landing mid-gate is real drift that the release did not cause and cannot fix — which is how a release stopped after the old tag had already gone.
//
// Every command the release runs goes through one runner, so the self-test can hand it a fixture and read back the order: what must not happen after a failed gate is proved by the commands that were never reached.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  withPrivateIndex: (fn: (env: Record<string, string | undefined>) => void) => void;
  recordTag: (tag: string) => void;
  changedPaths: () => string[];
  tagsOnHead: () => string[];
};
type ReleaseOptions = { signCommit: boolean; host?: ReleaseHost; paths?: string[] };

const versionPattern = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const RELEASE_PATHS_ENV = "LEAFTEXT_RELEASE_PATHS";

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
    withPrivateIndex: (fn) => {
      const folder = mkdtempSync(join(tmpdir(), "leaftext-release-index-"));
      const env = { ...process.env, GIT_INDEX_FILE: join(folder, "index") };
      try {
        required(host, "git", ["read-tree", "HEAD"], { env });
        fn(env);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
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

const CANNOT_NAME_PUBLISHED = "GitHub would not say which release is published, and a published release's tag may not be deleted on a guess. No tag was touched: release again once `gh release list` answers.";

// Every download address the project publishes resolves through the latest release, and so does the updater — so the tag of the release people are downloading may not go before the new release exists. It is read from GitHub rather than sorted out of the tag list: a build that failed leaves a higher tag with no release under it, and version order would keep that one and delete the complete release underneath it. An answer that cannot be read stops the release before a tag is deleted. No releases at all is an answer rather than a failure — the first release of a repository has no fallback to keep.
function newestPublishedTag(host: ReleaseHost): string {
  const asked = host.run("gh", ["release", "list", "--limit", "1", "--order", "desc", "--exclude-drafts", "--json", "tagName"], { capture: true });
  if (asked.status !== 0) {
    throw new Error(CANNOT_NAME_PUBLISHED);
  }
  let listed: unknown;
  try {
    listed = JSON.parse(asked.stdout);
  } catch {
    throw new Error(CANNOT_NAME_PUBLISHED);
  }
  if (!Array.isArray(listed)) {
    throw new Error(CANNOT_NAME_PUBLISHED);
  }
  const newest = listed[0] as { tagName?: string } | undefined;
  return newest?.tagName?.trim() ?? "";
}

// Two tags exist at a time, here and on GitHub: the new one, and the tag of the release people download while the new one builds. Everything else goes, because a tag left behind comes back on the next push carrying tags — and a push carrying more than three makes no push event at all, which starts no build while the tag sits there looking shipped. The remote delete is allowed to fail: a tag the build already pruned is not there to remove.
function retireOldTags(host: ReleaseHost, keep: string[]): void {
  const kept = new Set(keep.filter(Boolean));
  const others = required(host, "git", ["tag", "-l"], { capture: true })
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name && !kept.has(name));
  if (!others.length) {
    return;
  }
  required(host, "git", ["tag", "-d", ...others]);
  host.run("git", ["push", "origin", "--delete", ...others]);
}

// The Mac half compiles nowhere on this machine, so its newest completed answer on main is read before anything is spent: a failure there is v1.28.0 again — a tag up, the Windows installers published, the Mac one dead on a line nothing here compiles. Only a completed failure stops the release. No run yet, or GitHub not answering, stops nothing, because a release may never wait on a build — and the release commit's own run starts beside the release, so the fault this catches is the one that landed earlier.
function assertMacHalfCompiles(host: ReleaseHost): void {
  const asked = host.run(
    "gh",
    ["run", "list", "--workflow", "validate-macos.yml", "--branch", "main", "--status", "completed", "--limit", "1", "--json", "conclusion,url"],
    { capture: true }
  );
  if (asked.status !== 0) {
    return;
  }
  let runs: Array<{ conclusion?: string; url?: string }>;
  try {
    runs = JSON.parse(asked.stdout);
  } catch {
    return;
  }
  const newest = Array.isArray(runs) ? runs[0] : undefined;
  if (newest?.conclusion === "failure") {
    throw new Error(`The Mac half does not compile: the newest completed check on main failed — ${newest.url ?? "gh run list --workflow validate-macos.yml"}. No tag was made. Fix the Mac arm, land it, and release once that check is green.`);
  }
}

function commitArgs(signCommit: boolean, message: string): string[] {
  return signCommit
    ? ["commit", "-S", "-m", message]
    : ["-c", "commit.gpgsign=false", "commit", "--no-gpg-sign", "-m", message];
}

// The message is the commit's whole answer to "what is this", so an empty one is refused up front — before the repository is even entered, so nothing is staged for a commit that cannot be written.
function requireMessage(message: string, what: string): string {
  const named = message.trim();
  if (!named) {
    throw new Error(`A ${what} needs a message naming the work — the ticket name in plain words.`);
  }
  return named;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function ownedChanges(changed: string[], paths?: string[]): string[] {
  if (paths === undefined) return changed;
  const owned = new Set(paths.map(normalizePath));
  return changed.filter((path) => owned.has(normalizePath(path)));
}

function pathsFromEnvironment(): string[] {
  const raw = process.env[RELEASE_PATHS_ENV];
  if (!raw) throw new Error(`${RELEASE_PATHS_ENV} must name this pass's files as a JSON array.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${RELEASE_PATHS_ENV} must be a JSON array of repository paths.`);
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.some((path) => typeof path !== "string" || !path.trim())) {
    throw new Error(`${RELEASE_PATHS_ENV} must be a non-empty JSON array of repository paths.`);
  }
  return [...new Set(parsed.map((path) => normalizePath((path as string).trim())))];
}

// The work in this checkout, onto main, now: staged by name, committed and pushed, with no gate, no version and no tag. Nothing here is checked, which is the point — the gate runs after, in the release, and until then another session can pull this and work beside it. A clean tree is not a failure: it means the last landing already took everything, and the release goes on from there.
export function landWork(message: string, options: ReleaseOptions = { signCommit: true }): string[] {
  const named = requireMessage(message, "landing");
  const host = options.host ?? liveHost();
  host.enterRepoRoot();
  const changed = ownedChanges(host.changedPaths(), options.paths);
  if (!changed.length) {
    return [];
  }
  host.withPrivateIndex((env) => {
    required(host, "git", ["add", "--", ...changed], { env });
    required(host, "git", commitArgs(options.signCommit, named), { env });
  });
  // The shared index still points at the parent commit for these paths. Bring only this pass's entries forward; every other staged entry stays byte for byte as it was.
  required(host, "git", ["add", "--", ...changed]);
  required(host, "git", ["push", "origin", "HEAD"]);
  return changed;
}

export function prepareRelease(version: string, message: string, options: ReleaseOptions = { signCommit: true }): string {
  const named = requireMessage(message, "release");
  const host = options.host ?? liveHost();
  const normalized = normalizeVersion(version);
  const tag = `v${normalized}`;
  host.enterRepoRoot();
  if (host.packageVersion() !== normalized) {
    throw new Error(`Cargo.toml version does not match ${normalized}.`);
  }
  const releaseCommit = commitArgs(options.signCommit, `Release ${tag}: ${named}`);
  const tagArgs = options.signCommit
    ? ["tag", "-s", tag, "-m", `Release ${tag}`]
    : ["-c", "tag.gpgSign=false", "tag", "-a", "--no-sign", tag, "-m", `Release ${tag}`];
  // Read before the gate for one job only: a clean tree is refused here, rather than an hour later by the commit.
  const waiting = ownedChanges(host.changedPaths(), options.paths);
  assertSomethingToRelease(host, waiting);
  assertTagDoesNotExist(host, tag);
  // The whole release is inside the copy, so nothing it does can be reached without the gate that passed first. The old release path was two processes — check and tag, then push after the first had exited — which is why a push could outlive whatever the gate had read.
  host.withSnapshot((root) => {
    required(host, "just", ["verify"], { env: { ...process.env, [PLAN_ROOT_ENV]: root } });
    // After the gate, before anything is written: a stop here spends nothing.
    assertMacHalfCompiles(host);
    // Which release people are downloading right now, asked before anything is deleted: the new release does not exist until its build publishes, so this tag is the only complete download for the whole of that build and a failed build leaves it standing.
    const published = newestPublishedTag(host);
    // Read again, because the gate compiles and a compile rewrites `Cargo.lock` with the package's own version in it: staging the earlier list commits a bump whose lockfile still names the version before it, and both release builds pass `--locked`, so they die on their first command with the tag already up and nothing published under it. v1.15.4 went out that way. The gate is the only thing between the two reads, and every file it writes into this checkout is one the release is supposed to carry.
    const staging = ownedChanges(host.changedPaths(), options.paths);
    // Only now: a gate that stops here leaves the last released tag exactly where it was.
    retireOldTags(host, [tag, published]);
    host.withPrivateIndex((env) => {
      required(host, "git", ["add", "--", ...staging], { env });
      required(host, "git", releaseCommit, { env });
    });
    required(host, "git", ["add", "--", ...staging]);
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
  let treeReads = 0;
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
      // One release published, which is the state every release but the first meets. A case about the answer supplies its own.
      if (command === "gh" && args[0] === "release") return { status: 0, stdout: JSON.stringify([{ tagName: "v1.0.0" }]) };
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
    withPrivateIndex: (fn) => {
      record("private index created");
      try {
        fn({ GIT_INDEX_FILE: "/scratch/release-index" });
      } finally {
        record("private index removed");
      }
    },
    recordTag: (tag) => {
      record(`record ${tag}`);
    },
    // Work sitting in the checkout, waiting to be released: two paths, and a third once the gate has compiled. The lockfile carries the package's own version, so the tree a release stages is never the tree it was refused for being clean — a fixture answering the same list twice cannot tell whether the list was read again.
    changedPaths: () => {
      record("changed paths read");
      treeReads += 1;
      return treeReads > 1 ? ["Cargo.toml", "src/lib.rs", "Cargo.lock"] : ["Cargo.toml", "src/lib.rs"];
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

// git's own options come before the verb and these five carry their value as the next word, so the first plain word is the verb rather than the value. The same reading as the git gate's, for the same reason.
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const RELEASE_WRITES = new Set(["add", "commit", "tag", "push"]);

/// What no failure may ever reach — staging included, since the index is the release's own write as much as the commit is. A release writes its commit and tag behind `-c`, so nothing here may read the first word.
function isTagWork(call: string): boolean {
  const words = call.split(/\s+/).filter(Boolean);
  if (words[0] !== "git") return false;
  let at = 1;
  while (at < words.length && words[at]!.startsWith("-")) {
    at += GIT_VALUE_OPTIONS.has(words[at]!) ? 2 : 1;
  }
  return RELEASE_WRITES.has(words[at] ?? "");
}

/// The half of that a landing must never do: it commits and pushes main, and it has no business anywhere near a tag or a version.
const TAG_ONLY = /^git tag|--delete|^git push origin v/;

function selfTest(): void {
  const fails: string[] = [];

  // What every refusal below spends, proved on its own first: the public release is the unsigned form, and its commit and tag put `-c` in front of the verb.
  const writes = [
    "git add -- Cargo.toml src/lib.rs",
    "git -c commit.gpgsign=false commit --no-gpg-sign -m Release v1.2.3",
    "git commit -S -m Release v1.2.3",
    "git -c tag.gpgSign=false tag -a --no-sign v1.2.3 -m Release v1.2.3",
    "git tag -s v1.2.3 -m Release v1.2.3",
    "git tag -d v1.0.0",
    "git push origin HEAD",
    "git push origin v1.2.3",
    "git push origin --delete v1.0.0",
  ];
  for (const call of writes) {
    if (!isTagWork(call)) fails.push(`a refusal would not have noticed ${call}`);
  }
  const reads = [
    "git rev-parse --verify --quiet refs/tags/v1.2.3",
    "git ls-remote --exit-code --tags origin refs/tags/v1.2.3",
    "just verify",
    "changed paths read",
    "record v1.2.3",
  ];
  for (const call of reads) {
    if (isTagWork(call)) fails.push(`${call} was read as tag work, so a refusal fails on something that writes nothing`);
  }

  // A release that passes, in the order it is documented in: gate, then the old tags, then the commit, the tag, main, and the tag on its own.
  const clean = fixture((command, args) => {
    if (command === "gh" && args[0] === "release") return { status: 0, stdout: JSON.stringify([{ tagName: "v1.1.0" }]) };
    return args[0] === "tag" && args[1] === "-l" ? { status: 0, stdout: "v1.0.0\nv1.1.0\n" } : null;
  });
  const tag = prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: clean.host });
  if (tag !== "v1.2.3") fails.push(`a passing release answered ${tag} rather than its tag`);
  const at = (want: string) => clean.calls.findIndex((call) => call.includes(want));
  const order: Array<[string, number]> = [
    ["the work in the tree was read", clean.calls.indexOf("changed paths read")],
    ["the plan tree was copied", clean.calls.indexOf("snapshot taken")],
    ["the check suite ran", clean.calls.indexOf("just verify")],
    ["the Mac half's newest completed answer was read", at("gh run list --workflow validate-macos.yml")],
    ["the release people are downloading was named", at("gh release list")],
    ["the tree was read again, now the gate has written its lockfile into it", clean.calls.lastIndexOf("changed paths read")],
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
  // What the gate wrote is staged with the work it belongs to: the list read before the gate has no lockfile in it, so a release staging that one puts the bump on main with a lockfile naming the version before it and both builds refuse it.
  const treeReads = clean.calls.filter((call) => call === "changed paths read").length;
  if (treeReads !== 2) fails.push(`a release read the work in the tree ${treeReads} time(s): it is read once to refuse a clean tree and again after the gate to decide what to commit`);
  // By name, never the whole tree: a release commits the paths with work in them and nothing else the tree happens to be carrying.
  if (!clean.calls.includes("git add -- Cargo.toml src/lib.rs Cargo.lock")) fails.push(`a release did not stage the paths the gate left behind it: ${clean.calls.filter((call) => call.startsWith("git add")).join(", ") || "it staged nothing"}`);
  if (clean.calls.some((call) => /^git add (-A|--all|\.)(\s|$)/.test(call))) fails.push("a release staged the whole tree rather than the paths it read");
  // The commit says which version and which work, so the history answers what each release brought without opening it.
  if (!clean.calls.includes("git -c commit.gpgsign=false commit --no-gpg-sign -m Release v1.2.3: The find bar ships")) fails.push("a release commit did not carry the version and the name of the work");

  // The release people are downloading keeps its tag through the build, and everything else goes. The tag list here is the state a failed build leaves: a published v1.1.0, the v1.0.0 before it, and a v1.3.0 nobody ever published.
  const kept = fixture((command, args) => {
    if (command === "gh" && args[0] === "release") return { status: 0, stdout: JSON.stringify([{ tagName: "v1.1.0" }]) };
    return args[0] === "tag" && args[1] === "-l" ? { status: 0, stdout: "v1.0.0\nv1.1.0\nv1.3.0\n" } : null;
  });
  prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: kept.host });
  const deletedHere = kept.calls.find((call) => call.startsWith("git tag -d")) ?? "";
  const deletedThere = kept.calls.find((call) => call.includes("push origin --delete")) ?? "";
  for (const [where, call] of [["locally", deletedHere], ["on the remote", deletedThere]] as Array<[string, string]>) {
    if (!call) {
      fails.push(`a release deleted no tag ${where}, so the tag list grows until a push carrying more than three of them starts no build at all`);
      continue;
    }
    if (/\bv1\.1\.0\b/.test(call)) fails.push(`the published release's tag went ${where} before the new release existed, and every download address and the updater resolve through the latest release`);
    if (!/\bv1\.0\.0\b/.test(call)) fails.push(`the tag before the published one was kept ${where}, and only two tags may exist at a time`);
    // Version order would have kept this one and deleted the complete release underneath it, which is why the published release is read rather than sorted for.
    if (!/\bv1\.3\.0\b/.test(call)) fails.push(`a newer tag left by a failed build was kept ${where}, so the release chose its fallback by version rather than by what is published`);
  }

  // GitHub unable to name the published release: nothing is deleted, committed or pushed. Guessing here is what the only published download costs.
  const unreadable: Array<[string, CommandResult]> = [
    ["GitHub refusing the request", { status: 1, stdout: "" }],
    ["an answer nobody can read", { status: 0, stdout: "<html>502</html>" }],
    ["an answer that is not a list", { status: 0, stdout: "{}" }],
  ];
  for (const [state, said] of unreadable) {
    const blind = fixture((command, args) => (command === "gh" && args[0] === "release" ? said : null));
    const blindFailed = refused(() => prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: blind.host }));
    if (!blindFailed.includes("which release is published")) fails.push(`${state} did not stop the release: ${blindFailed || "it passed"}`);
    for (const call of blind.calls) {
      if (isTagWork(call)) fails.push(`${state} still ran ${call}`);
    }
    if (blind.calls.some((call) => call.startsWith("git tag -l"))) fails.push(`${state} still read the tag list, so the deletion was one answer away`);
    if (!blind.calls.includes("snapshot removed")) fails.push(`${state} left the plan copy behind`);
  }

  // A repository with nothing published yet: an empty list is an answer, not a failure, so the first release goes on and keeps only its own tag.
  const first = fixture((command, args) => {
    if (command === "gh" && args[0] === "release") return { status: 0, stdout: "[]" };
    return args[0] === "tag" && args[1] === "-l" ? { status: 0, stdout: "v1.0.0\n" } : null;
  });
  const firstStopped = refused(() => {
    const answered = prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: first.host });
    if (answered !== "v1.2.3") throw new Error(`it answered ${answered}`);
  });
  if (firstStopped) fails.push(`a repository with no published release stopped its release: ${firstStopped}`);
  if (!first.calls.includes("git tag -d v1.0.0")) fails.push("a repository with no published release kept a tag with no release under it");

  // The landing that goes first: the tree onto main in three writes, and nothing else at all.
  const landed = fixture();
  const paths = landWork("Fix the find bar", { signCommit: false, host: landed.host });
  if (paths.join(" ") !== "Cargo.toml src/lib.rs") fails.push(`a landing answered ${paths.join(" ") || "nothing"} rather than the paths it put on main`);
  const landedOrder: Array<[string, number]> = [
    ["the work in the tree was read", landed.calls.indexOf("changed paths read")],
    ["the paths were staged", landed.calls.indexOf("git add -- Cargo.toml src/lib.rs")],
    ["the work was committed", landed.calls.findIndex((call) => call.includes("commit --no-gpg-sign"))],
    ["main was pushed", landed.calls.indexOf("git push origin HEAD")],
  ];
  for (const [what, where] of landedOrder) {
    if (where < 0) fails.push(`a landing never reached the step where ${what}`);
  }
  for (let i = 1; i < landedOrder.length; i += 1) {
    const [before, beforeAt] = landedOrder[i - 1]!;
    const [after, afterAt] = landedOrder[i]!;
    if (beforeAt >= 0 && afterAt >= 0 && beforeAt > afterAt) fails.push(`${after} before ${before} in a landing`);
  }
  if (landed.calls.includes("just verify")) fails.push("a landing ran the gate, which is the hour it exists to get out in front of");
  if (landed.calls.includes("snapshot taken")) fails.push("a landing copied the plan tree, which only the gate reads");
  for (const call of landed.calls) {
    if (TAG_ONLY.test(call)) fails.push(`a landing ran ${call}, and a landing is not a release`);
  }
  if (landed.calls.some((call) => /^git add (-A|--all|\.)(\s|$)/.test(call))) fails.push("a landing staged the whole tree rather than the paths it read");
  // The landing commit is the message it was handed, so the history names the work rather than repeating one title.
  if (!landed.calls.includes("git -c commit.gpgsign=false commit --no-gpg-sign -m Fix the find bar")) fails.push("a landing commit did not carry the name of the work");

  // Another session's dirty paths never enter this pass's index, even when they were already staged in the shared checkout.
  const scoped = fixture();
  const scopedPaths = landWork("Fix the find bar", { signCommit: false, host: scoped.host, paths: ["src/lib.rs"] });
  if (scopedPaths.join(" ") !== "src/lib.rs") fails.push(`a scoped landing answered ${scopedPaths.join(" ") || "nothing"} rather than its own path`);
  if (!scoped.calls.includes("git add -- src/lib.rs")) fails.push(`a scoped landing staged ${scoped.calls.filter((call) => call.startsWith("git add")).join(", ") || "nothing"} rather than only its own path`);
  if (scoped.calls.some((call) => call.includes("Cargo.toml"))) fails.push("a scoped landing touched another session's path");
  const scopedAddEnv = scoped.envs[scoped.calls.indexOf("git add -- src/lib.rs")];
  const scopedCommitEnv = scoped.envs[scoped.calls.findIndex((call) => call.includes("commit --no-gpg-sign"))];
  if (scopedAddEnv?.GIT_INDEX_FILE !== "/scratch/release-index" || scopedCommitEnv?.GIT_INDEX_FILE !== "/scratch/release-index") fails.push("a scoped landing used the shared index, so another session's staged work could ride into its commit");
  const scopedAdds = scoped.calls.flatMap((call, at) => call === "git add -- src/lib.rs" ? [at] : []);
  if (scopedAdds.length !== 2 || scoped.envs[scopedAdds[1]!]?.GIT_INDEX_FILE !== undefined) fails.push("a scoped landing did not bring only its own entry in the shared index forward after the private commit");

  const scopedRelease = fixture();
  prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: scopedRelease.host, paths: ["src/lib.rs", "Cargo.lock"] });
  if (!scopedRelease.calls.includes("git add -- src/lib.rs Cargo.lock")) fails.push(`a scoped release staged ${scopedRelease.calls.filter((call) => call.startsWith("git add")).join(", ") || "nothing"} rather than only its own paths after the gate`);
  if (scopedRelease.calls.some((call) => call.startsWith("git add") && call.includes("Cargo.toml"))) fails.push("a scoped release staged another session's path");
  const scopedReleaseAddEnv = scopedRelease.envs[scopedRelease.calls.indexOf("git add -- src/lib.rs Cargo.lock")];
  const scopedReleaseCommitEnv = scopedRelease.envs[scopedRelease.calls.findIndex((call) => call.includes("commit --no-gpg-sign"))];
  if (scopedReleaseAddEnv?.GIT_INDEX_FILE !== "/scratch/release-index" || scopedReleaseCommitEnv?.GIT_INDEX_FILE !== "/scratch/release-index") fails.push("a scoped release used the shared index, so another session's staged work could ride into its commit");
  const scopedReleaseAdds = scopedRelease.calls.flatMap((call, at) => call === "git add -- src/lib.rs Cargo.lock" ? [at] : []);
  if (scopedReleaseAdds.length !== 2 || scopedRelease.envs[scopedReleaseAdds[1]!]?.GIT_INDEX_FILE !== undefined) fails.push("a scoped release did not bring only its own entries in the shared index forward after the private commit");

  // A landing or a release with no message: refused before the repository is touched, so a placeholder title can never reach the history.
  const unnamedLanding = fixture();
  const unnamedLandingFailed = refused(() => landWork("  ", { signCommit: false, host: unnamedLanding.host }));
  if (!unnamedLandingFailed.includes("naming the work")) fails.push(`a landing with no message was not refused: ${unnamedLandingFailed || "it passed"}`);
  if (unnamedLanding.calls.length) fails.push(`a landing with no message still ran ${unnamedLanding.calls.join(", ")}`);
  const unnamedRelease = fixture();
  const unnamedReleaseFailed = refused(() => prepareRelease("1.2.3", "", { signCommit: false, host: unnamedRelease.host }));
  if (!unnamedReleaseFailed.includes("naming the work")) fails.push(`a release with no message was not refused: ${unnamedReleaseFailed || "it passed"}`);
  if (unnamedRelease.calls.length) fails.push(`a release with no message still ran ${unnamedRelease.calls.join(", ")}`);

  // A landing with nothing to land: it says so by answering no paths, and it writes nothing. The release that follows carries on rather than stopping.
  const nothingToLand = fixture(() => null, { changedPaths: () => [] });
  const landedNothing = landWork("Fix the find bar", { signCommit: false, host: nothingToLand.host });
  if (landedNothing.length) fails.push("a landing with a clean tree claimed to have put something on main");
  for (const call of nothingToLand.calls) {
    if (isTagWork(call)) fails.push(`a landing with a clean tree still ran ${call}`);
  }

  // A clean tree: refused before the tag check and the gate, since the commit is otherwise the first thing to say so and it says it after the whole suite has run.
  const empty = fixture(() => null, { changedPaths: () => [] });
  const emptyFailed = refused(() => prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: empty.host }));
  if (!emptyFailed.includes("nothing to release")) fails.push(`a release with a clean tree was not told so: ${emptyFailed || "it passed"}`);
  if (empty.calls.includes("just verify")) fails.push("a release with a clean tree ran the whole gate before it could say so");
  if (empty.calls.includes("snapshot taken")) fails.push("a release with a clean tree copied the plan tree before being refused");
  for (const call of empty.calls) {
    if (isTagWork(call)) fails.push(`a release with a clean tree still ran ${call}`);
  }

  // The same empty state one step later: a release that committed and tagged, then failed its push. The tag it left is the one fact separating the two, and it must never go up again.
  const stopped = fixture(() => null, { changedPaths: () => [], tagsOnHead: () => ["v1.2.2"] });
  const stoppedFailed = refused(() => prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: stopped.host }));
  if (!stoppedFailed.includes("v1.2.2")) fails.push(`a release resuming after a failed push was not told which tag is already on the commit: ${stoppedFailed || "it passed"}`);
  if (!/bump the patch/i.test(stoppedFailed)) fails.push("a release resuming after a failed push was not told to bump the patch rather than push that tag again");
  if (stopped.calls.includes("just verify")) fails.push("a release resuming after a failed push ran the whole gate before it could say so");
  for (const call of stopped.calls) {
    if (isTagWork(call)) fails.push(`a release resuming after a failed push still ran ${call}`);
  }

  // A commit that fails: the release stops there, with nothing tagged and nothing pushed.
  const noCommit = fixture((command, args) => (command === "git" && args.includes("commit") ? { status: 1, stdout: "" } : null));
  const commitFailed = refused(() => prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: noCommit.host }));
  if (!commitFailed.includes("commit")) fails.push(`a failed commit did not stop the release: ${commitFailed || "it passed"}`);
  if (noCommit.calls.some((call) => /^git (tag -a|push)/.test(call))) fails.push("a release whose commit failed still tagged or pushed");

  // A gate that fails: nothing is committed, tagged or pushed, and the copy still goes.
  const broken = fixture((command) => (command === "just" ? { status: 1, stdout: "" } : null));
  const gateFailed = refused(() => prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: broken.host }));
  if (!gateFailed.includes("just verify")) fails.push(`a failed gate did not stop the release: ${gateFailed || "it passed"}`);
  for (const call of broken.calls) {
    if (isTagWork(call)) fails.push(`a failed gate still ran ${call}`);
  }
  if (broken.calls.some((call) => call.includes("tag -d") || call.includes("--delete"))) fails.push("a failed gate took down the last released tag");
  if (!broken.calls.includes("snapshot removed")) fails.push("a failed gate left its copy of the plan tree behind");
  if (broken.calls.some((call) => call.startsWith("gh run list"))) fails.push("a failed gate still asked GitHub for the Mac answer, which only a passed gate spends");
  if (broken.calls.some((call) => call.startsWith("gh release list"))) fails.push("a failed gate still asked which release is published, and a gate that stops deletes no tag to need it");

  // A red Mac check on main: the release stops after the gate with nothing written, naming the failed run, so the tag is never the first reader of a Mac arm again.
  const macRed = fixture((command, args) =>
    command === "gh" && args[0] === "run"
      ? { status: 0, stdout: JSON.stringify([{ conclusion: "failure", url: "https://github.com/example/runs/9" }]) }
      : null
  );
  const macFailed = refused(() => prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: macRed.host }));
  if (!macFailed.includes("Mac half does not compile")) fails.push(`a red Mac check on main did not stop the release: ${macFailed || "it passed"}`);
  if (!macFailed.includes("https://github.com/example/runs/9")) fails.push("a red Mac check did not name the run that failed");
  if (macRed.calls.indexOf("just verify") < 0) fails.push("a red Mac check was read before the gate ran, so the read spends nothing yet stopped a release the gate might have stopped better");
  for (const call of macRed.calls) {
    if (isTagWork(call)) fails.push(`a red Mac check still ran ${call}`);
  }
  if (!macRed.calls.includes("snapshot removed")) fails.push("a red Mac check left the plan copy behind");

  // GitHub silent, or no completed run yet: neither stops anything, because a release never waits on a build.
  const macQuiet: Array<[string, CommandResult]> = [
    ["GitHub not answering", { status: 1, stdout: "" }],
    ["no completed run yet", { status: 0, stdout: "[]" }],
  ];
  for (const [state, answerSaid] of macQuiet) {
    const quiet = fixture((command, args) => {
      if (command === "gh" && args[0] === "run") return answerSaid;
      return args[0] === "tag" && args[1] === "-l" ? { status: 0, stdout: "v1.0.0\n" } : null;
    });
    const quietTag = refused(() => {
      const answered = prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: quiet.host });
      if (answered !== "v1.2.3") throw new Error(`answered ${answered}`);
    });
    if (quietTag) fails.push(`${state} stopped a release, and a release never waits on a build: ${quietTag}`);
  }

  if (landed.calls.some((call) => call.startsWith("gh run list"))) fails.push("a landing asked GitHub for the Mac answer, and a landing is not a release");
  if (landed.calls.some((call) => call.startsWith("gh release list"))) fails.push("a landing asked which release is published, and a landing deletes no tag");

  // Nothing the release does may outlive the plan copy the gate read: the old path was two processes, and the push in the second one had no copy behind it at all.
  const outside = clean.calls.indexOf("snapshot removed");
  for (let i = outside + 1; i < clean.calls.length; i += 1) {
    if (isTagWork(clean.calls[i]!)) fails.push(`${clean.calls[i]} ran after the plan copy had gone`);
  }

  // A plan tree that will not hold still: the gate never runs, so no tag work can follow it.
  const moving = fixture(() => null, {
    withSnapshot: () => {
      throw new Error("the plan tree changed every time it was copied");
    },
  });
  const movingFailed = refused(() => prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: moving.host }));
  if (!movingFailed.includes("changed every time")) fails.push(`a moving plan tree did not stop the release: ${movingFailed || "it passed"}`);
  if (moving.calls.includes("just verify")) fails.push("a release checked itself against a plan tree that would not hold still");
  for (const call of moving.calls) {
    if (isTagWork(call)) fails.push(`a release with no plan copy still ran ${call}`);
  }

  // The refusals that come before any of it.
  const mismatched = fixture(() => null, { packageVersion: () => "9.9.9" });
  if (!refused(() => prepareRelease("1.2.3", "The find bar ships", { signCommit: false, host: mismatched.host })).includes("does not match")) {
    fails.push("a release ran with a version the package does not carry");
  }
  if (mismatched.calls.includes("snapshot taken")) fails.push("a wrong version copied the plan tree before being refused");
  for (const call of mismatched.calls) {
    if (isTagWork(call)) fails.push(`a wrong version still ran ${call}`);
  }

  if (refused(() => normalizeVersion("not-a-version")) === "") fails.push("a version that is not one was accepted");

  if (fails.length) {
    console.error("prepare-release: failed");
    for (const line of fails) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("prepare-release: ok (every commit carries the message naming its work, and a landing or release handed a blank one is refused before the repository is touched; a landing puts only this pass's named paths on main, using an index of its own so another session's staged work stays out, reaching no gate, no plan copy and no tag, and writing nothing when its owned set is clean; one command from the gate to the push, all of it inside a still copy of the plan tree; the work in the tree is read once to refuse a clean owned set and again after the gate, with both readings filtered through the same path list and the release commit using that private index too; the old tags go only after the gate passes, keeping the new tag and the tag of the release people are downloading while a newer tag left by a failed build goes with the rest, and a GitHub that cannot name the published release stops everything rather than guessing, while a repository with nothing published carries on; the newest completed Mac answer on main is read after the gate and a failed one stops the release naming its run before any tag work, while GitHub silent or no run yet stops nothing; a failed gate, a moving tree, a clean owned set or a wrong version reaches no tag cleanup, staging, commit, tag or push, and a release meeting the empty owned set an earlier one left names the tag already on the commit and says to bump the patch; and those refusals read the verb behind git's own options, so the unsigned commit and tag a public release writes are seen)");
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const signCommit = !process.argv.includes("--no-sign-commit");
  // The message arrives as the plain words after the flags — `just` hands each word through on its own, so they are joined back here rather than asked for as one quoted value.
  const words = process.argv.slice(2).filter((word) => !word.startsWith("--"));
  if (process.argv.includes("--check")) {
    selfTest();
  } else if (process.argv.includes("--land")) {
    const landed = landWork(words.join(" "), { signCommit, paths: pathsFromEnvironment() });
    console.log(landed.length ? `landed on main: ${landed.join(" ")}` : "nothing to land: none of this pass's files have work sitting in them.");
  } else {
    const [version, ...rest] = words;
    if (!version) {
      throw new Error("Usage: node --experimental-strip-types scripts/prepare-release.mts <version> <message> [--no-sign-commit], or --land <message> to put the tree on main first.");
    }
    prepareRelease(version, rest.join(" "), { signCommit, paths: pathsFromEnvironment() });
  }
}
