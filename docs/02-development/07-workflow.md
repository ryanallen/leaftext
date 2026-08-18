# Workflow

> How a change moves through this repo: the plan it starts as, the skills that carry it, the test every phase owes, and the gate it passes before it ships.

Work here starts as a written plan and ends as a released version, and the same path is followed by a person or an agent. The steps are kept as **skills** — one folder each under `.agents/skills/`, read by whatever is doing the work. A skill is typed with the host's own sign — `/ticket` in Claude, `$ticket` in Codex — and both spellings are accepted wherever one is read. `AGENTS.md` at the repo root is the standing guide they sit under, and it is where a rule that already cost a version number is written down.

## The order

**1. Plan it.** `/ticket` writes a Markdown plan — why, what was measured with the line it came from, how it is built, and phases with a checkbox per piece of work. Plans live in the `docs/` folder beside this repo, not in the published site.

**2. Read the plan against the code.** `/design` opens every line the plan cites, holds it against the rules that already cost a version number, fixes what is wrong in the file, and signs the top with a date. It never edits app code.

**3. Rank it.** `/pm` puts every live plan into one running order — what is wrong today first, then what other plans are waiting on it, then cost.

**4. Build it.** `/dev` works the phases in order and ticks each box in the same edit as its code and its test. A change that moves something on the screen is proved by sampled positions rather than by classes — see [the motion probe](02-building.md#driving-the-copy-you-already-have-open).

**5. Gate it.** `/check` runs `/sync-tests` and then `just verify`. Tests come first because `just verify` only runs the tests that exist — a change with no test passes it and proves nothing.

**6. Ship it, then close it.** `/git-release` is the only step that writes git, and its first act is to put the work in the tree onto `main` — unchecked, on purpose, so it stops sitting in a checkout while the docs, the comments and the whole suite run. The release commit that follows carries whatever those write. **Only a change somebody running the app can meet gets a version number and a tag** — the skills, the hooks, the checks and every script but one sit in the same checkout as the app and are not the app, so they land and stop. The exception is the script that builds the release binary and packages both Windows installers: a reader runs what it made, so it takes a number like the code inside it. A release workflow holds both kinds at once and is read by which step moved: every step up to and including the one that makes the installers takes a number, and every step after the installers exist — making the release, uploading them, clearing the old ones — takes none. `/done` retires the plan afterwards, on the owner's word alone.

## Every phase says how it is proved

**A phase carries at least one test box, and the box names where the test goes.** Nothing in the build asks whether a change made a test necessary, so the plan is where that question is answered — and a phase with no test box is code shipped with nothing that would have caught it going wrong.

- A test box names the claim, not the function: *a comment on its own line leaves every other block editable*, in the file it goes in.
- A fix names the test after **what went wrong**, so the same regression cannot ship twice.
- A phase whose only work is a row in `design/` asks for no test — the [design-system checks](05-design-system.md) already refuse anything those files do not list.
- What genuinely cannot be tested here — a real window, live selected text, a held pointer — is said in the phase, so a missing test is not read as an oversight.

**The last box in a plan is the owner's, and nothing but the owner ticks it.** It sits under its own heading at the end of the phases and holds the gesture they make to see the thing, written in what they will look at rather than as "confirm it works"; a subject with genuinely nothing to press strikes the box with that reason. `/dev` stops there, `/git-release` refuses a plan whose one open box sits anywhere else, and `just check-docs` fails on a live plan with no such heading from the day it is written — because without one a plan goes fully ticked on machine work alone, and the report that finds a plan finished then asks for it to be filed as shipped before anybody has looked at it. The same check holds the heading to its place, the last `###` inside `## Phases`, and refuses a box opening `The owner ` written outside it — a gesture left under the line every phase ends with is one nobody looks for, and it is the one open box a plan is then stopped on at the end of its last phase.

**A box struck through is neither open nor ticked.** Striking is how the tree retires a box whose work moved to another plan or changed shape: the line stays so nobody re-plans it, and it is not work left and not evidence, so `just check-docs` and `/git-release` both count past it. The strike has to be the first thing after the checkbox — one part way along a line is a box whose wording changed, and it is still open — and it has to close, since `~~moved` with no second pair draws as ordinary text with two tildes in front of it, so counting it as retired would drop a box a person can still see. **The reason the work is not happening goes on the same line, after the closing pair**, and `just check-docs` fails on a struck box with nothing after it: a struck box is out of every count that decides when a plan is finished, so that sentence is the only record the work existed. Inside the strike does not count — a bare strike is the original box text crossed out, so nothing can tell the two apart. A struck owner's box is an owner who answered, which is the shape a plan with nothing to press is written in.

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
| `/git-release` | The only step that writes git: the tree onto `main` first, then version bump, commit, tag, push |
| `/done` | Retires a plan on the owner's word, at any stage |
| `/design-tokens` | Changes a color, value, icon or component in `design/` and runs the bundlers |
| `/shell-fragment` | Adds, splits or reorders a file in `src/assets/shell/`, where order is load-bearing |
| `/add-format` | Teaches the app another readable file type from the one table of formats |
| `/add-dependency` | Weighs a crate before it ships: what it drags in, and what the platform already offers |

Five hooks back the parts of this that are worth failing rather than remembering — they print the standing rules before each message, write down the steps of the skill a message names, refuse a git write — and anything that puts the installers out — without an explicit release, hold a reply to the repo's own rules about how it is written, and prove those rules were read rather than recalled. `just verify` self-tests all five. Each record they keep belongs to one session, so a machine running two at once cannot spend the other's release, clear what the other has read, or hold it to the other's steps; a machine where no session can be identified is refused every git write rather than let through.

## One at a time

One session works this checkout, and it works the checkout in front of it: the code, the plan folder beside it and the release are all in one place, with nothing private and nothing handed over. That is what lets the boxes tick and the status turn on a screen already open rather than inside a folder nobody else can reach.

Two sessions at once was built and taken back out. Each got a private worktree of the app, and a finished result was committed on a branch of its own and applied to the shared copy through a reservation and a recovery journal. It never converged, because the thing two sessions really collide over is the one plan folder — which is shared on purpose, and which no copy and no branch can merge: two rewrites of one ranked list are not a merge. What it did cost was ten releases in a row about the copies themselves and thirty unretired worktrees on one machine.

The step list is the newest of them. A skill writes its own order as numbered headings, and the prompt hook copies that skill's steps into a list for the turn before the message is read; the reply hook then refuses to end the turn while one is un-struck, so a step cannot be skipped or reordered by a memory that drops whichever one came last. The skill file stays the only copy of its order, a skill that numbers nothing writes no list, and a step that genuinely does not apply is struck with the reason. **The list holds steps, never work** — work is a plan's boxes, which outlive the session, while a step dies with the message. The reply hook grew the same way: it refuses the phrases the rules name for themselves, including an answer walked back by a later "but" and a sentence handing a filing back to the owner where nothing was filed, and it strips quoted material first so a reply naming a rule is not refused for the words it is quoting.
