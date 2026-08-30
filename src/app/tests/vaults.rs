//! A vault's git state, when it is re-read, and its favorites.

use super::*;

#[test]
fn reading_a_vaults_git_state_is_itself_a_change_the_watcher_would_report() {
    // The loop's closing edge, as a claim rather than a paragraph: the app is its own event source. Never `git_tooling()` as the gate — that one runs `gh auth status`, which goes to the network.
    let git_answers = std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success());
    if !git_answers {
        println!("skipped: git is not on this machine, so there is no repository to read");
        return;
    }

    let dir = std::env::temp_dir().join(format!("leaf-git-loop-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let git = |args: &[&str]| {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(&dir)
            .output()
            .expect("git runs");
        assert!(out.status.success(), "git {args:?} succeeds in the fixture");
    };
    git(&["init", "--quiet", "-b", "main"]);
    fs::write(dir.join("note.md"), "# Note\n").expect("a document is written");
    git(&["add", "note.md"]);
    git(&[
        "-c",
        "user.email=leaf@example.com",
        "-c",
        "user.name=Leaf",
        "commit",
        "--quiet",
        "-m",
        "first",
    ]);

    let modified = || {
        fs::metadata(dir.join(".git"))
            .and_then(|meta| meta.modified())
            .expect("the .git folder has a modified time")
    };
    let before = modified();
    // Exactly what a filesystem event under an active vault must not run.
    inspect_vault_repo(&dir);
    assert!(
        modified() > before,
        "reading a vault's git state modifies its own .git folder, so a recursive watch reports it straight back"
    );

    make_writable(&dir);
    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn coming_back_to_the_window_rereads_the_vault_you_are_in_and_does_it_once() {
    // A commit made in a terminal writes nothing but `.git`, which the watcher does not report, so coming back to the window is the gesture that has to correct the header's count. The once is the guard the read goes through, held by `a_burst_of_saves_reads_a_vaults_git_state_once`.
    let mut state = VaultState::load(None);

    assert_eq!(
        vault_to_reread(&state),
        None,
        "with no vault there is nothing to read"
    );

    state.active = 7;
    assert_eq!(
        vault_to_reread(&state),
        Some(7),
        "the vault the reader is in is the one whose git state is read again"
    );
}

#[test]
fn a_burst_of_saves_reads_a_vaults_git_state_once() {
    let mut state = VaultState::load(None);

    // The first save starts the read; the next ten find it running and leave one repeat between them, not ten.
    assert!(state.may_read_status(7));
    for _ in 0..10 {
        assert!(!state.may_read_status(7));
    }

    // The answer lands: the repeat is owed, and it is the only one.
    assert!(state.status_read_settled(7));
    assert!(state.may_read_status(7));
    assert!(!state.status_read_settled(7));

    // And the guard is what the refresh actually asks, rather than a bookkeeping pair nothing consults. With no registry behind this state there is no vault to find a folder for, so every answer here is nothing — which is the refresh reaching the guard and stopping, and it does that whether the guard says yes or no.
    let mut state = VaultState::load(None);
    assert!(state.may_read_status(7));
    assert_eq!(status_read_to_start(&mut state, 7), None);
    assert_eq!(status_read_after_delivery(&mut state, 7), None);
}

#[test]
fn a_vault_whose_folder_is_known_reads_it_once_per_burst() {
    let dir = scratch_dir("a_vault_whose_folder_is_known_reads_it_once_per_burst");
    let root = dir.join("vault");
    fs::create_dir_all(&root).expect("test directory is created");
    let mut state = VaultState::load(Some(&dir));
    let id = add_vault(
        state.conn.as_ref().expect("the registry opens"),
        &root,
        "vault",
        VaultKind::Folder,
    )
    .expect("the vault is registered")
    .id;

    // The first save starts the read against the vault's own folder; the next ten find it running.
    let first = status_read_to_start(&mut state, id).expect("the first save starts the read");
    for _ in 0..10 {
        assert_eq!(
            status_read_to_start(&mut state, id),
            None,
            "a burst of saves started a git read each"
        );
    }

    // The answer lands, and the one repeat everything waiting is owed reads the same folder.
    assert_eq!(
        status_read_after_delivery(&mut state, id),
        Some(first),
        "the repeat everything waiting is owed never started"
    );
    assert_eq!(
        status_read_after_delivery(&mut state, id),
        None,
        "an answer nobody waited behind started another read"
    );

    drop(state);
    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_second_vault_is_not_made_to_wait_behind_the_first() {
    // The page asks for every vault it knows at once, so a single flag would answer one of them and drop the rest.
    let mut state = VaultState::load(None);
    assert!(state.may_read_status(1));
    assert!(state.may_read_status(2));
    assert!(!state.may_read_status(1));

    assert!(state.status_read_settled(1));
    assert!(!state.status_read_settled(2));
}

/// Take the read-only flag off everything under `dir`. Git marks every object file it writes read-only, and a removal on Windows is refused by one.
fn make_writable(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            make_writable(&path);
        } else if let Ok(meta) = fs::metadata(&path) {
            let mut permissions = meta.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = fs::set_permissions(&path, permissions);
        }
    }
}

