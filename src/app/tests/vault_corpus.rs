//! Reading a vault, the slices a read hands back, and the search answered off them.

use super::*;

/// A query as the page would send one, with no date of its own.
fn typed(query: &str) -> TypedQuery {
    TypedQuery::new(query.to_string(), None)
}

#[test]
fn an_answer_to_a_query_the_field_moved_past_never_reaches_the_page() {
    let mut state = VaultState::load(None);

    // Each keystroke claims a number, and only the newest one is wanted.
    let first = state.search.generation.claim();
    let second = state.search.generation.claim();
    assert!(!state.search.generation.is_current(first));
    assert!(state.search.generation.is_current(second));

    // A running scan reads the same number between documents, so it stops instead of finishing an answer nobody will read.
    let corpus = VaultCorpus {
        skipped: Vec::new(),
        root: PathBuf::from("/vault"),
        documents: vec![CorpusDocument {
            path: "/vault/note.md".to_string(),
            label: "note".to_string(),
            aliases: Vec::new(),
            text: "A talk on dharma.".to_string(),
        }],
        truncated: false,
    };
    let generation = state.search.generation.clone();
    assert!(corpus
        .search_until(&typed("dharma").parsed, None, &|| !generation
            .is_current(second))
        .is_some());
    assert!(corpus
        .search_until(&typed("dharma").parsed, None, &|| !generation
            .is_current(first))
        .is_none());

    // Switching vaults abandons the scan with nothing taking its place, so the answer about the vault we left is dropped too — and so is the read feeding it, which stops between documents rather than walking a folder nobody is in.
    let reading = state.corpus_read.claim();
    state.drop_corpus();
    assert!(!state.search.generation.is_current(second));
    assert!(
        !state.corpus_read.is_current(reading),
        "leaving a vault left its read running"
    );
}

#[test]
fn a_stopped_read_s_last_slice_still_frees_the_next_vault_to_be_read() {
    let left = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(left.clone());
    state.corpus_loading = true;
    let reading = state.corpus_read.claim();

    // The reader picks another vault while the first is still being opened.
    state.drop_corpus();
    state.root = Some(PathBuf::from("/another-vault"));
    assert!(!state.corpus_read.is_current(reading));

    // The stopped read still sends the slice that says it is over: its text is thrown away, and freeing the next vault is the whole of what it is for. A read that returned instead of breaking would never send one, and no vault could be read again for the session.
    assert!(absorb_corpus_slice(
        &mut state,
        &left,
        Vec::new(),
        false,
        Vec::new(),
        true,
        true,
        reading
    )
    .is_none());
    assert!(
        !state.corpus_loading,
        "a stopped read left every later vault unreadable"
    );
}

/// One document, as a slice of a read carries it.
fn slice_document(name: &str) -> CorpusDocument {
    CorpusDocument {
        path: format!("/vault/{name}.md"),
        label: name.to_string(),
        aliases: Vec::new(),
        text: format!("# {name}\n\na talk on dharma\n"),
    }
}

#[test]
fn every_slice_of_a_read_answers_the_parked_query_and_moves_the_corpus_number() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus_loading = true;
    // Somebody typed before the vault had been read, so the query is waiting on it.
    state.pending_search = Some(typed("dharma"));
    let started = state.corpus_generation;
    // Every slice below is stamped with this one read's number, the way a live read's are.
    let reading = state.corpus_read.claim();

    let first = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("one")],
        false,
        Vec::new(),
        true,
        false,
        reading,
    )
    .expect("the first slice is for the vault on screen");
    assert_eq!(first.corpus.documents.len(), 1);
    // Answered over what has landed, and still parked: taken here, the read would go quiet for every slice after this one.
    assert!(
        first.parked.is_some(),
        "the first slice did not answer the parked query"
    );
    assert!(
        state.pending_search.is_some(),
        "the first slice took the parked query out of its slot"
    );
    assert!(
        state.corpus_partial,
        "a vault still being read was called whole"
    );
    assert!(
        first.hints.is_none(),
        "the completion menu was filled from part of a vault"
    );
    assert_eq!(state.corpus_generation, started + 1);

    let middle = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("two")],
        false,
        Vec::new(),
        false,
        false,
        reading,
    )
    .expect("a later slice is kept");
    // Grown, not replaced.
    assert_eq!(middle.corpus.documents.len(), 2);
    assert!(middle.parked.is_some());
    // Every slice moves the number both the kept answer and the narrowing shortcut turn on, so neither can hand back an answer that saw half the vault.
    assert_eq!(state.corpus_generation, started + 2);

    let last = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("three")],
        false,
        Vec::new(),
        false,
        true,
        reading,
    )
    .expect("the last slice is kept");
    assert_eq!(last.corpus.documents.len(), 3);
    assert!(
        last.parked.is_some(),
        "the last slice did not answer the parked query"
    );
    assert!(
        state.pending_search.is_none(),
        "the finished read left its query parked for ever"
    );
    assert!(
        !state.corpus_partial,
        "a finished read still called its text partial"
    );
    assert!(
        !state.corpus_loading,
        "a finished read left the vault looking unread"
    );
    assert!(last.hints.is_some(), "the completion menu was never filled");
    assert_eq!(state.corpus_generation, started + 3);
}

