---
name: workspace
description: Give one agent session a private pair of worktrees — a Studio worktree carrying the plan tree, and a Leaftext app worktree inside it — so two agents at once cannot take each other's plan edits, builds or releases. Use when the owner wants a second agent started, asks where a session's private copy is, or wants one taken down.
disable-model-invocation: true
argument-hint: "[create | path | list | remove]"
user-invocable: true
---

# Workspace

`leaftext/` is two repositories. The private Studio work repository owns the plan tree at `leaftext/docs/`; the nested Leaftext repository owns the app at `leaftext/app/`, which Studio's own `.gitignore` refuses to track. Sharing either is what lets one session's build hold another's, and one session's ranking pass reset another's status. A workspace is both halves at once: a Studio worktree under the private parent, and a Leaftext worktree at that tree's ignored `leaftext/app/` path — the same path shape the primary checkout has, so nothing a session runs needs to know it is in one.

**Nobody types any of this.** `scripts/gate-workspace.mjs` runs before every message that names a skill which changes something: it makes this session's pair if there is none, and tells the agent where both halves are. The owner calls the skills they already call and the copy is simply there. The one command still gated is `private`, which commits and pushes a handoff — `scripts/gate-git.mjs` names it beside `prepare-release`, because this gate reads a command string and cannot see the git a script spawns.

## Process

### 1. Know which copy you are in

The hook says, at the top of the turn: the app folder and the plan tree beside it. Open every file by its full path there and run every command with that app folder as the working directory. Where it says this session has no copy, work where you are and say so when handing back.

### 2. Make the pair, where something has to make one by hand

    node scripts/agent-workspace.mjs create

It prints the Studio worktree and the app worktree inside it, records both base revisions beside them, and puts both halves on one branch named for the session. A copy is cut at the revision the primary copy is on, so work sitting uncommitted there is said out loud and left behind rather than carried in — the overlap check at submit time is what keeps two sessions off one file.

### 3. Find one, or list them all

    node scripts/agent-workspace.mjs path
    node scripts/agent-workspace.mjs list

`path` answers for the session it is run in; `list` answers for every managed workspace under the private parent.

### 4. Submit one handoff from the primary copy

    node scripts/agent-workspace.mjs submit <session>

Run from the primary checkout, never from a workspace. It takes the primary reservation so only one handoff is applied at a time, checks the handoff's recorded plan and app revisions against the primary copies, refuses one that overlaps work already sitting there, and writes both halves through a recovery journal — so a submit that fails or is killed puts both roots back rather than leaving them half-written.

**It leaves both primary copies dirty on purpose.** Nothing here commits, tags or pushes: read what arrived, then make the public release with `/git-release`, which runs the whole check suite over it first.

### 5. Take it down when the work has landed

    node scripts/agent-workspace.mjs remove

The app worktree goes first because it sits inside the Studio one, and both branches stay — a private handoff is what is on them.

## Where things are

The private parent is `~/.leaftext-workspaces`, outside every repository on purpose: Studio work sits inside the Studio tree, which is a repository too, so a parent under either of them would leave a whole workspace as untracked noise in somebody else's status. `LEAFTEXT_WORKSPACES` moves it, which is how the self-test points at a folder of its own.

`just check-workspace` proves the four things a shared checkout got wrong — the plan tree, the app source, the index and the build folder each belonging to one session — then carries two handoffs through to a primary pair, refuses an overlapping third, and puts both roots back after an interrupted one. All of it on throwaway repositories; it never touches the real pair.

<!-- keycode: LEAF-4B7E -->
