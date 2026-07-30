# Building

> Set up a Rust development environment, clone the repository, and run the Leaf Text verification suite with `just verify` before contributing.

Leaf Text is a Rust application (edition 2021). Building from source requires the Rust toolchain and the `just` command runner.

## Prerequisites

Before building Leaf Text, make sure the following are installed:

- **Rust (stable toolchain)** — install via [rustup](https://rustup.rs/). The project targets Rust 2021 edition as declared in `Cargo.toml`.
- **`just` command runner** — install with `cargo install just`. Leaf Text uses a `Justfile` to orchestrate formatting, type-checking, testing, and releases.
- **Platform-specific WebView dependency**: none to install. macOS provides WKWebView, and Windows provides WebView2 through the Microsoft Edge WebView2 Runtime.

> [!NOTE]
> Leaf Text builds for Windows and macOS only. Any other target stops the build with a `compile_error!` in `src/main.rs` rather than failing later in a platform code path.

## Clone and build

Clone the repository and compile in debug mode:

```sh
git clone https://github.com/ryanallen/leaftext.git
cd leaftext
cargo build
```

The first build downloads and compiles all dependencies listed in `Cargo.toml` — `tao`, `wry`, `pulldown-cmark`, `syntect`, `rusqlite` (bundled), and others. Subsequent builds are incremental.

## Run

Launch the app directly from the source tree:

```sh
cargo run
```

This compiles (if needed) and starts Leaf Text. Open a Markdown file with `Ctrl+O` / `Cmd+O`.

Dependencies are compiled with optimizations even in this debug build (`[profile.dev.package."*"]` in `Cargo.toml`). Parsing, sanitizing, and syntax highlighting all happen inside crates, so leaving them unoptimized made a development build several times slower than the one users get — slow enough to send you hunting performance problems that do not exist in a release build. Dependencies change rarely, so they are compiled once and cached; rebuilds of this crate stay at debug speed.

## Verification suite

Before submitting a contribution, run the full suite:

```sh
just verify
```

This runs `cargo fmt --check`, `cargo check --all-targets`, `cargo test`, two drift checks, a spelling check, and the front-end check in sequence. All steps must pass. The `verify` recipe is defined in the project `Justfile` as:

```text
verify: format-check check test check-vendor check-themes check-spelling check-shell
```

A passing `just verify` is the baseline requirement before handing any work back.

The Mermaid, KaTeX, and Noto assets are embedded in the binary from `src/assets` and also served as static files from `site/`. `src/assets` is the source of truth; `check-vendor` fails if the `site/` copies have drifted. Run `just sync-vendor` to recopy them and clear the drift.

Theme palettes work the same way: `src/assets/themes.md` (embedded in the binary) is compiled from the editable `themes/` folder of per-family Markdown files. `check-themes` fails if it has drifted; run `just bundle-themes` to recompile it. See [Theming](04-theming.md#palettes-are-data-themesmd).

Spelling comes next: this repo writes US English, so `check-spelling` fails on the British form of any word in `scripts/check-spelling.mjs`'s list — the `-our` spelling of "color", for one. It reads only files the repo authors: vendored bundles, build output, and generated files are skipped, and the two identifiers that are British by specification (`aria-labelledby`, WiX's `ProgramMenuFolder`) are exempt.

The last step is `check-shell`, which runs the WebView front-end rather than reading it. The script fragments in `src/assets/shell/` are concatenated the way the binary concatenates them and executed against a stand-in page built from the ids and classes the real markup declares, so nothing has to be listed twice. It fails if the script does not parse, if it throws as it loads — which is what a declaration moved below its first use does, and the reason fragment order is load-bearing — or if the code view's edit arithmetic is wrong. That last one matters most: the editor sends the host only the part of the text that changed, and the host splices it into what it writes to disk, so each case is checked by rebuilding the new text from the splice.

## Individual tasks

Each step in the verification pipeline can also be run on its own:

| Task         | Command                     | What it does                                   |
| ------------ | --------------------------- | ---------------------------------------------- |
| Format       | `cargo fmt`                 | Reformat the code in place                     |
| Format check | `cargo fmt --check`         | Verify code formatting without modifying files |
| Type check   | `cargo check --all-targets` | Check all targets without producing a binary   |
| Tests        | `cargo test`                | Run the full test suite                        |
| Vendor check | `just check-vendor`         | Verify `site/` vendored assets match `src/assets` |
| Themes check | `just check-themes`         | Verify `src/assets/themes.md` matches the `themes/` folder |
| Spelling     | `just check-spelling`       | Fail on British spelling in the repo's own writing |
| Front end    | `just check-shell`          | Run the page's script against a stand-in page: it parses, it boots, and its edit offsets are right |
| Full verify  | `just verify`               | All steps above in sequence                    |

Additional convenience tasks are available via `just --list`, including `just sync-vendor` to recopy the vendored assets into `site/` and `just bundle-themes` to recompile `themes.md` from the `themes/` folder.