#[test]
fn a_read_of_a_vault_nobody_is_in_any_more_is_thrown_away() {
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));
    let elsewhere = PathBuf::from("/somewhere-else");
    // Still the read being waited for, so the root is the only thing that can turn this slice away.
    let reading = state.corpus_read.claim();
    assert!(
        absorb_corpus_slice(
            &mut state,
            &elsewhere,
            vec![slice_document("one")],
            false,
            Vec::new(),
            true,
            false,
            reading
        )
        .is_none(),
        "a slice read under a vault we have left was taken as this one's text"
    );
    assert!(state.corpus.is_none());
}

#[test]
fn a_vault_left_and_come_straight_back_to_keeps_nothing_from_the_read_it_abandoned() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus_loading = true;
    let abandoned = state.corpus_read.claim();
    absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("one")],
        false,
        Vec::new(),
        true,
        false,
        abandoned,
    )
    .expect("the read being waited for had its first slice thrown away");

    // Clicked to another vault and straight back to this one, so the root is `/vault` again and the abandoned read's tail gets past it.
    state.drop_corpus();
    state.root = Some(PathBuf::from("/another-vault"));
    state.drop_corpus();
    state.root = Some(root.clone());

    assert!(
        absorb_corpus_slice(
            &mut state,
            &root,
            vec![slice_document("two")],
            false,
            Vec::new(),
            false,
            true,
            abandoned
        )
        .is_none(),
        "the vault they came back to was handed the tail of the read they walked out on"
    );
    assert!(
        state.corpus.is_none(),
        "a scrap of the abandoned read became the vault's whole text"
    );
    assert!(
        !state.corpus_loading,
        "the refused slice left the vault unreadable for the rest of the session"
    );
}

#[test]
fn a_read_overtaken_before_it_opened_a_document_is_thrown_away_though_its_slice_is_a_first() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus_loading = true;
    let abandoned = state.corpus_read.claim();

    // The fast gesture: away and back before the walk ended, so the read broke having sent nothing. Its one slice is its first as well as its last and holds no documents — the case a `first`-based test keeps, leaving the vault empty and calling it read.
    state.drop_corpus();
    state.root = Some(PathBuf::from("/another-vault"));
    state.drop_corpus();
    state.root = Some(root.clone());

    assert!(
        absorb_corpus_slice(
            &mut state,
            &root,
            Vec::new(),
            false,
            Vec::new(),
            true,
            true,
            abandoned
        )
        .is_none(),
        "an abandoned read's only slice was taken as the vault's text because it was a first"
    );
    assert!(
        state.corpus.is_none(),
        "the vault was left holding nothing and called read"
    );
    assert!(
        !state.corpus_loading,
        "the refused slice left the vault unreadable for the rest of the session"
    );
}

#[test]
fn an_ask_left_waiting_by_a_vault_switch_is_owed_a_read() {
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));

    // Somebody switched vaults, then searched in the one they switched to. The read they were turned away by has just let go.
    state.pending_search = Some(typed("dharma"));
    assert!(
        read_is_owed(&state),
        "a search left waiting by a vault switch was never given a read"
    );

    // A map does the same, and nothing brings it back on its own: the page is already showing its waiting state.
    state.pending_search = None;
    state.pending_graph = Some(GraphRequest::default());
    assert!(
        read_is_owed(&state),
        "a map left waiting by a vault switch was never given a read"
    );
}

#[test]
fn re_picking_the_folder_the_pane_is_already_in_is_not_a_move() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.active = 7;
    state.root = Some(root.clone());

    // The two slips this exists for: New vault… on a folder already registered, and Change folder… accepting the folder the vault already shows. Both arrive as this same id and this same folder.
    assert!(
        !pointing_here_is_a_move(&state, 7, Some(&root)),
        "re-picking the folder the pane is already in was read as leaving it, so a whole vault's text went with it"
    );

    // A real switch, and each half of one on its own.
    assert!(
        pointing_here_is_a_move(&state, 9, Some(Path::new("/another-vault"))),
        "switching to another vault kept text read under the one we left"
    );
    assert!(
        pointing_here_is_a_move(&state, 7, Some(Path::new("/moved-vault"))),
        "moving a vault to a folder it was not in kept text read under the old one"
    );
    assert!(
        pointing_here_is_a_move(&state, 0, None),
        "going out to the whole library kept text read under the vault we left"
    );
}

