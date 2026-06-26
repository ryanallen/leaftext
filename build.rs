fn main() {
    // Embed the Windows application icon into leaftext.exe so Explorer, the Start
    // menu, and the taskbar show the leaf logo instead of the generic glyph.
    // The build-dependency and resource are Windows-only, so other platforms
    // build untouched.
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=leaf.rc");
        println!("cargo:rerun-if-changed=src/assets/leaf.ico");
        embed_resource::compile("leaf.rc", embed_resource::NONE);
    }
}
