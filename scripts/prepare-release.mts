import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isManaged } from "./agent-workspace.mjs";

type ReleaseOptions = { signCommit: boolean };
type CommandResult = { status: number; stdout: string };
const versionPattern = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function run(command: string, args: string[], inherit = true): CommandResult {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: inherit ? "inherit" : "pipe" });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status ?? 1, stdout: typeof result.stdout === "string" ? result.stdout : "" };
}

function runRequired(command: string, args: string[], inherit = true): string {
  const result = run(command, args, inherit);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
  return result.stdout.trim();
}

function normalizeVersion(version: string): string {
  const normalized = version.trim().replace(/^v/, "");
  if (!versionPattern.test(normalized)) {
    throw new Error("Release version must look like 0.1.0, v0.1.0, or 0.1.0-beta.1.");
  }
  return normalized;
}

function packageVersion(): string {
  const match = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync("Cargo.toml", "utf8"));
  if (!match) {
    throw new Error("Could not find package.version in Cargo.toml.");
  }
  return match[1] ?? "";
}

function assertCleanWorkingTree(): void {
  const status = runRequired("git", ["status", "--porcelain"], false);
  if (status) {
    throw new Error("Working tree must be clean before releasing. Commit or stash changes first.");
  }
}

// A public release is the primary copy's alone. A managed workspace hands its work over privately instead, or two agents tag and push over each other from copies neither of them can see.
function assertPrimaryCheckout(): void {
  if (isManaged(process.cwd())) {
    throw new Error("A public release runs in the primary checkout. This is a managed workspace: hand the work over with `node scripts/agent-workspace.mjs private`, then submit the handoff from the primary copy.");
  }
}

function assertTagDoesNotExist(tag: string): void {
  if (run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], false).status === 0) {
    throw new Error(`Local tag ${tag} already exists.`);
  }
  if (run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], false).status === 0) {
    throw new Error(`Remote tag ${tag} already exists on origin.`);
  }
}

export function prepareRelease(version: string, options: ReleaseOptions = { signCommit: true }): string {
  const normalized = normalizeVersion(version);
  const tag = `v${normalized}`;
  process.chdir(runRequired("git", ["rev-parse", "--show-toplevel"], false));
  assertPrimaryCheckout();
  if (packageVersion() !== normalized) {
    throw new Error(`Cargo.toml version does not match ${normalized}.`);
  }
  assertCleanWorkingTree();
  assertTagDoesNotExist(tag);
  runRequired("just", ["verify"]);
  const commitArgs = options.signCommit
    ? ["commit", "-S", "-m", `Release ${tag} [release-prep]`]
    : ["-c", "commit.gpgsign=false", "commit", "--no-gpg-sign", "-m", `Release ${tag} [release-prep]`];
  runRequired("git", commitArgs);
  const tagArgs = options.signCommit
    ? ["tag", "-s", tag, "-m", `Release ${tag}`]
    : ["-c", "tag.gpgSign=false", "tag", "-a", "--no-sign", tag, "-m", `Release ${tag}`];
  runRequired("git", tagArgs);
  writeFileSync(".release-tag", tag);
  return tag;
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const version = process.argv[2];
  const signCommit = !process.argv.includes("--no-sign-commit");
  if (!version) {
    throw new Error("Usage: node --experimental-strip-types scripts/prepare-release.mts <version> [--no-sign-commit]");
  }
  prepareRelease(version, { signCommit });
}
