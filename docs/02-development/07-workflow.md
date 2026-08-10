# Workflow

> How a change moves through this repo: the plan it starts as, the skills that carry it, the test every phase owes, and the gate it passes before it ships.

Work here starts as a written plan and ends as a released version, and the same path is followed by a person or an agent. The steps are kept as **skills** — one folder each under `.agents/skills/`, read by whatever is doing the work. `AGENTS.md` at the repo root is the standing guide they sit under, and it is where a rule that already cost a version number is written down.

## The order

**1. Plan it.** `/ticket` writes a Markdown plan — why, what was measured with the line it came from, how it is built, and phases with a checkbox per piece of work. Plans live in the `docs/` folder beside this repo, not in the published site.

**2. Read the plan against the code.** `/design` opens every line the plan cites, holds it against the rules that already cost a version number, fixes what is wrong in the file, and signs the top with a date. It never edits app code.

**3. Rank it.** `/pm` puts every live plan into one running order — what is wrong today first, then what other plans are waiting on it, then cost.

**4. Build it.** `/dev` works the phases in order and ticks each box in the same edit as its code and its test.

**5. Gate it.** `/check` runs `/sync-tests` and then `just verify`. Tests come first because `just verify` only runs the tests that exist — a change with no test passes it and proves nothing.

**6. Ship it, then close it.** `/git-release` is the only step that writes git. `/done` retires the plan afterwards, on the owner's word alone.

## Every phase says how it is proved

**A phase carries at least one test box, and the box names where the test goes.** Nothing in the build asks whether a change made a test necessary, so the plan is where that question is answered — and a phase with no test box is code shipped with nothing that would have caught it going wrong.

- A test box names the claim, not the function: *a comment on its own line leaves every other block editable*, in the file it goes in.
- A fix names the test after **what went wrong**, so the same regression cannot ship twice.
- A phase whose only work is a row in `design/` asks for no test — the [design-system checks](05-design-system.md) already refuse anything those files do not list.
- What genuinely cannot be tested here — a real window, live selected text, a held pointer — is said in the phase, so a missing test is not read as an oversight.

**A gap outside the plan in hand becomes its own plan.** Reading the code turns up subjects nothing covers; that finding is written as a new plan rather than fixed in passing, because tests added for code the change never touched make a diff nobody can review.

## Where a test goes

| What changed | Where its test lives |
|:--|:--|
| `src/**.rs` — the library | `src/tests/`, one file per subject, with the shared helpers in `mod.rs` |
| `src/app/**.rs` — the binary | `src/app/tests.rs` |
| `src/store/**.rs` | `src/store/tests.rs` |
| `src/assets/shell/*.js` — the page's script | `scripts/check-shell.mjs`, which boots the fragments in order against a stand-in page |
| `web/preview/host.js` — the browser's own host | `scripts/check-shell.mjs` as well, which boots it over a stand-in module in that same page. A new command also owes a row in the host's own table, which `just check-web-commands` refuses the build without |
| `reading.css`, `src/theme.rs`, `themes/` | `src/tests/reading_css.rs`, `src/tests/theme_registry.rs`, and `just check-themes` |
| A new class, component, token or icon | No test to write — `just check-classes`, `check-tokens`, `check-icons` and `check-gallery` refuse what `design/` does not list |
| A new `scripts/*.mjs` | Its own `--check` mode, plus a line in `just verify` — `check-verify` fails on a check the suite does not run |

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

Four hooks back the parts of this that are worth failing rather than remembering — they print the standing rules before each message, refuse a git write without an explicit release, hold a reply to the repo's own brevity rule, and prove the rules were read rather than recalled. `just verify` self-tests all four.