#[test]
fn both_ways_of_pointing_at_a_vault_ask_whether_the_folder_moved_first() {
    // Both arms take an `EventLoopProxy` and nothing in this suite has one, so they are held as source the way the loop's own arms are.
    let source = include_str!("../vaults.rs");
    for arm in [
        "fn apply_active_vault(",
        "pub(crate) fn change_vault_folder(",
    ] {
        let at = source.find(arm).unwrap_or_else(|| {
            panic!("{arm} is one of the two ways the pane is pointed at a vault")
        });
        let body = &source[at..source.len().min(at + 1500)];
        let asked = body.find("pointing_here_is_a_move(").unwrap_or_else(|| {
            panic!("{arm} forgets a vault's text without asking whether its folder moved")
        });
        let forgotten = body.find("state.drop_corpus();").unwrap_or_else(|| {
            panic!("{arm} no longer forgets the text of a vault somebody really did leave")
        });
        assert!(
            asked < forgotten,
            "{arm} forgets the text first and asks whether the folder moved afterwards"
        );
        assert!(
            body[asked..forgotten].contains("if moved {"),
            "{arm} asks whether the folder moved and forgets the text whatever the answer"
        );
    }
}

#[test]
fn nothing_is_owed_while_a_read_is_still_running() {
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));
    state.pending_search = Some(typed("dharma"));
    // A slice thrown away mid-read is an ordinary thing, and it must not put a second read of the same folder on the machine.
    state.corpus_loading = true;
    assert!(
        !read_is_owed(&state),
        "a slice given up mid-read started a second read beside the one still going"
    );
}

#[test]
fn nothing_is_owed_with_nobody_waiting() {
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));
    assert!(
        !read_is_owed(&state),
        "a vault nobody has asked anything of was read anyway"
    );

    // And with no vault at all there is nothing to read, whoever is waiting.
    state.root = None;
    state.pending_search = Some(typed("dharma"));
    assert!(!read_is_owed(&state), "a read started with no vault open");
}

#[test]
fn giving_up_a_stale_slice_starts_the_read_the_open_vault_is_owed() {
    // The arm takes an `EventLoopProxy` and nothing in this suite has one, so it is held as source the way the loop's own arms are.
    let source = include_str!("../vaults.rs");
    let at = source
        .find("pub(crate) fn deliver_corpus(")
        .expect("a slice of a read is delivered");
    let body = &source[at..source.len().min(at + 1200)];

    assert!(
        body.contains("if read_is_owed(state) {"),
        "the arm that gives up a stale slice never asks whether the open vault is owed a read"
    );
    assert!(
        body.contains("read_corpus(state, proxy);"),
        "the arm that gives up a stale slice asks the question and then does nothing with the answer"
    );
}

#[test]
fn every_slice_of_a_read_carries_the_one_number_that_read_claimed() {
    // The read is a thread and a proxy, and nothing in this suite has either, so it is held as source the way the loop's own arms are. Nothing else can catch it: a number claimed again per slice would refuse every slice of every read and leave each vault empty, with the whole suite still green.
    let source = include_str!("../vaults.rs");
    let at = source
        .find("pub(crate) fn read_corpus(")
        .expect("the one read is started somewhere");
    let body = &source[at..source.len().min(at + 1400)];

    assert!(
        body.contains("let wanted = state.corpus_read.claim();"),
        "the read no longer claims the number that says anybody is waiting for it"
    );
    assert_eq!(
        body.matches("claim()").count(),
        1,
        "the read claims more than once, so its own slices are stamped with numbers it has already moved past"
    );
    assert!(
        body.contains("wanted,"),
        "a slice goes out without saying which read sent it, so a vault left and come back to keeps the tail of the read it abandoned"
    );
}

#[test]
fn a_fresh_read_replaces_the_text_it_finds_rather_than_growing_it() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    let reading = state.corpus_read.claim();
    absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("one")],
        false,
        Vec::new(),
        true,
        true,
        reading,
    );
    // A second read of the same vault — its files changed underneath, or it was left and came back to — so it claims its own number.
    let again = state.corpus_read.claim();
    let fresh = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("two")],
        false,
        Vec::new(),
        true,
        true,
        again,
    )
    .expect("the fresh read is kept");
    assert_eq!(
        fresh.corpus.documents.len(),
        1,
        "a fresh read was added to the last one's text"
    );
    assert_eq!(fresh.corpus.documents[0].label, "two");
}

/// One hit, which is all a memo test needs: what is kept matters here, not what it holds.
fn one_search_answer() -> SearchResults {
    SearchResults {
        hits: vec![leaftext::store::SearchHit {
            abs_path: "/vault/note.md".to_string(),
            title: "note".to_string(),
            alias: None,
            start_line: 3,
            end_line: 3,
            anchor: None,
            snippet: "a talk on dharma".to_string(),
            score: 1.0,
        }],
        truncated: false,
        understood: String::new(),
        unknown_fields: Vec::new(),
        skipped: Vec::new(),
        matched: vec!["/vault/note.md".to_string()],
    }
}

