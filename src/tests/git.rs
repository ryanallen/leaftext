//! Reading what git prints and proving the local repository operations.

use crate::git::{
    commit_message, count_changes, failure_cause, gitignore_addition, identity_value,
    parse_ahead_behind, remote_label, repo_folder_name_for_url,
};
use crate::repo_name_for_vault;
use crate::tests::scratch_dir;
use std::path::Path;
use std::process::Command;

fn run_git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git starts");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_test_repo(dir: &Path) {
    run_git(dir, &["init", "-b", "main"]);
    run_git(dir, &["config", "user.name", "Leaftext Test"]);
    run_git(dir, &["config", "user.email", "leaftext@example.invalid"]);
}

fn add_scratch_remote(repo: &Path, label: &str) -> std::path::PathBuf {
    let remote = scratch_dir(label);
    run_git(&remote, &["init", "--bare"]);
    let remote_path = remote.to_string_lossy().into_owned();
    run_git(repo, &["remote", "add", "origin", &remote_path]);
    remote
}

#[test]
fn ahead_and_behind_come_out_of_the_pair_git_prints() {
    // `rev-list --left-right --count @{upstream}...HEAD` puts the upstream on the left, so the left number is what we are missing, not what we owe.
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
fn inner_repository_work_is_left_out_but_its_moved_commit_is_counted() {
    let outer = scratch_dir("git-inner-status");
    init_test_repo(&outer);
    let inner = outer.join("inner");
    std::fs::create_dir(&inner).expect("inner repository folder is created");
    init_test_repo(&inner);
    std::fs::write(inner.join("note.md"), "first\n").expect("inner note is written");
    run_git(&inner, &["add", "note.md"]);
    run_git(&inner, &["commit", "-m", "First inner note"]);
    run_git(&outer, &["add", "inner"]);
    run_git(&outer, &["commit", "-m", "Track inner repository"]);

    std::fs::write(inner.join("note.md"), "changed\n").expect("inner note is changed");
    assert_eq!(crate::inspect_vault_repo(&outer).changed, 0);

    run_git(&inner, &["add", "note.md"]);
    run_git(&inner, &["commit", "-m", "Change inner note"]);
    assert_eq!(crate::inspect_vault_repo(&outer).changed, 1);

    let _ = std::fs::remove_dir_all(&outer);
}

#[test]
fn inner_repository_work_syncs_without_a_commit() {
    let outer = scratch_dir("git-inner-sync");
    init_test_repo(&outer);
    let inner = outer.join("inner");
    std::fs::create_dir(&inner).expect("inner repository folder is created");
    init_test_repo(&inner);
    std::fs::write(inner.join("note.md"), "first\n").expect("inner note is written");
    run_git(&inner, &["add", "note.md"]);
    run_git(&inner, &["commit", "-m", "First inner note"]);
    run_git(&outer, &["add", "inner"]);
    run_git(&outer, &["commit", "-m", "Track inner repository"]);
    let remote = add_scratch_remote(&outer, "git-inner-sync-remote");
    run_git(&outer, &["push", "-u", "origin", "main"]);

    std::fs::write(inner.join("note.md"), "changed\n").expect("inner note is changed");
    let report = crate::sync_vault_repo(&outer).expect("inner work does not stop a sync");
    assert_eq!(report.committed, 0);
    assert!(report.pulled);
    assert!(report.pushed);

    let _ = std::fs::remove_dir_all(&outer);
    let _ = std::fs::remove_dir_all(&remote);
}

#[test]
fn ordinary_work_still_commits_during_sync() {
    let repo = scratch_dir("git-ordinary-sync");
    init_test_repo(&repo);
    std::fs::write(repo.join("note.md"), "first\n").expect("note is written");
    run_git(&repo, &["add", "note.md"]);
    run_git(&repo, &["commit", "-m", "First note"]);
    let remote = add_scratch_remote(&repo, "git-ordinary-sync-remote");
    run_git(&repo, &["push", "-u", "origin", "main"]);

    std::fs::write(repo.join("note.md"), "changed\n").expect("note is changed");
    let report = crate::sync_vault_repo(&repo).expect("ordinary work syncs");
    assert_eq!(report.committed, 1);
    assert_eq!(crate::inspect_vault_repo(&repo).changed, 0);

    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&remote);
}

#[test]
fn an_unborn_repository_still_makes_its_first_commit_during_sync() {
    let repo = scratch_dir("git-first-sync");
    init_test_repo(&repo);
    let remote = add_scratch_remote(&repo, "git-first-sync-remote");
    std::fs::write(repo.join("note.md"), "first\n").expect("note is written");

    let report = crate::sync_vault_repo(&repo).expect("the first work syncs");
    assert_eq!(report.committed, 1);
    assert!(report.pushed);
    assert_eq!(crate::inspect_vault_repo(&repo).changed, 0);

    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&remote);
}

#[test]
fn a_commit_says_what_changed_and_not_who_made_it() {
    // One file is worth naming; several are worth counting. The app's name is deliberately absent: it is the user's history and they did the writing.
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

    // The shape that shipped a wrong message. `status --porcelain` writes two status columns, and for a plain modification the first is a blank -- which a `trim()` on git's whole output helpfully removes, leaving the path read one byte late as "EADME.md". Both forms have to read the same, and the caller must not trim git's output on the way in.
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
    // Not GitHub, and not guessable: show it as it is rather than inventing an owner out of whatever the last two path segments happen to be.
    assert_eq!(remote_label("/srv/backups/notes.git"), "/srv/backups/notes");
}

