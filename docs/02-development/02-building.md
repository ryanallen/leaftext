# Building

> Set up a Rust development environment, clone the repository, and run the Leaftext verification suite with `just verify` before contributing.

Leaftext is a Rust application (edition 2021). Building from source requires the Rust toolchain and the `just` command runner.

## Prerequisites

Before building Leaftext, make sure the following are installed:

- **Rust (stable toolchain)** — install via [rustup](https://rustup.rs/). The project targets Rust 2021 edition as declared in `Cargo.toml`.
- **`just` command runner** — install with `cargo install just`. Leaftext uses a `Justfile` to orchestrate formatting, type-checking, testing, and releases.
- **Platform-specific WebView dependency**: none to install. macOS provides WKWebView, and Windows provides WebView2 through the Microsoft Edge WebView2 Runtime.

> [!NOTE]
> Leaftext builds for Windows and macOS only. Any other target stops the build with a `compile_error!` in `src/main.rs` rather than failing later in a platform code path.

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

This compiles (if needed) and starts Leaftext. Open a Markdown file with `Ctrl+O` / `Cmd+O`.

Dependencies are compiled with optimizations even in this debug build (`[profile.dev.package."*"]` in `Cargo.toml`). Parsing, sanitizing, and syntax highlighting all happen inside crates, so leaving them unoptimized made a development build several times slower than the one users get — slow enough to send you hunting performance problems that do not exist in a release build. Dependencies change rarely, so they are compiled once and cached; rebuilds of this crate stay at debug speed.

## Verification suite

Before submitting a contribution, run the full suite:

```sh
just verify
```

This runs formatting, type checking, the tests, the drift checks over everything that is generated, the design-system rules, the spelling check, the front-end check, and the two repo guards, in sequence. All steps must pass. The `verify` recipe is defined in the project `Justfile` as:

```text
verify: format-check check test check-vendor check-themes check-tokens check-icons check-gallery check-design-docs check-classes check-literals check-verify check-spelling check-shell check-identity check-hooks
```

The design-system steps are the ones worth knowing about. `check-tokens`, `check-icons`, `check-gallery` and `check-design-docs` fail when a generated file has drifted from the four files in `design/` it is built from — the stylesheet's fixed values, the icon classes, the page at [leaftext.com/gallery.html](https://leaftext.com/gallery.html), and [Design system](05-design-system.md). `check-classes` fails on a class in `reading.css` that `design/components.md` does not account for, so new interface joins the design system rather than growing beside it. `check-literals` fails on a color, size, spacing or duration typed into `reading.css` instead of coming from a value. `check-verify` fails when a check exists but this recipe does not run it. `check-identity` fails on an assistant credited anywhere in the repo or its history, and `check-hooks` self-tests the three hooks.

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
| Values check | `just check-tokens`         | Verify the color contract and the fixed values match `design/` |
| Icons check  | `just check-icons`          | Verify the icon classes match `design/icons.md` |
| Gallery check | `just check-gallery`       | Verify `gallery.html` matches `design/` |
| Design docs check | `just check-design-docs` | Verify [Design system](05-design-system.md) matches `design/` |
| Classes check | `just check-classes`       | Fail on a class in `reading.css` that `design/components.md` does not account for |
| Values written by hand | `just check-literals` | Fail on a color, size, spacing or duration typed into `reading.css` |
| Suite check  | `just check-verify`         | Fail when a check exists that `verify` does not run |
| Spelling     | `just check-spelling`       | Fail on British spelling in the repo's own writing |
| Front end    | `just check-shell`          | Run the page's script against a stand-in page: it parses, it boots, and its edit offsets are right |
| Identity     | `just check-identity`       | Fail on an assistant credited in the repo or its history |
| Hooks        | `just check-hooks`          | Self-test the three hooks |
| Ask pipe     | `just check-mcp`            | Fail when the MCP wrapper and `src/pipe.rs` disagree about what can be asked, or where |
| Full verify  | `just verify`               | All steps above in sequence                    |

Additional convenience tasks are available via `just --list`, including `just sync-vendor` to recopy the vendored assets into `site/` and `just bundle-themes` to recompile `themes.md` from the `themes/` folder.

### Asking a running app

A running Leaftext answers questions on a local channel — see `src/pipe.rs`. `just ask '<json>'` puts one question to it and prints the reply:

```bash
just ask '{"ask":"version"}'
just ask '{"ask":"state"}'
just ask '{"ask":"log","lines":40}'
just ask '{"ask":"eval","script":"document.title"}'
```

`just mcp` runs the same program as an MCP server on stdin/stdout, so an AI gets one tool per ask. It is **not a shipped artifact**: one MSI and one DMG is the rule, and every extra file in a release is one somebody has to ask about. Neither release workflow builds it, and `just verify` cannot run it because it needs the app running — `check-mcp` covers what can be checked offline, which is that the tools and the app's asks still agree.

`eval` runs arbitrary JavaScript inside the app. It is the reason the pipe beats reading the journal afterwards, and it is reachable by anything running under the same account.

### Documentation screenshots

`scripts/capture-screenshot.ps1` photographs the app for the documentation, and `just squeeze-png <in.bmp> <out.png>` writes the file — the same encoder the [diagram export](../01-features/07-editing.md#export) uses, so there is only one of them. Add `--palette` for a screenshot: it cuts the image to 256 colors, which halves the file and is the one step that moves a pixel.

```bash
pwsh scripts/capture-screenshot.ps1 -Doc docs/01-features/01-rendering.md -Out shot.bmp
just squeeze-png shot.bmp imgs/rendering.png --palette
```

`just doc-images` lists every picture the documentation asks for and which of them are not there, so a page cannot quietly point at a screenshot nobody took. It is not part of `just verify`: there is a backlog of missing ones, and a check that is red before anybody touches it stops being read. The repo's `sync-docs` skill runs it instead, so the pass that edits a page also takes what the page asks for.

The script closes any running copy first (the app is single-instance, so a second launch hands the file over and exits), and writes the window size and theme into a `settings.json` of its own, because the webview lays out at the size it was created with. That file, the recent-files list and the vault registry all live in a throwaway profile under `-Work`: the app resolves both roots from `%APPDATA%` and `%LOCALAPPDATA%`, so a screenshot never reads or writes your own.

Beyond `-Doc`, `-Width`, `-Height`, `-ThemeFamily` and `-ThemeMode`:

| Option | What it is for |
| --- | --- |
| `-LibraryOpen` | Opens the [library](../01-features/03-library.md) pane |
| `-Vault <folder>` | Registers a [vault](../01-features/03-library.md#vaults). The search box and the vault switcher do not exist without one |
| `-Recents <files>` | Fills the home screen's [recent files](../01-features/02-navigation.md#recent-files) list |
| `-Unlocked` | Lifts the [padlocks](../01-features/07-editing.md#the-padlock), for a picture of typing in the page or the source |
| `-GraphScope <size>` | How much of the link graph the [graph view](../01-features/03-library.md#graph) draws: `small`, `medium`, `large` or `xl`. A big vault at `xl` is a hairball with no readable name in it |
| `-Do <steps>` | Drives the window before the shot: `click:X,Y`, `rclick:X,Y`, `move:X,Y`, `drag:X1,Y1,X2,Y2`, `hold:…` (a drag caught mid-gesture), `scroll:X,Y,NOTCHES`, `type:text`, `key:{ESC}`, `wait:MS` |
| `-Crop "X,Y,W,H"` | Cuts the shot down to one control |

`-Do` and `-Crop` coordinates are pixels in the captured image, so they are measured off a shot already taken at the same size: take one plain picture, look at it, then aim. `PrintWindow` does not draw the pointer, but it does draw what the pointer is over — a hover state photographs, the cursor arrow never appears.