#[test]
fn an_answer_scanned_over_part_of_a_vault_is_never_kept() {
    let mut state = VaultState::load(None);
    let scanned = state.corpus_generation;
    // Two more slices landed while this scan was running, so the vault's text has moved on since it started.
    state.corpus_generation += 2;

    deliver_search(
        &mut state,
        None,
        None,
        "dharma",
        one_search_answer(),
        scanned,
        true,
    );
    assert!(
        state.search.remembered(&typed("dharma"), scanned).is_none(),
        "an answer that had seen half a vault was kept as the answer to that query"
    );

    deliver_search(
        &mut state,
        None,
        None,
        "dharma",
        one_search_answer(),
        scanned,
        false,
    );
    // Kept under the text it actually scanned, never under whatever the number had reached by the time it landed.
    assert!(state.search.remembered(&typed("dharma"), scanned).is_some());
    assert!(state
        .search
        .remembered(&typed("dharma"), state.corpus_generation)
        .is_none());
}

#[test]
fn the_same_query_over_unchanged_text_is_answered_from_the_last_one() {
    let mut state = VaultState::load(None);
    let answer = SearchResults {
        hits: vec![leaftext::store::SearchHit {
            abs_path: "/vault/note.md".to_string(),
            title: "note".to_string(),
            alias: None,
            start_line: 3,
            end_line: 3,
            anchor: None,
            snippet: "a talk on dharma".to_string(),
            score: 1.0,
        }],
        truncated: false,
        understood: String::new(),
        unknown_fields: Vec::new(),
        skipped: Vec::new(),
        matched: vec!["/vault/note.md".to_string()],
    };
    let corpus = state.corpus_generation;
    state.search.remember("dharma", corpus, answer);

    // The pane re-runs its search on every folder move, and the same query over the same text has the same answer.
    assert!(state.search.remembered(&typed("dharma"), corpus).is_some());
    // Another query is another question.
    assert!(state.search.remembered(&typed("dharmas"), corpus).is_none());
    // Text that has moved on since is not what the kept answer describes: the watcher patching the vault and a vault switch both count.
    assert!(state
        .search
        .remembered(&typed("dharma"), corpus + 1)
        .is_none());
    state.drop_corpus();
    assert!(state
        .search
        .remembered(&typed("dharma"), state.corpus_generation)
        .is_none());
}

#[test]
fn one_more_letter_scans_what_the_last_letter_matched() {
    let mut state = VaultState::load(None);
    let answer = SearchResults {
        hits: Vec::new(),
        truncated: false,
        understood: String::new(),
        unknown_fields: Vec::new(),
        skipped: Vec::new(),
        matched: vec!["/vault/one.md".to_string(), "/vault/two.md".to_string()],
    };
    let corpus = state.corpus_generation;
    state.search.remember("dhar", corpus, answer);

    // Typing on the end can only shrink the set, so the next keystroke reads those two documents rather than the vault.
    let within = state
        .search
        .narrowing(&typed("dharma"), corpus)
        .expect("a longer query narrows to the shorter one's matches");
    assert_eq!(within.len(), 2);

    // Everything else is a different question: the same query (already answered from the kept results), a letter deleted, a different word, another case.
    assert!(state.search.narrowing(&typed("dhar"), corpus).is_none());
    assert!(state.search.narrowing(&typed("dha"), corpus).is_none());
    assert!(state.search.narrowing(&typed("sutra"), corpus).is_none());
    assert!(state.search.narrowing(&typed("Dharma"), corpus).is_none());
    // And text that moved under it is not narrowed at all — a file saved mid-typing would otherwise be invisible until the query changed.
    assert!(state
        .search
        .narrowing(&typed("dharma"), corpus + 1)
        .is_none());
}

#[test]
fn the_vaults_text_is_patched_for_every_format_the_watcher_reports() {
    let dir = scratch_dir("the_vaults_text_is_patched_for_every_format_the_watcher_reports");
    let canonical = fs::canonicalize(&dir).expect("fixture directory canonicalizes");
    let root = plain_event_path(canonical.clone());

    let mut corpus = VaultCorpus::read(&root);
    for extension in all_document_extensions() {
        let name = format!("new.{extension}");
        fs::write(dir.join(&name), "hello").expect("fixture document is written");
        // As the watcher would report it, translated at the boundary.
        let changed = plain_event_path(canonical.join(&name));
        assert!(
            corpus.covers(&changed),
            "a new .{extension} under the vault must be the corpus's business"
        );
        assert!(
            corpus.refresh(&changed),
            "a new .{extension} under the vault must join the corpus"
        );
    }

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}
