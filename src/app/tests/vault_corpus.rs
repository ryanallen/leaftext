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

/// A vault's held text, over the documents named.
fn corpus_of(paths: &[&str]) -> VaultCorpus {
    VaultCorpus {
        root: PathBuf::from("/vault"),
        documents: paths
            .iter()
            .map(|path| CorpusDocument {
                path: path.to_string(),
                label: "note".to_string(),
                aliases: Vec::new(),
                text: "a talk on dharma".to_string(),
            })
            .collect(),
        truncated: false,
        skipped: Vec::new(),
    }
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
        !state.hints_owed,
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
    assert!(state.hints_owed, "the completion menu was never filled");
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

    // The fast gesture: away and back before the walk ended, so the read broke having sent nothing. Its one slice replaces and is also its last and holds no documents — the case a test that trusted the mark keeps, leaving the vault empty and calling it read.
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
    // Both ways of pointing the pane at a vault run this, and both must ask whether the folder moved before the root is overwritten: asked afterwards, the answer is about what has already arrived and every switch keeps text belonging somewhere else.
    let mut state = VaultState::load(None);
    state.active = 7;
    state.root = Some(PathBuf::from("/vault"));
    state.folder = "/vault/notes".to_string();
    state.corpus = Some(Arc::new(corpus_of(&["/vault/notes/one.md"])));

    assert!(
        point_at_vault(&mut state, 9, Some(PathBuf::from("/another-vault"))),
        "switching to another vault kept text read under the one we left"
    );
    assert!(
        state.corpus.is_none(),
        "the vault's text is about somewhere else now"
    );
    assert!(
        state.folder.is_empty(),
        "the pane stayed in a folder of the vault we left"
    );
    assert_eq!(state.active, 9);
    assert_eq!(state.root.as_deref(), Some(Path::new("/another-vault")));

    // Accepting the folder a vault already shows is not leaving it, so its text stands.
    state.corpus = Some(Arc::new(corpus_of(&["/another-vault/two.md"])));
    assert!(
        !point_at_vault(&mut state, 9, Some(PathBuf::from("/another-vault"))),
        "re-picking the folder you are already in threw its text away"
    );
    assert!(
        state.corpus.is_some(),
        "the text of a vault nobody left was forgotten"
    );

    // Moving that vault to a folder it was not in, and going out to the whole library, are both real moves.
    assert!(point_at_vault(
        &mut state,
        9,
        Some(PathBuf::from("/moved-vault"))
    ));
    state.corpus = Some(Arc::new(corpus_of(&["/moved-vault/three.md"])));
    assert!(point_at_vault(&mut state, 0, None));
    assert!(state.corpus.is_none());
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
    let left = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(left.clone());
    state.corpus_loading = true;
    let reading = state.corpus_read.claim();

    // The reader switches vaults and types straight away, so the query is parked behind the read they left.
    state.drop_corpus();
    state.root = Some(PathBuf::from("/another-vault"));
    state.pending_search = Some(typed("dharma"));

    // The abandoned read's last slice is worthless, and giving it up is what frees the one read — so the vault on screen gets its own here or waits for ever.
    assert!(matches!(
        delivered_slice_work(
            &mut state,
            &left,
            Vec::new(),
            false,
            Vec::new(),
            true,
            true,
            reading
        ),
        SliceWork::StartTheOwedRead
    ));
}

#[test]
fn every_slice_of_a_read_carries_the_one_number_that_read_claimed() {
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));

    // The read claims its number once, here, and hands it to the worker that stamps every slice with it. A number claimed again per slice would refuse every slice of every read and leave each vault empty, with the whole suite still green.
    let started = corpus_read_to_start(&mut state).expect("an unread vault starts its one read");
    assert!(
        started.counter.is_current(started.wanted),
        "the read is stamped with a number the reader has already moved past"
    );
    assert_eq!(started.root, PathBuf::from("/vault"));

    // And it is one read at a time: a second ask while that one runs starts nothing.
    assert!(
        corpus_read_to_start(&mut state).is_none(),
        "a second read of the same vault started beside the first"
    );

    // Leaving the vault moves the number past what the running read carries, so its slices are refused rather than absorbed into the vault arrived at.
    state.drop_corpus();
    assert!(!started.counter.is_current(started.wanted));

    // The next vault claims its own, and it is not the abandoned one.
    state.root = Some(PathBuf::from("/another-vault"));
    state.corpus_loading = false;
    let next = corpus_read_to_start(&mut state).expect("the vault arrived at is read");
    assert_ne!(next.wanted, started.wanted);
    assert!(next.counter.is_current(next.wanted));
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

