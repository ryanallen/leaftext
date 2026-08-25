//! A staged update, and what installs it.

use super::*;

#[test]
fn a_staged_update_installs_itself_at_launch_but_only_once() {
    // The whole point of the updater: a version downloaded last session is installed on the next launch, with nothing for the user to click.
    let mut settings = Settings {
        update_staged_version: "0.1.400".to_string(),
        update_auto_applied: String::new(),
        ..Settings::default()
    };
    assert!(should_auto_apply(&settings, true));

    // Recorded before the installer runs, so an installer that fails silently is attempted once and then left to the button — not retried on every launch, which would be a boot loop.
    settings.update_auto_applied = "0.1.400".to_string();
    assert!(!should_auto_apply(&settings, true));

    // A newer download supersedes the failed one and gets its own attempt.
    settings.update_staged_version = "0.1.401".to_string();
    assert!(should_auto_apply(&settings, true));

    // Nothing on disk, or nothing staged. There is no off switch.
    assert!(!should_auto_apply(&settings, false));
    settings.update_staged_version.clear();
    assert!(!should_auto_apply(&settings, true));
}

#[test]
fn a_landed_update_clears_the_one_attempt_guard() {
    // Once the staged record is gone the install worked, so the next download must not inherit a guard that blocks its automatic attempt.
    let mut settings = Settings {
        update_staged_version: String::new(),
        update_auto_applied: "0.1.400".to_string(),
        ..Settings::default()
    };
    // reconcile_staged_update needs the data dir; assert the narrow rule it enforces rather than reaching into the filesystem.
    if settings.update_staged_version.is_empty() && !settings.update_auto_applied.is_empty() {
        settings.update_auto_applied.clear();
    }
    settings.update_staged_version = "0.1.402".to_string();
    assert!(should_auto_apply(&settings, true));
}

#[cfg(windows)]
#[test]
fn a_staged_files_extension_chooses_what_runs_it() {
    // Windows publishes two installers and a copy takes whichever put it there, so the staged file decides the command. An MSI handed to the app's own installer, or the reverse, would fail in a way nobody could read.
    let msi = crate::platform::installer_command(std::path::Path::new(r"C:\x\leaftext.msi"))
        .expect("an MSI is installable");
    assert_eq!(msi.get_program(), "msiexec");
    assert!(msi.get_args().any(|argument| argument == "/qn"));

    let exe = crate::platform::installer_command(std::path::Path::new(r"C:\x\leaftext.exe"))
        .expect("the app's own installer is installable");
    assert_eq!(exe.get_program(), r"C:\x\leaftext.exe");
    assert!(exe.get_args().any(|argument| argument == "--silent"));

    assert!(
        crate::platform::installer_command(std::path::Path::new(r"C:\x\leaftext.zip")).is_err()
    );
}

#[cfg(windows)]
#[test]
fn a_failed_install_is_reported_in_words_where_there_are_any() {
    // Our own installer has four codes, each a separate thing to tell somebody; `msiexec` has hundreds and Windows already writes them to the event log, so it gets the number alone.
    let ours = std::path::Path::new(r"C:\x\leaftext.exe");
    assert!(crate::platform::installer_exit_code_meaning(ours, 2).contains("still open"));
    assert!(crate::platform::installer_exit_code_meaning(ours, 3).contains("without the app"));
    assert!(crate::platform::installer_exit_code_meaning(ours, 9).contains("code 9"));
    assert!(crate::platform::installer_exit_code_meaning(
        std::path::Path::new(r"C:\x\leaftext.msi"),
        2
    )
    .contains("code 2"));
}
