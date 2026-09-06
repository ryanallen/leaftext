// The stripper the front end's browser copy is written with, shared with the crate rather than copied: one tokenizer, used here before the module is compiled and by `app_shell_script_without_comments` afterwards.
#[path = "src/shell_comments.rs"]
mod shell_comments;

use std::fs;
use std::path::Path;

fn main() {
    // Embed the Windows application icon into leaftext.exe so Explorer, the Start menu, and the taskbar show the leaf logo instead of the generic glyph. The build-dependency and resource are Windows-only, so other platforms build untouched.
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=leaf.rc");
        println!("cargo:rerun-if-changed=src/assets/leaf.ico");
        embed_resource::compile("leaf.rc", embed_resource::NONE);
    }

    write_stripped_fragments();
}

/// A copy of every front-end fragment with its comments taken out, written beside the build for `APP_SHELL_SCRIPT_PARTS` to take its text from when the target is `wasm32`.
///
/// It has to happen here rather than when the page asks for the script. The fragments reach the binary through `include_str!`, so their text is in the module whether or not anything hands it out — and a strip reading them at run time is what keeps it there. Built that way the embed module did not move: 1,125 KB compressed against the 1,124 KB it was, with the prose still in its bytes.
///
/// Every `.js` the fragment list could name is written, rather than the list being repeated here — `src/lib.rs` holds the one list of what the front end is made of, and this only has to have an answer ready for each name on it. That is the two folders a fragment sits in and no deeper: `src/assets/vendor/` is six megabytes of somebody else's minified code, served whole and named by no fragment.
fn write_stripped_fragments() {
    let out =
        Path::new(&std::env::var("OUT_DIR").expect("cargo sets OUT_DIR")).join("shell-stripped");
    let mut sources = javascript_in(Path::new("src/assets"));
    sources.extend(javascript_in(Path::new("src/assets/shell")));
    for source in sources {
        println!("cargo:rerun-if-changed={}", source.display());
        let written = out.join(&source);
        let folder = written
            .parent()
            .expect("a file under src/assets has a folder");
        fs::create_dir_all(folder)
            .unwrap_or_else(|error| panic!("could not make {}: {error}", folder.display()));
        let text = fs::read_to_string(&source)
            .unwrap_or_else(|error| panic!("could not read {}: {error}", source.display()));
        fs::write(&written, shell_comments::without_comments(&text))
            .unwrap_or_else(|error| panic!("could not write {}: {error}", written.display()));
    }
}

/// The `.js` files directly in `folder`, as paths spelled from the crate root — which is how the fragment list names them.
fn javascript_in(folder: &Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(folder) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|kind| kind == "js") {
            found.push(path);
        }
    }
    found
}