#[test]
fn a_vault_name_becomes_something_github_will_accept() {
    assert_eq!(repo_name_for_vault("Vajrayana"), "Vajrayana");
    assert_eq!(repo_name_for_vault("My Reading Notes"), "My-Reading-Notes");
    // Runs of punctuation collapse rather than stacking up dashes, and the ends are trimmed — GitHub rejects a name that starts or ends with one.
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
    // The next person to read the file should not have to work out why a folder is missing from their clone.
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

/// The folder a clone lands in comes from the address, and only ever as a plain name: the parent is the folder the user picked, and a name is the one thing that cannot reach outside it.
#[test]
fn a_clone_takes_its_folder_name_from_the_address() {
    assert_eq!(
        repo_folder_name_for_url("https://github.com/owner/leaftext.git"),
        Some(String::from("leaftext"))
    );
    // No `.git`, a trailing slash, and the SSH form, which separates the owner with a colon.
    assert_eq!(
        repo_folder_name_for_url("https://github.com/owner/leaftext/"),
        Some(String::from("leaftext"))
    );
    assert_eq!(
        repo_folder_name_for_url("git@github.com:owner/leaftext.git"),
        Some(String::from("leaftext"))
    );
    // Nothing that is not a plain name. A crafted address must not be able to name the parent, a sibling, or a switch to git.
    assert_eq!(
        repo_folder_name_for_url("https://github.com/owner/.."),
        None
    );
    assert_eq!(repo_folder_name_for_url("https://github.com/owner/."), None);
    assert_eq!(
        repo_folder_name_for_url("https://github.com/owner/-x"),
        None
    );
    assert_eq!(repo_folder_name_for_url(""), None);
    assert_eq!(repo_folder_name_for_url("https://github.com/"), None);
}

/// Every line here was printed by git on this machine under the app's own environment — prompts off, no askpass conversation — and then trimmed the way the panel trims it, so what is tested is the string a reader would actually be shown.
#[test]
fn a_failure_points_at_a_fix_only_where_git_named_one() {
    // Nothing is signed in. Three ways of saying it, because the transport chooses which.
    for signin in [
        "Authentication failed for 'https://github.com/owner/name.git/'",
        "could not read Username for 'https://github.com': terminal prompts disabled",
        "git@github.com: Permission denied (publickey).",
    ] {
        assert_eq!(failure_cause(signin), Some("signin"), "on {signin}");
    }

    // git will not commit as nobody. The lecture that follows is cut off, so the first line is all the panel gets.
    for identity in [
        "Author identity unknown",
        "empty ident name (for <>) not allowed",
        "unable to auto-detect email address (got 'me@box.(none)')",
    ] {
        assert_eq!(failure_cause(identity), Some("identity"), "on {identity}");
    }

    // And the common case: real failures with no button in this panel. Naming a fix for one of these would send somebody to press the wrong thing.
    for neither in [
        "unable to access 'https://github.com/owner/name.git/': Could not resolve host: github.com",
        "unable to access 'http://127.0.0.1:9/o/r.git/': Failed to connect to 127.0.0.1 port 9 after 2070 ms: Couldn't connect to server",
        "Updates were rejected because the remote contains work that you do not have locally",
        "repository 'https://github.com/owner/name.git/' not found",
        "",
    ] {
        assert_eq!(failure_cause(neither), None, "on {neither}");
    }
}

/// Whether git keeps what the Set button writes is the machine's own config, which this suite must never touch — so what is tested is the half that happens before git is run at all.
#[test]
fn who_you_are_is_refused_before_git_is_run_when_it_is_not_a_name() {
    assert_eq!(
        identity_value("name", "  Ada Lovelace  ").expect("a name is taken, trimmed"),
        "Ada Lovelace"
    );
    assert_eq!(
        identity_value("email", "ada@example.com").expect("an address is taken"),
        "ada@example.com"
    );

    // Empty would clear the setting the button was pressed to fill, and whitespace is empty.
    for blank in ["", "   ", "\t\n"] {
        let refused = identity_value("name", blank).expect_err("a blank name is refused");
        assert!(refused.detail.contains("no name given"), "said {refused}");
    }
    let refused = identity_value("email", " ").expect_err("a blank email is refused");
    assert!(refused.detail.contains("no email given"), "said {refused}");

    // A leading dash reaches git as an option rather than as a value, so it never gets that far.
    for dashed in ["-c", "--global", "-Ada"] {
        let refused = identity_value("name", dashed).expect_err("a leading dash is refused");
        assert!(
            refused.detail.contains("name cannot start with a dash"),
            "said {refused}"
        );
    }
    let refused = identity_value("email", " --replace-all")
        .expect_err("a leading dash is refused after trimming");
    assert!(
        refused.detail.contains("email cannot start with a dash"),
        "said {refused}"
    );

    // A dash anywhere else is an ordinary part of a name.
    assert_eq!(
        identity_value("name", "Ada-Lovelace").expect("a dash inside a name is fine"),
        "Ada-Lovelace"
    );
}

/// The two refusals that happen before git is ever run, so neither costs a network call and neither can half-make a vault.
#[test]
fn a_clone_is_refused_before_it_starts_when_it_cannot_land() {
    let parent = scratch_dir("clone");
    std::fs::create_dir_all(parent.join("leaftext")).expect("a folder already in the way");

    let taken = crate::clone_into_vault("https://github.com/owner/leaftext.git", &parent)
        .expect_err("a name already taken is refused");
    assert!(
        taken.detail.contains("already in that folder"),
        "said {taken}"
    );

    let empty = crate::clone_into_vault("   ", &parent).expect_err("an empty address is refused");
    assert!(empty.detail.contains("no address given"), "said {empty}");

    let unnamed = crate::clone_into_vault("https://github.com/", &parent)
        .expect_err("an address with no repository in it is refused");
    assert!(
        unnamed.detail.contains("does not name a repository"),
        "said {unnamed}"
    );

    let _ = std::fs::remove_dir_all(&parent);
}
