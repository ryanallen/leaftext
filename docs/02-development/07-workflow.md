# Workflow

> How a change moves through this repo: the plan it starts as, the skills that carry it, the test every phase owes, and the gate it passes before it ships.

Work here starts as a written plan and ends as a released version, and the same path is followed by a person or an agent. The steps are kept as **skills** — one folder each under `.agents/skills/`, read by whatever is doing the work. A skill is typed with the host's own sign — `/ticket` in Claude, `$ticket` in Codex — and both spellings are accepted wherever one is read. `AGENTS.md` at the repo root is the standing guide they sit under, and it is where a rule that already cost a version number is written down.

## The order

**1. Plan it.** `/ticket` writes a Markdown plan — why, what was measured with the line it came from, how it is built, and phases with a checkbox per piece of work. Plans live in the `docs/` folder beside this repo, not in the published site.

**2. Read the plan against the code.** `/design` opens every line the plan cites, holds it against the rules that already cost a version number, fixes what is wrong in the file, and signs the top with a date. It never edits app code.

**3. Rank it.** `/pm` puts every live plan into one running order — what is wrong today first, then what other plans are waiting on it, then cost.

**4. Build it.** `/dev` works the phases in order and ticks each box in the same edit as its code and its test. A change that moves something on the screen is proved by sampled positions rather than by classes — see [the motion probe](02-building.md#driving-the-copy-you-already-have-open).

**5. Gate it.** `/check` runs `/sync-tests` and then `just verify`. Tests come first because `just verify` only runs the tests that exist — a change with no test passes it and proves nothing.

**6. Ship it, then close it.** `/git-release` is the only step that writes git. `/done` retires the plan afterwards, on the owner's word alone.

## Every phase says how it is proved

**A phase carries at least one test box, and the box names where the test goes.** Nothing in the build asks whether a change made a test necessary, so the plan is where that question is answered — and a phase with no test box is code shipped with nothing that would have caught it going wrong.

- A test box names the claim, not the function: *a comment on its own line leaves every other block editable*, in the file it goes in.
- A fix names the test after **what went wrong**, so the same regression cannot ship twice.
- A phase whose only work is a row in `design/` asks for no test — the [design-system checks](05-design-system.md) already refuse anything those files do not list.
- What genuinely cannot be tested here — a real window, live selected text, a held pointer — is said in the phase, so a missing test is not read as an oversight.

**Anything a pass turns up that is not the plan's own becomes its own plan.** Reading the code to write, design, build or rank one is what finds something else — a bug beside the one being fixed, a rule nothing enforces, a subject with no tests. The test is scope, not size: a find belongs to the plan in hand when a phase already in it would have to build it anyway, and otherwise it is a second file, written in the same pass and ranked with the rest. A one-line fix out of scope is still its own plan, because what makes it one is the record rather than the cost — a plan about the find bar carrying a pager fix is a diff nobody can review, and a finding left in a hand-back dies with the session.

**A plan carrying two jobs is split, the same way a blocked one is.** Each half keeps its own name and its own row, and the two point at each other. Splitting on size is otherwise nobody's call, so a plan that is really two ships half and never closes.

## Where a test goes

| What changed | Where its test lives |
|:--|:--|
| `src/**.rs` — the library | `src/tests/`, one file per subject, with the shared helpers in `mod.rs` |
| `src/app/**.rs` — the binary | `src/app/tests.rs` |
| `src/platform.rs`, `journal.rs`, `pipe.rs`, `single_instance.rs` | `src/app/tests.rs` as well. These sit beside the library's files and belong to the binary, so nothing in `src/tests/` can see them — the file's folder does not tell you which crate it is in, `main.rs`'s own `mod` lines do |
| `src/store/**.rs` | `src/store/tests.rs` |
| `installer/**.rs` — the Windows EXE installer | `installer/src/tests.rs`, run by `just check-installer`. It installs nothing: the plan is data, and the one test that writes drives a scratch folder and a scratch registry key and removes both |
| `src/assets/shell/*.js` — the page's script | `scripts/check-shell.mjs`, which boots the fragments in order against a stand-in page |
| `web/preview/host.js` — the browser's own host | `scripts/check-shell.mjs` as well, which boots it over a stand-in module in that same page. A new command also owes a row in the host's own table, which `just check-web-commands` refuses the build without |
| `site/*.js` and `docs/docs.js` — what draws the published pages | `scripts/check-site-boot.mjs`, which boots both entry readers and everything they import against a stand-in page, fetch and renderer module, and reads the page each one finished |
| `reading.css`, `src/theme.rs`, `themes/` | `src/tests/reading_css.rs`, `src/tests/theme_registry.rs`, and `just check-themes` |
| A new class, component, token or icon | No test to write — `just check-classes`, `check-tokens`, `check-icons` and `check-gallery` refuse what `design/` does not list |
| A new `scripts/*.mjs` | Its own `--check` mode, plus a line in `just verify` — `check-verify` fails on a check the suite does not run |
| A test that writes outside the repo | Anywhere above, but the name it writes under carries the run's own process id. Two people running the suite at once on one checkout share every fixed name, and `just check-scratch-names` refuses one |

A test is named as a sentence about behavior — `a_staged_update_installs_itself_at_launch_but_only_once` — and tests the rule rather than the implementation, so a rewrite that changed nothing a reader sees does not fail it. See [Building](02-building.md#verification-suite) for what the suite runs and how to run one step of it.

## The skills

| Skill | What it does |
|:--|:--|
| `/ticket` | Writes a plan, files it under the right subject, and adds its row to the index |
| `/design` | Reads a plan against the code, fixes it, dates it, and records what was wrong |
| `/pm` | Ranks every live plan into one running order |
| `/dev` | Builds a plan's phases in order and stops at the owner's own box |
| `/check` | The gate: tests first, then `just verify`. A failure is fixed and re-run, never explained past |
| `/sync-tests` | Names the test covering each change, writes the missing ones, says what cannot be tested |
| `/sync-docs` | Makes these pages match the app, takes the screenshots they ask for, regenerates the crawler files |
| `/code-comments` | A quality pass over comments only — why rather than what, and no drafting history |
| `/git-release` | The only step that writes git: version bump, commit, tag, push |
| `/done` | Retires a plan on the owner's word, at any stage |
| `/design-tokens` | Changes a color, value, icon or component in `design/` and runs the bundlers |
| `/shell-fragment` | Adds, splits or reorders a file in `src/assets/shell/`, where order is load-bearing |
| `/add-format` | Teaches the app another readable file type from the one table of formats |
| `/add-dependency` | Weighs a crate before it ships: what it drags in, and what the platform already offers |
| `/workspace` | Where a session's own private copy of the app comes from, how a finished result is handed over on a branch of its own, and how one is applied to the shared copy |

Six hooks back the parts of this that are worth failing rather than remembering — they print the standing rules before each message, write down the steps of the skill a message names, put the session in a private copy of the app, refuse a git write without an explicit release, hold a reply to the repo's own rules about how it is written, and prove those rules were read rather than recalled. `just verify` self-tests all six. Each record they keep belongs to one session, so two people working the same checkout cannot spend each other's release, clear what the other has read, or be held to the other's steps; a machine where no session can be identified is refused every git write rather than let through.

## Two at once

The code is not shared between two sessions working at the same time. Before a message that names a skill which changes code is even read, a hook gives that session a private worktree of the app, at the same path shape the ordinary checkout has, and tells the agent where it is. Nobody types a command for this, and a session only ever makes its own. Two sessions therefore keep their own source, their own staged changes and their own build folder, which is what a shared checkout could not do: one build held the other, and one release staged the other's files.

**The plan folder beside this repo is deliberately not copied.** A session writes its plan where the person reading it reads it, so the boxes tick and the status turns on a screen already open rather than inside a folder nobody else can reach — a build that took half an hour used to show an untouched plan for the whole of it. Two sessions writing one running order at the same time is what that costs, and a claim answers it: a session asks for the file and gets a copy back with the fingerprint the file had, nothing held while the row is written, and the claim is taken for the write alone — a copy taken before somebody else's row landed is refused rather than written over it, and kept where it is so the row is redone from it. Nothing renews a claim while an agent edits, which is why no hold spans one. A session that meets the claim waits for the run holding it rather than for a stopwatch, and one left behind by a run that was killed is taken over instead of wedging the next session.

A finished result leaves that copy as a **handoff**: one commit on a branch of that session's own, on top of the revision the copy was cut from, never pushed, never tagged, with the version left alone. A release begun in another session lists the recorded copies, then explicitly names the session whose loose work it is handing over; it never chooses one by itself, because a record does not say whether that session is still editing. Applying one to the shared copy is a separate step that takes a reservation so only one arrives at a time — a second waits for the one holding it rather than being refused, and one a killed run left behind is taken over after the same two minutes the running order's claim uses — reads the base and the changed paths off that branch, refuses a result written on an older revision or overlapping work already sitting there, and applies its diff through a recovery journal — so a run that fails or is killed puts the copy back rather than leaving it half-written. It leaves the shared copy dirty on purpose: what arrived is read, and then the public release below is made from there. That release refuses to run from a private copy at all.

**A result another session's release overtakes has a way back.** The older-revision refusal above is correct — applying an old diff over a shared copy that has moved can lose work silently — and its answer is never a fresh copy, which is cut at the revision the shared copy is on now and therefore holds none of the finished work. The one commit is replayed onto that revision instead, keeping the work and keeping it to one commit, after which the base test passes and it is applied as normal. A replay is refused where the branch carries no result, where it already sits on the current revision, and where the session's copy holds work nobody handed over, since that work would be left behind. Where the two revisions really disagree about a file, the replay stops in that session's own copy with the files named and its branch untouched; they are settled there and the same step carries on, and it refuses to carry on over a file still holding the marks of the disagreement.

The step list is the newest of them. A skill writes its own order as numbered headings, and the prompt hook copies that skill's steps into a list for the turn before the message is read; the reply hook then refuses to end the turn while one is un-struck, so a step cannot be skipped or reordered by a memory that drops whichever one came last. The skill file stays the only copy of its order, a skill that numbers nothing writes no list, and a step that genuinely does not apply is struck with the reason. **The list holds steps, never work** — work is a plan's boxes, which outlive the session, while a step dies with the message. The reply hook grew the same way: it refuses the phrases the rules name for themselves, including an answer walked back by a later "but" and a sentence handing a filing back to the owner where nothing was filed, and it strips quoted material first so a reply naming a rule is not refused for the words it is quoting.
