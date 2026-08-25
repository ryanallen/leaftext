//! The calls the operating system answers.

use super::*;

/// Get Info opened nothing on every file a Mac tried it on: Finder was asked for the information window of a bare `POSIX file`, which is not one of its own items, and nothing brought Finder forward, so a window that did open would have opened behind us.
#[test]
fn the_get_info_script_asks_finder_for_an_item_and_brings_finder_forward() {
    let script = finder_information_window_script(Path::new("/Users/me/notes.md"));

    // Coerced to an alias, which Finder resolves to an item it can open a window on.
    assert!(
        script.contains("open information window of (POSIX file \"/Users/me/notes.md\" as alias)"),
        "{script}"
    );

    // Finder comes forward before the window opens, or the reader is looking at our window instead.
    let activate = script
        .find("activate")
        .expect("the script activates Finder");
    let open = script
        .find("open information window")
        .expect("the script opens the information window");
    assert!(activate < open, "{script}");

    // A quote or a backslash in a name would otherwise end the AppleScript string early and run whatever came next.
    let odd = finder_information_window_script(Path::new(r#"/Users/me/od"d\name.md"#));
    assert!(
        odd.contains(r#"POSIX file "/Users/me/od\"d\\name.md" as alias"#),
        "{odd}"
    );
}

/// The documentation shot's own recipe quotes both paths, and cmd.exe hands the quotes through, so the encoder was asked for a path Windows refuses — os error 123 before a byte was read.
#[test]
fn a_path_wrapped_in_quotes_reaches_the_encoder_without_them() {
    assert_eq!(
        crate::unquote_path(r#""C:\Users\me\My Docs\shot.bmp""#),
        r"C:\Users\me\My Docs\shot.bmp"
    );

    // A plain path is what every other caller hands in, and it must arrive unchanged.
    assert_eq!(
        crate::unquote_path("docs/imgs/navigation.png"),
        "docs/imgs/navigation.png"
    );

    // Only a surrounding pair. One quote inside a name is part of the name, and one on its own is not a wrapper.
    assert_eq!(crate::unquote_path("odd\"name.bmp"), "odd\"name.bmp");
    assert_eq!(crate::unquote_path("\"leading.bmp"), "\"leading.bmp");
    assert_eq!(crate::unquote_path("trailing.bmp\""), "trailing.bmp\"");
    assert_eq!(crate::unquote_path("\""), "\"");
}

/// The three names a launch answers to, spelled out rather than derived: these are what every installed copy is already using, so a change that moved one would leave a running app unreachable and a later launch handing its file to nobody. Still scoped per user, so two logged-in accounts stay apart.
#[cfg(windows)]
#[test]
fn a_launch_answers_to_the_names_every_installed_copy_already_uses() {
    use crate::pipe::ask_pipe_name;
    use crate::single_instance::{instance_mutex_name, instance_pipe_name};

    assert_eq!(
        instance_mutex_name("rwall"),
        "leaftext-single-instance-rwall"
    );
    assert_eq!(
        instance_pipe_name("rwall"),
        r"\\.\pipe\leaftext-single-instance-rwall"
    );
    assert_eq!(ask_pipe_name("rwall"), r"\\.\pipe\leaftext-journal-rwall");

    for name in [instance_mutex_name, instance_pipe_name, ask_pipe_name] {
        assert_ne!(name("rwall"), name("someone-else"));
    }
}