/// The whole shape of a read that starts with a preview: the batch the walk handed over is what the vault holds while the folders are still being listed, the first sorted slice throws it away rather than adding to it, and the slices after that grow. Whichever query is in the box at the time is the one every slice answers, so typing again while the ring turns is answered off the preview and again off the whole vault.
#[test]
fn the_preview_starts_the_text_and_the_first_sorted_slice_throws_it_away() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus_loading = true;
    // Somebody searched a vault nobody had read, which is what paid for the walk.
    state.pending_search = Some(typed("dharma"));
    let reading = state.corpus_read.claim();

    let preview = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("in-the-first-folder")],
        false,
        Vec::new(),
        true,
        false,
        reading,
    )
    .expect("the preview is for the vault on screen");
    assert_eq!(preview.corpus.documents.len(), 1);
    assert!(
        state.corpus_partial,
        "a vault one folder into its walk was called whole"
    );
    assert!(
        preview.parked.is_some(),
        "the preview did not answer the query that paid for the walk"
    );
    assert!(
        !state.hints_owed && preview.graph.is_none(),
        "the preview filled the completion menu or drew the map off one folder"
    );

    // The reader typed again while the ring was still turning, so this is the query every later slice owes an answer to.
    state.pending_search = Some(typed("practice"));

    let sorted = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("smallest")],
        false,
        Vec::new(),
        true,
        false,
        reading,
    )
    .expect("the first sorted slice is kept");
    assert_eq!(
        sorted
            .corpus
            .documents
            .iter()
            .map(|doc| doc.label.clone())
            .collect::<Vec<_>>(),
        vec!["smallest".to_string()],
        "the first sorted slice grew the preview rather than replacing it"
    );
    assert_eq!(
        sorted.parked.map(|query| query.text),
        Some("practice".to_string()),
        "the slice answered the query the reader had already typed past"
    );
    assert!(
        state.pending_search.is_some(),
        "the newer query was taken out of its slot before the read was over"
    );

    let last = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("bigger")],
        false,
        Vec::new(),
        false,
        true,
        reading,
    )
    .expect("the last slice is kept");
    assert_eq!(
        last.corpus
            .documents
            .iter()
            .map(|doc| doc.label.clone())
            .collect::<Vec<_>>(),
        vec!["smallest".to_string(), "bigger".to_string()],
        "a later sorted slice replaced the text instead of growing it"
    );
    assert!(
        !state.corpus_partial && !state.corpus_loading,
        "a finished read still called its text partial"
    );
    assert!(
        state.hints_owed,
        "the completion menu was never filled from the whole vault"
    );
    assert!(
        state.pending_search.is_none(),
        "the finished read left its query parked for ever"
    );
}

