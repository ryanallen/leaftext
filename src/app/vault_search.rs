//! Searching the active vault's text: one worker thread, and the counter that tells it a query has been overtaken.
//!
//! A keystroke is a query, and a fast typist sends one every 150 ms. A thread each is eight characters running eight full scans at once and seven answers thrown away on arrival, so there is one thread and one counter: the scan reads it between documents and stops as soon as the field has moved on.

use super::*;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};

/// The one search thread, and the number that says which query is wanted.
///
/// Created on the first search, so an app nobody searches in spawns nothing.
#[derive(Default)]
pub(crate) struct VaultSearch {
    jobs: Option<Sender<SearchJob>>,
    pub(crate) generation: SearchGeneration,
    /// The last answer, and what it was an answer to. The pane re-runs its search every time the folder on screen changes, and the field losing and regaining focus asks again too — neither is a reason to read the vault twice.
    last: Option<SearchMemo>,
}

struct SearchMemo {
    query: String,
    corpus: u64,
    results: SearchResults,
    /// Every path that matched, shared with the worker that scans them next.
    matched: Arc<Vec<String>>,
}

/// Which query is being waited for. The loop claims a number per keystroke; the scan reads it between documents, and anything holding an older one is work nobody will read.
#[derive(Clone, Default)]
pub(crate) struct SearchGeneration(Arc<AtomicU64>);

impl SearchGeneration {
    /// Claim the next query number. Every earlier scan is stale from here on.
    pub(crate) fn claim(&self) -> u64 {
        self.0.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Whether an answer stamped `generation` is still the one being waited for.
    pub(crate) fn is_current(&self, generation: u64) -> bool {
        self.0.load(Ordering::Relaxed) == generation
    }

    /// Abandon whatever is running, with nothing taking its place.
    pub(crate) fn cancel(&self) {
        self.0.fetch_add(1, Ordering::Relaxed);
    }
}

struct SearchJob {
    corpus: Arc<VaultCorpus>,
    query: String,
    /// The vault this was asked of, so an answer whose vault moved is dropped.
    scope: Option<PathBuf>,
    generation: u64,
    /// The paths a shorter version of this query matched, when there is one to narrow to — see [`VaultSearch::narrowing`].
    within: Option<Arc<Vec<String>>>,
}

impl VaultSearch {
    /// Abandon whatever is running. Called when the vault moves: the answer would be about somewhere we have left.
    pub(crate) fn cancel(&self) {
        self.generation.cancel();
    }

    /// The answer to this query, if it is the one already given and the vault's text has not moved since.
    pub(crate) fn remembered(&self, query: &str, corpus: u64) -> Option<SearchResults> {
        let last = self.last.as_ref()?;
        (last.query == query && last.corpus == corpus).then(|| last.results.clone())
    }

    /// The paths to scan for `query`, when a shorter query has already been answered over the same text. Typing one more letter can only ever shrink the set — every term is required, and the longer query's terms contain the shorter one's — so the documents that missed before cannot match now.
    pub(crate) fn narrowing(&self, query: &str, corpus: u64) -> Option<Arc<Vec<String>>> {
        let last = self.last.as_ref()?;
        // Same text, and this query is the last one with more typed on the end. Anything else — a letter deleted, a different case, a space added — is a different question and gets the whole vault.
        (last.corpus == corpus && query.len() > last.query.len() && query.starts_with(&last.query))
            .then(|| Arc::clone(&last.matched))
    }

    pub(crate) fn remember(&mut self, query: &str, corpus: u64, mut results: SearchResults) {
        let matched = Arc::new(std::mem::take(&mut results.matched));
        self.last = Some(SearchMemo {
            query: query.to_string(),
            corpus,
            results,
            matched,
        });
    }
}

/// Search the vault's text. Same wait-for-the-read shape as the graph, and the same one read behind both.
pub(crate) fn request_vault_search(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    query: String,
) {
    // Already answered, over text that has not changed since. Sent as an event rather than painted here, so a kept answer and a fresh one arrive by one path.
    if let Some(results) = state.search.remembered(&query, state.corpus_generation) {
        state.search.generation.cancel();
        let _ = proxy.send_event(UserEvent::SearchReady {
            scope: state.root.clone(),
            query,
            results,
        });
        return;
    }
    match state.corpus.clone() {
        Some(corpus) => {
            let within = state.search.narrowing(&query, state.corpus_generation);
            run_search(state, proxy, corpus, query, within)
        }
        None => {
            // One slot, so this is last-one-wins already: the counter is claimed when the read lands and the parked query finally runs.
            state.pending_search = Some(query);
            read_corpus(state, proxy);
        }
    }
}

pub(crate) fn run_search(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    corpus: Arc<VaultCorpus>,
    query: String,
    within: Option<Arc<Vec<String>>>,
) {
    let job = SearchJob {
        corpus,
        query,
        scope: state.root.clone(),
        generation: state.search.generation.claim(),
        within,
    };
    let counter = state.search.generation.clone();
    let worker = match state.search.jobs.as_ref() {
        Some(jobs) => jobs,
        None => state
            .search
            .jobs
            .insert(spawn_search_worker(proxy, counter)),
    };
    // The worker is gone — a scan panicked. Answer this query on its own thread and let the next one start a fresh worker, rather than leaving the box dead.
    if let Err(mpsc::SendError(job)) = worker.send(job) {
        state.search.jobs = None;
        off_loop(proxy, move || search_ready(job));
    }
}

/// One thread for every query there will ever be. It holds the counter rather than the loop's state, because that is the only thing a worker may read while the loop is running.
fn spawn_search_worker(
    proxy: &EventLoopProxy<UserEvent>,
    generation: SearchGeneration,
) -> Sender<SearchJob> {
    let (sender, jobs) = mpsc::channel::<SearchJob>();
    let proxy = proxy.clone();
    thread::spawn(move || {
        for job in jobs {
            // Overtaken while it waited its turn: nobody is going to read this.
            if !generation.is_current(job.generation) {
                continue;
            }
            let overtaken = || !generation.is_current(job.generation);
            let within = job.within.as_ref().map(|paths| paths.as_slice());
            let Some(results) = job.corpus.search_until(&job.query, within, &overtaken) else {
                continue;
            };
            if proxy
                .send_event(UserEvent::SearchReady {
                    scope: job.scope,
                    query: job.query,
                    results,
                })
                .is_err()
            {
                break; // the window is gone
            }
        }
    });
    sender
}

/// The whole scan, run to completion off the worker: the fallback path when the worker thread has died and this query would otherwise go unanswered.
fn search_ready(job: SearchJob) -> UserEvent {
    let within = job.within.as_ref().map(|paths| paths.as_slice());
    let results = job
        .corpus
        .search_until(&job.query, within, &|| false)
        .unwrap_or_default();
    UserEvent::SearchReady {
        scope: job.scope,
        query: job.query,
        results,
    }
}

/// Paint a finished search, unless the field or the vault moved past it. The page also drops answers to queries it has moved on from, so a slow one is harmless twice over.
pub(crate) fn deliver_search(
    state: &mut VaultState,
    webview: Option<&WebView>,
    scope: Option<PathBuf>,
    query: &str,
    results: SearchResults,
) {
    if scope != state.root {
        return;
    }
    run_page_script(
        webview,
        &search_results_script(query, &results),
        "Failed to show search results",
    );
    state
        .search
        .remember(query, state.corpus_generation, results);
}
