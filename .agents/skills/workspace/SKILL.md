---
name: workspace
description: Give one agent session a private copy of the Leaftext app, so two agents at once cannot take each other's builds, indexes or releases. The plan tree stays the owner's, so the boxes and the status move where they can watch. Use when the owner wants a second agent started, asks where a session's private copy is, or wants one taken down.
disable-model-invocation: true
argument-hint: "[create | path | list | remove]"
user-invocable: true
---

# Workspace

`leaftext/` is two repositories, and only one of them is copied. The nested Leaftext repository owns the app at `leaftext/app/`, which Studio's own `.gitignore` refuses to track, and a session gets a worktree of it under plain folders at the same `leaftext/app` path shape the primary checkout has — so nothing a session runs needs to know it is in one. Sharing that is what let one session's build hold another's, one version bump ride out on another's release, and one release stage another's files.

**The plan tree is not copied and never was worth copying.** The private Studio work repository owns `leaftext/docs/`, and a session writes it where the owner reads it: the boxes tick and the status turns on the screen they already have open, so a build half an hour long can be watched rather than asked about. Two sessions writing one running order is the whole cost, and re-deriving it settles that on the next pass.

**Nobody types any of this.** `scripts/gate-workspace.mjs` runs before every message that names a skill which changes code: it makes this session's copy if there is none, and tells the agent where the app is and where the owner's plan tree is. A message naming a skill that only writes the plan — `/ticket`, `/pm`, `/design` — gets no copy, because there is nothing to keep apart. The one command still gated is `private`, which commits — `scripts/gate-git.mjs` names it beside `prepare-release`, because this gate reads a command string and cannot see the git a script spawns.

## Process

### 1. Know which copy you are in

The hook says, at the top of the turn: the app folder that is yours, and the plan tree that is the owner's. Open every app file by its full path there and run every command with that app folder as the working directory. Where it says this session has no copy, work where you are and say so when handing back.

### 2. Make the copy, where something has to make one by hand

    node scripts/agent-workspace.mjs create

It prints the app worktree and the plan tree it answers, records the base revision beside it, and puts it on a branch named for the session. A copy is cut at the revision the primary copy is on, so work sitting uncommitted there is said out loud and left behind rather than carried in — the overlap check at submit time is what keeps two sessions off one file.

### 3. Find one, or list them all

    node scripts/agent-workspace.mjs path
    node scripts/agent-workspace.mjs list

`path` answers for the session it is run in; `list` answers for every managed workspace under the private parent.

### 4. Submit one handoff from the primary copy

    node scripts/agent-workspace.mjs submit <session>

Run from the primary checkout, never from a workspace. It takes the primary reservation so only one handoff is applied at a time, reads the base and the changed paths off the session's branch, checks that base against the primary copy, refuses one that overlaps work already sitting there, and applies the diff through a recovery journal — so a submit that fails or is killed puts the root back rather than leaving it half-written.

**It leaves the primary app copy dirty on purpose.** Nothing here commits, tags or pushes: read what arrived, then make the public release with `/git-release`, which runs the whole check suite over it first. The plan half needs no submit — it is already in the copy the owner reads.

### 5. Write the running order under its claim

    node scripts/agent-workspace.mjs plan-open
    node scripts/agent-workspace.mjs plan-close

`plan-open` hands back a copy of `../docs/PLAN.md`; edit that copy, then `plan-close` writes it back. **Nothing is held while the copy is open.** A claim across an agent's edit is one nothing is running to renew — the command exits the moment it hands the copy back — so a hold that long is one the next session takes over, leaving the first with an edit nobody reads again. What decides the write instead is the fingerprint the copy was taken at, the same test the app runs on a document written through its own pipe: `plan-close` takes the claim for the read, the test and the write alone, and a copy taken before another session's row landed is refused with where that copy still is, so the row is redone from it rather than lost. **A lock file on its own binds nobody**, which is why the pair does the reading and the writing rather than merely marking the file. A session that meets the claim waits for the run holding it rather than for a stopwatch, and takes over one a killed run left behind after two minutes. Every skill that writes a row or a status names this: [`/pm`](../pm/SKILL.md), [`/design`](../design/SKILL.md), [`/dev`](../dev/SKILL.md), [`/git-release`](../git-release/SKILL.md) and [`/done`](../done/SKILL.md).

### 6. Take it down when the work has landed

    node scripts/agent-workspace.mjs remove

The branch stays — a private handoff is the commit on it.

## Where things are

The private parent is `~/.leaftext-workspaces`, outside every repository on purpose: Studio work sits inside the Studio tree, which is a repository too, so a parent under either of them would leave a whole workspace as untracked noise in somebody else's status. `LEAFTEXT_WORKSPACES` moves it, which is how the self-test points at a folder of its own.

`planTree()` beside it is the one answer to where the plan tree is, for a command running in either copy: a worktree shares the primary's git directory, so the folder holding that directory is the app the owner reads and the tree beside it is theirs. The six checks that read `../docs` — docs, plan, spelling, wrapping, box-drawing and the learn snapshots — ask it rather than resolving a path beside themselves, where a session's copy has nothing at all.

`just check-workspace` proves the three things a shared checkout got wrong — the app source, the index and the build folder each belonging to one session — that a box ticked in a copy lands in the owner's plan tree, then carries two handoffs through to the primary app copy, refuses an overlapping third, and puts the root back after an interrupted one. It ends on the running order: two sessions writing a status one at a time, a claim a killed run left behind taken over, a session waiting out the run holding it rather than a stopwatch, two copies open at once with nothing held between them, and a copy taken before somebody else's row refused and kept where it is. All of it on throwaway repositories; it never touches the real copy.

<!-- keycode: LEAF-4B7E -->