#[test]
fn removing_a_vault_left_its_favorites_drawn_on_the_start_screen() {
    // A vault going takes its favorites with it, and the registry push is what redraws the start screen. So the page has to be handed the shorter list first: the other way round, the screen is drawn from rows naming a vault the registry no longer has, and every one of them falls into a second group called "Outside a vault".
    let dir = scratch_dir("removing_a_vault_left_its_favorites_drawn_on_the_start_screen");
    let root = dir.join("vault");
    fs::create_dir_all(&root).expect("test directory is created");
    let state = VaultState::load(Some(&dir));
    let vault = add_vault(
        state.conn.as_ref().expect("the registry opens"),
        &root,
        "vault",
        VaultKind::Folder,
    )
    .expect("the vault is registered");

    assert_eq!(
        vault_removal_steps(&state, vault.id),
        vec![
            VaultRemovalStep::ForgetFavorites(vault.id),
            VaultRemovalStep::RedrawTabStrip,
            VaultRemovalStep::ReleaseWatch(PathBuf::from(&vault.root_path)),
            VaultRemovalStep::RemoveRow(vault.id),
            VaultRemovalStep::ShowLibraryRoot,
        ],
        "the registry push has to land last, so the start screen is redrawn against the corrected favorites — and the watch is released before the row that is the only record of where the folder is"
    );

    drop(state);
    fs::remove_dir_all(&dir).expect("test directory is removed");
}

/// The watcher's own branch, which is where saving the file you are looking at lands.
#[test]
fn saving_the_document_you_are_reading_still_updates_the_sync_count() {
    // A change to the open document takes the live-reload branch; a change to anything else takes the other one. A status refresh in only the second leaves the commonest edit there is — saving the file you are looking at — with the header's count stale until something else happens to move.
    let mut state = VaultState::load(None);
    state.active = 3;

    assert_eq!(
        watched_change_steps(&state, Path::new("/vault/notes.md"), true),
        vec![
            WatchedChangeStep::RereadVaultStatus(3),
            WatchedChangeStep::AgeLinkPreviews,
            WatchedChangeStep::ReloadActiveDocument,
        ],
        "the status read comes above the split, or it only fires for files you are not editing"
    );

    // And nothing between the event and the read. A containment check here discards every event: the watcher reports paths under what it watched, and that is canonicalised — a `\\?\` verbatim prefix on Windows, which does not share a component with the plain `C:\…` the vault registry holds. One `git status` off the loop is cheaper than being wrong.
    assert_eq!(
        watched_change_steps(&state, Path::new("/nowhere/near/it.md"), false).first(),
        Some(&WatchedChangeStep::RereadVaultStatus(3)),
        "a path that looks like it is outside the vault still moves the count"
    );

    // With no vault there is no count to move.
    state.active = 0;
    assert_eq!(
        watched_change_steps(&state, Path::new("/vault/notes.md"), true),
        vec![
            WatchedChangeStep::AgeLinkPreviews,
            WatchedChangeStep::ReloadActiveDocument,
        ]
    );
}

/// The card a rest over a link draws is remembered in the page under that link's address, and nothing but this step ever takes one back.
#[test]
fn a_change_on_disk_ages_the_link_cards_whichever_side_of_the_split_it_falls() {
    // Above the split on purpose. The document you are reading is linked to from other documents, so saving it has to age its card as much as a change beside it does — and the active branch returns early, so a step written below it would never run for the commonest change there is.
    let mut state = VaultState::load(None);
    state.active = 0;

    assert!(
        watched_change_steps(&state, Path::new("/vault/notes.md"), true)
            .contains(&WatchedChangeStep::AgeLinkPreviews),
        "a change to the open document left every card that links to it saying what the file used to say"
    );
    assert!(
        watched_change_steps(&state, Path::new("/vault/beside-it.md"), false)
            .contains(&WatchedChangeStep::AgeLinkPreviews),
        "a change beside the open document left the card over its link saying what that file used to say"
    );
}

#[test]
fn a_watcher_batch_raises_shared_steps_once_and_carries_every_corpus_path() {
    let mut state = VaultState::load(None);
    state.active = 3;
    state.folder = "/vault".to_owned();

    assert_eq!(
        watched_batch_steps(
            &state,
            [
                (PathBuf::from("/vault/notes.md"), true),
                (PathBuf::from("/vault/other.md"), false),
                (PathBuf::from("/vault/cover.png"), false),
            ],
        ),
        vec![
            WatchedChangeStep::RereadVaultStatus(3),
            WatchedChangeStep::AgeLinkPreviews,
            WatchedChangeStep::ReloadActiveDocument,
            WatchedChangeStep::RereadPaneFolder("/vault".to_owned()),
            WatchedChangeStep::PatchCorpus {
                paths: vec![
                    PathBuf::from("/vault/other.md"),
                    PathBuf::from("/vault/cover.png"),
                ],
                redraw_graph: false,
            },
            WatchedChangeStep::RefreshImages,
        ]
    );
}

#[test]
fn a_watcher_batch_without_pane_or_image_changes_does_not_raise_them() {
    let state = VaultState::load(None);

    assert_eq!(
        watched_batch_steps(&state, [(PathBuf::from("/elsewhere/notes.md"), false)],),
        vec![
            WatchedChangeStep::AgeLinkPreviews,
            WatchedChangeStep::PatchCorpus {
                paths: vec![PathBuf::from("/elsewhere/notes.md")],
                redraw_graph: false,
            },
        ]
    );
}
