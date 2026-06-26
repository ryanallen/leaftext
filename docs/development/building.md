# Building

> Set up a Rust development environment, clone the repository, and run the leaftext verification suite with `just verify` before contributing.

leaftext is a Rust application (edition 2021). Building from source requires the Rust toolchain and the `just` command runner.

## Prerequisites

Before building leaftext, make sure the following are installed:

- **Rust (stable toolchain)** — install via [rustup](https://rustup.rs/). The project targets Rust 2021 edition as declared in `Cargo.toml`.
- **`just` command runner** — install with `cargo install just`. leaftext uses a `Justfile` to orchestrate formatting, type-checking, testing, and releases.
- **Platform-specific WebView dependency**:
  - **Linux** — WebKit2GTK development headers are required for `wry`, the embedded WebView library. See the note below for installation instructions.
  - **macOS** — WKWebView is provided by the OS; no extra headers are needed.
  - **Windows** — WebView2 is provided by the OS via the Microsoft Edge WebView2 Runtime; no extra headers are needed.

> [!NOTE]
> On Linux, install `libwebkit2gtk-4.1-dev` (or the equivalent package for your distribution) before building. The `wry` crate requires it for the WebView. On Debian/Ubuntu this is: `sudo apt install libwebkit2gtk-4.1-dev`. On Arch Linux the package is `webkit2gtk-4.1`.

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

This compiles (if needed) and starts leaftext. Open a Markdown file with `Ctrl+O` / `Cmd+O`.

## Verification suite

Before submitting a contribution, run the full suite:

```sh
just verify
```

This runs `cargo fmt --check`, `cargo check --all-targets`, `cargo test`, and a vendored-asset drift check in sequence. All steps must pass. The `verify` recipe is defined in the project `Justfile` as:

```text
verify: format-check check test check-vendor
```

A passing `just verify` is the baseline requirement before handing any work back.

The Mermaid, KaTeX, and Noto assets are embedded in the binary from `src/assets` and also served as static files from `site/`. `src/assets` is the source of truth; `check-vendor` fails if the `site/` copies have drifted. Run `just sync-vendor` to recopy them and clear the drift.

## Individual tasks

Each step in the verification pipeline can also be run on its own:

| Task         | Command                     | What it does                                   |
| ------------ | --------------------------- | ---------------------------------------------- |
| Format check | `cargo fmt --check`         | Verify code formatting without modifying files |
| Type check   | `cargo check --all-targets` | Check all targets without producing a binary   |
| Tests        | `cargo test`                | Run the full test suite                        |
| Vendor check | `just check-vendor`         | Verify `site/` vendored assets match `src/assets` |
| Full verify  | `just verify`               | All steps above in sequence                    |

Additional convenience tasks are available via `just --list`, including `just sync-vendor` to recopy the vendored assets into `site/`.
