//! Reading what git prints, and deciding what to call things.
//!
//! Only the parts that take a string and give one back. Whether `git push`
//! works is git's business and the machine's, and a test that shelled out to
//! find out would be testing the machine.

use crate::git::{
    commit_message, count_changes, gitignore_addition, parse_ahead_behind, remote_label,
};
use crate::repo_name_for_vault;

#[test]
fn ahead_and_behind_come_out_of_the_pair_git_prints() {
    // `rev-list --left-right --count @{upstream}...HEAD` puts the upstream on
    // the left, so the left number is what we are missing, not what we owe.
    assert_eq!(parse_ahead_behind("0\t0"), (0, 0));
    assert_eq!(parse_ahead_behind("3\t1"), (3, 1));
    // Whatever whitespace it chooses, and whatever it does when there is none.
    assert_eq!(parse_ahead_behind("2 5"), (2, 5));
    assert_eq!(parse_ahead_behind(""), (0, 0));
    assert_eq!(parse_ahead_behind("nonsense"), (0, 0));
}

#[test]
fn a_change_count_is_the_lines_of_porcelain() {
    let status = " M docs/README.md\n?? notes/new.md\n D old.md\n";
    assert_eq!(count_changes(status), 3);
    assert_eq!(count_changes(""), 0);
    // A trailing newline is not a fourth file.
    assert_eq!(count_changes(" M one.md\n"), 1);
}

#[test]
fn a_commit_says_what_changed_and_not_who_made_it() {
    // One file is worth naming; several are worth counting. The app's name is
    // deliberately absent: it is the user's history and they did the writing.
    assert_eq!(commit_message(" M README.md\n"), "Update README.md");
    assert_eq!(
        commit_message(" M a.md\n?? b.md\n D c.md\n"),
        "Update 3 files"
    );
    assert_eq!(commit_message(""), "Update the vault");
    // A rename prints both names; the one it is called now is the useful one.
    assert_eq!(
        commit_message("R  old/name.md -> new/name.md\n"),
        "Update new/name.md"
    );
    // Porcelain quotes a path with a space in it.
    assert_eq!(commit_message("?? \"my notes.md\"\n"), "Update my notes.md");

    // The shape that shipped a wrong message. `status --porcelain` writes two
    // status columns, and for a plain modification the first is a blank -- which
    // a `trim()` on git's whole output helpfully removed, leaving the path read
    // one byte late as "EADME.md". The reader now survives either form, and the
    // caller no longer mangles it on the way in.
    assert_eq!(commit_message(" M README.md"), "Update README.md");
    assert_eq!(commit_message("M README.md"), "Update README.md");
    assert_eq!(
        commit_message("?? notes/deep/file.md"),
        "Update notes/deep/file.md"
    );
    assert_eq!(commit_message(" M a b.md"), "Update a b.md");
}

#[test]
fn a_remote_reads_as_owner_and_name_in_any_form_git_takes() {
    assert_eq!(
        remote_label("https://github.com/ryanallen/dharma.git"),
        "ryanallen/dharma"
    );
    assert_eq!(
        remote_label("https://github.com/ryanallen/dharma"),
        "ryanallen/dharma"
    );
    assert_eq!(
        remote_label("https://github.com/ryanallen/dharma/"),
        "ryanallen/dharma"
    );
    assert_eq!(
        remote_label("git@github.com:ryanallen/dharma.git"),
        "ryanallen/dharma"
    );
    // Not GitHub, and not guessable: show it as it is rather than inventing an
    // owner out of whatever the last two path segments happen to be.
    assert_eq!(remote_label("/srv/backups/notes.git"), "/srv/backups/notes");
}

#[test]
fn a_vault_name_becomes_something_github_will_accept() {
    assert_eq!(repo_name_for_vault("Vajrayana"), "Vajrayana");
    assert_eq!(repo_name_for_vault("My Reading Notes"), "My-Reading-Notes");
    // Runs of punctuation collapse rather than stacking up dashes, and the ends
    // are trimmed — GitHub rejects a name that starts or ends with one.
    assert_eq!(repo_name_for_vault("  notes // 2026!  "), "notes-2026");
    assert_eq!(repo_name_for_vault("dots.and_bars"), "dots.and_bars");
    // A name with nothing usable in it still has to produce a name.
    assert_eq!(repo_name_for_vault("κείμενο"), "vault");
    assert_eq!(repo_name_for_vault(""), "vault");
}

#[test]
fn nested_repositories_are_ignored_once_and_the_reason_goes_with_them() {
    let nested = vec!["app".to_string(), "site/theme".to_string()];
    let addition = gitignore_addition("", &nested);
    assert!(addition.contains("app/\n"));
    assert!(addition.contains("site/theme/\n"));
    // The next person to read the file should not have to work out why a folder
    // is missing from their clone.
    assert!(addition.contains("own remotes"));

    // Anything the file already names is left alone, however it was written.
    let existing = "node_modules/\napp/\n";
    let addition = gitignore_addition(existing, &nested);
    assert!(!addition.contains("app/\n"));
    assert!(addition.contains("site/theme/\n"));

    // Nothing to add is nothing written, not a stray comment block.
    assert_eq!(gitignore_addition("app/\nsite/theme\n", &nested), "");
    assert_eq!(gitignore_addition("", &[]), "");
}