/// The preview is refused by the same two questions every other slice is. It lands earliest of all, so a reader who has already moved on is exactly who it would reach.
#[test]
fn a_preview_from_a_vault_the_reader_left_is_refused() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus_loading = true;
    let abandoned = state.corpus_read.claim();

    // Away and back inside the walk, so the root matches again while the read nobody is waiting on is still delivering.
    state.drop_corpus();
    state.root = Some(PathBuf::from("/another-vault"));
    state.drop_corpus();
    state.root = Some(root.clone());

    assert!(
        absorb_corpus_slice(
            &mut state,
            &root,
            vec![slice_document("one")],
            false,
            Vec::new(),
            true,
            false,
            abandoned
        )
        .is_none(),
        "a preview from the read they walked out on became the vault's text"
    );
    assert!(
        state.corpus.is_none(),
        "the abandoned preview was left standing as the whole vault"
    );

    // And one from another folder entirely, which is the other question.
    let reading = state.corpus_read.claim();
    assert!(
        absorb_corpus_slice(
            &mut state,
            &PathBuf::from("/somewhere-else"),
            vec![slice_document("one")],
            false,
            Vec::new(),
            true,
            false,
            reading
        )
        .is_none(),
        "a preview walked under another vault was taken as this one's text"
    );
    assert!(state.corpus.is_none());
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
    for extension in all_document_extensions()
        .into_iter()
        .filter(|extension| !leaftext::source_extensions().contains(extension))
    {
        let name = format!("new.{extension}");
        fs::write(dir.join(&name), "hello").expect("fixture document is written");
        // As the watcher would report it, translated at the boundary.
        let changed = plain_event_path(canonical.join(&name));
        assert!(
            corpus.covers(&changed),
            "a new .{extension} under the vault must be the corpus's business"
        );
        // A packaged format's file is an archive, and five bytes of prose is not one — so this fixture can only ask the boundary question of those six. That a real Word file joins the corpus with its own words in it is proved beside the readers, in `a_vault_reads_a_word_files_words`.
        if leaftext::DocumentFormat::from_extension(extension)
            .is_some_and(|format| format.source_shape() == leaftext::SourceShape::Bytes)
        {
            continue;
        }
        assert!(
            corpus.refresh(&changed).text,
            "a new .{extension} under the vault must join the corpus"
        );
    }

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

/// One document as a slice of the read carries it, with the text the read found on disk before anything changed it.
fn slice_document_at(path: &Path, text: &str) -> CorpusDocument {
    CorpusDocument {
        path: path.to_string_lossy().to_string(),
        label: path
            .file_stem()
            .expect("the fixture document has a name")
            .to_string_lossy()
            .to_string(),
        aliases: Vec::new(),
        text: text.to_string(),
    }
}

