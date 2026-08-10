//! Puts the app inside the installer, and the app's version number with it.
//!
//! The payload is deflated here rather than at run time so the one file a person downloads is about the size of the MSI. `LEAFTEXT_APP_EXE` names the binary to carry; without it the installer still builds and still runs its tests, but refuses to install anything — an installer with no payload is a bug to be caught by a message rather than by a half-written folder.

use std::io::Write;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=LEAFTEXT_APP_EXE");

    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
    let payload = out.join("payload.deflate");

    match std::env::var_os("LEAFTEXT_APP_EXE") {
        Some(source) => {
            let source = PathBuf::from(source);
            println!("cargo:rerun-if-changed={}", source.display());
            let bytes = std::fs::read(&source)
                .unwrap_or_else(|error| panic!("could not read {}: {error}", source.display()));
            let mut encoder =
                flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
            encoder.write_all(&bytes).expect("deflate the payload");
            let packed = encoder.finish().expect("finish the payload");
            std::fs::write(&payload, packed).expect("write the payload");
            println!("cargo:rustc-env=LEAFTEXT_PAYLOAD_BYTES={}", bytes.len());
        }
        None => {
            std::fs::write(&payload, []).expect("write the empty payload");
            println!("cargo:rustc-env=LEAFTEXT_PAYLOAD_BYTES=0");
        }
    }

    println!("cargo:rustc-env=LEAFTEXT_PAYLOAD={}", payload.display());
    println!("cargo:rustc-env=LEAFTEXT_VERSION={}", app_version());

    // The same leaf the app wears, so the title bar and the taskbar do not show the generic glyph on a file people are already being asked to trust unsigned.
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=leaf.rc");
        println!("cargo:rerun-if-changed=../src/assets/leaf.ico");
        embed_resource::compile("leaf.rc", embed_resource::NONE);
    }
}

/// The app's version, read out of its `Cargo.toml`. The installer has a version of its own that means nothing; what goes in Installed Apps has to be the app's, and reading it is what stops the two drifting.
fn app_version() -> String {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("../Cargo.toml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let text = std::fs::read_to_string(&manifest)
        .unwrap_or_else(|error| panic!("could not read {}: {error}", manifest.display()));
    text.lines()
        .find_map(|line| {
            let value = line.trim().strip_prefix("version")?.trim_start();
            let value = value.strip_prefix('=')?.trim();
            Some(value.trim_matches('"').to_string())
        })
        .expect("the app's Cargo.toml must name a version")
}