/// A change made while the vault is being read waits for the read to finish, then lands once. Patched in as it arrived, the slice that replaces the preview would throw it away and a slice arriving later would carry the file back as it was before the save.
#[test]
fn a_change_made_during_a_read_lands_once_when_the_read_ends() {
    let dir = scratch_dir("a_change_made_during_a_read_lands_once_when_the_read_ends");
    let canonical = fs::canonicalize(&dir).expect("fixture directory canonicalizes");
    let root = plain_event_path(canonical.clone());
    let note = plain_event_path(canonical.join("note.md"));
    let sibling = plain_event_path(canonical.join("sibling.md"));
    fs::write(&note, "the words the read found").expect("fixture note is written");
    fs::write(&sibling, "the words the read found").expect("fixture sibling is written");
    let note_as_read = slice_document_at(&note, "the words the read found");
    let sibling_as_read = slice_document_at(&sibling, "the words the read found");

    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus_loading = true;
    let reading = state.corpus_read.claim();

    // Saved before the read had handed over anything at all.
    fs::write(&note, "the note says dharma").expect("the note is saved");
    assert!(
        !record_or_refresh_corpus_path(&mut state, &note).text,
        "a change was patched into text the read still owns"
    );

    absorb_corpus_slice(
        &mut state,
        &root,
        vec![note_as_read],
        false,
        Vec::new(),
        true,
        false,
        reading,
    )
    .expect("the first sorted slice is kept");

    // Saved again between slices, this time to a document the read has not reached.
    fs::write(&sibling, "the sibling says dharma").expect("the sibling is saved");
    assert!(!record_or_refresh_corpus_path(&mut state, &sibling).text);

    let last = absorb_corpus_slice(
        &mut state,
        &root,
        vec![sibling_as_read],
        false,
        Vec::new(),
        false,
        true,
        reading,
    )
    .expect("the last slice is kept");

    let text = |path: &Path| {
        let key = path.to_string_lossy().to_string();
        let found: Vec<&CorpusDocument> = last
            .corpus
            .documents
            .iter()
            .filter(|document| document.path == key)
            .collect();
        assert_eq!(
            found.len(),
            1,
            "{key} is in the vault's text more than once"
        );
        found[0].text.clone()
    };
    assert!(
        text(&note).contains("the note says dharma"),
        "a save made before the read's first slice was lost"
    );
    assert!(
        text(&sibling).contains("the sibling says dharma"),
        "a save made between two slices was lost"
    );
    assert!(
        state.corpus_changes.is_empty(),
        "the finished read left its changes waiting for the next one"
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

/// Changes kept for a read nobody is waiting on go with it. Replayed later they would name a vault the reader has left, or be read a second time into text the new read has already read fresh.
#[test]
fn changes_kept_for_an_abandoned_read_are_discarded() {
    let root = PathBuf::from("/vault");
    let changed = PathBuf::from("/vault/note.md");

    let mut left = VaultState::load(None);
    left.root = Some(root.clone());
    left.corpus_loading = true;
    left.corpus_read.claim();
    record_or_refresh_corpus_path(&mut left, &changed);
    assert!(!left.corpus_changes.is_empty(), "the change was not kept");
    left.drop_corpus();
    assert!(
        left.corpus_changes.is_empty(),
        "leaving the vault kept changes about somewhere else"
    );

    let mut reread = VaultState::load(None);
    reread.root = Some(root);
    reread.corpus_loading = true;
    reread.corpus_read.claim();
    record_or_refresh_corpus_path(&mut reread, &changed);
    // The read that was running has to have let go before another can start.
    reread.corpus_loading = false;
    corpus_read_to_start(&mut reread).expect("the open vault starts a read");
    assert!(
        reread.corpus_changes.is_empty(),
        "a replacement read kept changes it re-reads off the disk itself"
    );
}

/// With no read running there is nothing for a change to wait behind, so it is read straight into the held text — which is what makes a save findable without switching vaults or saving again.
#[test]
fn a_change_after_the_read_refreshes_the_held_text_at_once() {
    let dir = scratch_dir("a_change_after_the_read_refreshes_the_held_text_at_once");
    let canonical = fs::canonicalize(&dir).expect("fixture directory canonicalizes");
    let root = plain_event_path(canonical.clone());
    let note = plain_event_path(canonical.join("note.md"));
    fs::write(&note, "the words the read found").expect("fixture note is written");

    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus = Some(Arc::new(VaultCorpus::read(&root)));

    fs::write(&note, "the note says dharma").expect("the note is saved");
    assert!(
        record_or_refresh_corpus_path(&mut state, &note).text,
        "a save against a finished vault moved nothing"
    );
    let corpus = state.corpus.as_ref().expect("the vault's text is held");
    assert!(
        corpus
            .documents
            .iter()
            .any(|document| document.text.contains("the note says dharma")),
        "the save was not findable until the vault was read again"
    );
    assert!(
        state.corpus_changes.is_empty(),
        "a change with no read running was kept instead of read"
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

/// The names the completion menu would be offered, walked over the vault as it stands.
fn hint_names(state: &VaultState) -> Vec<String> {
    state
        .corpus
        .as_ref()
        .expect("the vault's text is held")
        .filter_hints()
        .fields
        .into_iter()
        .map(|field| field.name)
        .collect()
}

/// A vault of two notes on disk, held as this state's text, with the read finished.
fn vault_with_fields(label: &str) -> (PathBuf, PathBuf, VaultState) {
    let dir = scratch_dir(label);
    let canonical = fs::canonicalize(&dir).expect("fixture directory canonicalizes");
    let root = plain_event_path(canonical);
    fs::write(root.join("a.md"), "---\nstatus: open\n---\n\n# A\n").expect("fixture note written");
    fs::write(root.join("b.md"), "---\nowner: mai\n---\n\n# B\n").expect("fixture note written");

    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus = Some(Arc::new(VaultCorpus::read(&root)));
    // The read that filled it has handed over its last slice, so the menu is already owed one walk.
    state.hints_owed = false;
    (dir, root, state)
}

#[test]
fn a_note_that_gains_a_field_puts_its_name_in_the_completion_menu() {
    let (dir, root, mut state) = vault_with_fields("hints-gained");
    assert!(!hint_names(&state).contains(&"project".to_string()));

    fs::write(
        root.join("a.md"),
        "---\nstatus: open\nproject: solo\n---\n\n# A\n",
    )
    .expect("the field is written");
    let moved = record_or_refresh_corpus_path(&mut state, &root.join("a.md"));

    assert!(moved.fields, "the new field did not ask for a fresh walk");
    assert!(
        state.hints_owed,
        "a field written into a note left the menu offering the vault's old names"
    );
    assert!(
        hint_names(&state).contains(&"project".to_string()),
        "the walk over the patched text still does not know the field"
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn the_last_note_to_drop_a_field_takes_its_name_out_of_the_completion_menu() {
    let (dir, root, mut state) = vault_with_fields("hints-dropped");
    assert!(hint_names(&state).contains(&"owner".to_string()));

    // The only note that set it, rewritten without it — the direction a menu that only ever grows can never answer.
    fs::write(root.join("b.md"), "# B\n").expect("the field is removed");
    let moved = record_or_refresh_corpus_path(&mut state, &root.join("b.md"));

    assert!(
        moved.fields,
        "the dropped field did not ask for a fresh walk"
    );
    assert!(state.hints_owed);
    assert!(
        !hint_names(&state).contains(&"owner".to_string()),
        "the menu still completes to a field nothing in the vault sets"
    );

    // And a save that leaves the frontmatter alone asks for nothing, so the page is not rewritten on every keystroke somebody saves.
    state.hints_owed = false;
    fs::write(
        root.join("a.md"),
        "---\nstatus: open\n---\n\n# A\n\nmore prose\n",
    )
    .expect("the body is written");
    let body_only = record_or_refresh_corpus_path(&mut state, &root.join("a.md"));
    assert!(body_only.text && !body_only.fields);
    assert!(
        !state.hints_owed,
        "an edit to a note's prose asked for a walk of the whole vault"
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn a_walk_overtaken_by_a_later_one_never_reaches_the_page() {
    let mut state = VaultState::load(None);
    state.corpus_generation = 7;

    // The newer walk lands first and is the answer.
    assert!(filter_hints_are_current(&mut state, 7));
    // The one it overtook saw older text, so it is dropped rather than drawn over the newer list.
    assert!(!filter_hints_are_current(&mut state, 5));
    // And the same answer arriving twice is not a second answer.
    assert!(!filter_hints_are_current(&mut state, 7));

    // Leaving the vault moves the number past every walk still running for it.
    state.corpus = Some(Arc::new(corpus_of(&["/vault/note.md"])));
    state.corpus_generation = 9;
    state.drop_corpus();
    assert!(
        !filter_hints_are_current(&mut state, 9),
        "a walk over the vault just left was drawn into the menu"
    );
    assert!(
        !state.hints_owed,
        "leaving a vault left a walk owed for the one before it"
    );
}

#[test]
fn a_change_to_a_file_the_vault_does_not_hold_asks_for_no_walk() {
    let (dir, root, mut state) = vault_with_fields("hints-uncovered");

    // A picture, git's own bookkeeping, and a document outside the vault: none of them is the corpus's business.
    for path in [
        root.join("diagram.png"),
        root.join(".git").join("index"),
        dir.join("outside.md"),
    ] {
        let moved = record_or_refresh_corpus_path(&mut state, &path);
        assert_eq!(moved, CorpusChange::NOTHING);
        assert!(
            !state.hints_owed,
            "{} asked the menu for a walk of the whole vault",
            path.display()
        );
    }

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn a_read_no_search_asked_for_still_leaves_the_completion_menu_a_walk() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    // Nothing is parked: this read was started by the map or the code view, which is the read the reader who has not searched yet gets.
    assert!(state.pending_search.is_none());
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
    )
    .expect("the only slice is for the vault on screen");

    assert!(
        state.hints_owed,
        "a read no search asked for left the completion menu empty"
    );
}
