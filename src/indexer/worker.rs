//! The background worker and the events it sends the page.

use super::*;

pub(super) enum WriterCmd {
    Scan,
    SyncPath(PathBuf),
}

pub(super) enum ReaderCmd {
    Tree,
    Search {
        query: String,
        /// When `Some`, restrict results to these document paths (the "Focus"
        /// search scope); `None` searches the whole library.
        scope: Option<Vec<String>>,
    },
    Graph(GraphRequest),
}

/// Owns the indexer's threads: a writer/coordinator (write connection + crawl)
/// and a reader (read-only connection) for tree/search/graph queries. Results
/// arrive through the sink passed to [`new`](IndexerWorker::new).
pub struct IndexerWorker {
    pub(super) writer_tx: Option<mpsc::Sender<WriterCmd>>,
    pub(super) reader_tx: Option<mpsc::Sender<ReaderCmd>>,
    pub(super) cancel: Arc<AtomicBool>,
    pub(super) writer_handle: Option<JoinHandle<()>>,
    pub(super) reader_handle: Option<JoinHandle<()>>,
}

impl IndexerWorker {
    /// Open the database (creating + migrating it on this thread so the reader's
    /// connection sees the schema), then spawn the writer and reader threads.
    pub fn new<F>(data_dir: PathBuf, sink: F) -> DbResult<Self>
    where
        F: Fn(IndexerEvent) + Send + Clone + 'static,
    {
        let write_conn = open_db(&data_dir)?;
        let cancel = Arc::new(AtomicBool::new(false));

        let (writer_tx, writer_rx) = mpsc::channel::<WriterCmd>();
        let (reader_tx, reader_rx) = mpsc::channel::<ReaderCmd>();

        let writer_sink = sink.clone();
        let writer_cancel = Arc::clone(&cancel);
        let writer_handle = thread::spawn(move || {
            let mut conn = write_conn;
            while let Ok(cmd) = writer_rx.recv() {
                match cmd {
                    WriterCmd::Scan => {
                        perform_scan(&mut conn, &writer_cancel, &writer_sink);
                    }
                    WriterCmd::SyncPath(path) => {
                        // Index or forget this one path, even when the "Index
                        // entire device" toggle is off.
                        sync_single_file(&mut conn, &path, &writer_sink);
                    }
                }
            }
        });

        let reader_sink = sink;
        let reader_handle = thread::spawn(move || {
            let conn = match open_read_db(&data_dir) {
                Ok(conn) => conn,
                Err(error) => {
                    reader_sink(IndexerEvent::Error(error));
                    return;
                }
            };
            while let Ok(cmd) = reader_rx.recv() {
                match cmd {
                    ReaderCmd::Tree => match build_tree(&conn) {
                        Ok(tree) => reader_sink(IndexerEvent::Library {
                            tree,
                            progress: ScanProgress {
                                phase: ScanPhase::Idle,
                                files_found: 0,
                            },
                        }),
                        Err(error) => reader_sink(IndexerEvent::Error(error)),
                    },
                    ReaderCmd::Search { query, scope } => {
                        let event = match search(&conn, &query, scope.as_deref()) {
                            Ok(hits) => IndexerEvent::SearchResults {
                                query,
                                hits,
                                error: None,
                            },
                            Err(error) => IndexerEvent::SearchResults {
                                query,
                                hits: Vec::new(),
                                error: Some(error),
                            },
                        };
                        reader_sink(event);
                    }
                    ReaderCmd::Graph(request) => {
                        let event = match build_graph(&conn, &request) {
                            Ok(graph) => IndexerEvent::Graph { graph, error: None },
                            Err(error) => IndexerEvent::Graph {
                                graph: DocumentGraph {
                                    nodes: Vec::new(),
                                    edges: Vec::new(),
                                    truncated: false,
                                },
                                error: Some(error),
                            },
                        };
                        reader_sink(event);
                    }
                }
            }
        });

        Ok(Self {
            writer_tx: Some(writer_tx),
            reader_tx: Some(reader_tx),
            cancel,
            writer_handle: Some(writer_handle),
            reader_handle: Some(reader_handle),
        })
    }

    /// Turn indexing on (start an immediate crawl / launch rescan) or off (cancel
    /// any active crawl promptly; no future scans are scheduled).
    pub fn set_indexing_enabled(&self, enabled: bool) {
        if enabled {
            self.cancel.store(false, Ordering::SeqCst);
            if let Some(tx) = &self.writer_tx {
                let _ = tx.send(WriterCmd::Scan);
            }
        } else {
            self.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Ask for the current tree from the read-only connection. Answers promptly
    /// even mid-crawl.
    pub fn request_tree(&self) {
        if let Some(tx) = &self.reader_tx {
            let _ = tx.send(ReaderCmd::Tree);
        }
    }

    /// Run a full-text search on the read-only connection. Results arrive through
    /// the sink as [`IndexerEvent::SearchResults`], so a long crawl never blocks
    /// the query.
    pub fn search(&self, query: String, scope: Option<Vec<String>>) {
        if let Some(tx) = &self.reader_tx {
            let _ = tx.send(ReaderCmd::Search { query, scope });
        }
    }

    /// Build the library link graph on the read-only connection; the result
    /// arrives via the sink as [`IndexerEvent::Graph`].
    pub fn request_graph(&self, request: GraphRequest) {
        if let Some(tx) = &self.reader_tx {
            let _ = tx.send(ReaderCmd::Graph(request));
        }
    }

    /// Bring one path up to date now (index if present, forget if gone),
    /// independent of the device-wide toggle. Keeps the pane current with "Index
    /// entire device" off.
    pub fn sync_path(&self, path: PathBuf) {
        if let Some(tx) = &self.writer_tx {
            let _ = tx.send(WriterCmd::SyncPath(path));
        }
    }
}

impl Drop for IndexerWorker {
    fn drop(&mut self) {
        // Cancel any crawl, then close the command channels so both threads fall
        // out of their recv loops, and join them.
        self.cancel.store(true, Ordering::SeqCst);
        self.writer_tx.take();
        self.reader_tx.take();
        if let Some(handle) = self.writer_handle.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.reader_handle.take() {
            let _ = handle.join();
        }
    }
}

// ---------------------------------------------------------------------------
// Event -> JS bridge
// ---------------------------------------------------------------------------

/// Turn an [`IndexerEvent`] into the JS call that delivers it to the webview.
/// The frontend escapes every file-derived string before it reaches the DOM.
pub fn event_script(event: &IndexerEvent) -> String {
    match event {
        IndexerEvent::Library { tree, progress } => {
            let payload = serde_json::json!({
                "tree": tree,
                "progress": progress,
                "error": serde_json::Value::Null,
            });
            format!("window.leafSetLibraryState({payload});")
        }
        IndexerEvent::Progress(progress) => {
            let payload = serde_json::to_string(progress).unwrap_or_else(|_| "null".to_string());
            format!("window.leafSetScanProgress({payload});")
        }
        IndexerEvent::SearchResults { query, hits, error } => {
            let payload = serde_json::json!({
                "query": query,
                "hits": hits,
                "error": error.as_ref().map(|message| serde_json::json!({ "message": message })),
            });
            format!("window.leafSetSearchResults({payload});")
        }
        IndexerEvent::Graph { graph, error } => {
            let payload = serde_json::json!({
                "nodes": graph.nodes,
                "edges": graph.edges,
                "truncated": graph.truncated,
                "error": error.as_ref().map(|message| serde_json::json!({ "message": message })),
            });
            format!("window.leafSetGraph({payload});")
        }
        IndexerEvent::Error(message) => {
            let payload = serde_json::json!({
                "tree": serde_json::Value::Null,
                "progress": serde_json::Value::Null,
                "error": { "message": message },
            });
            format!("window.leafSetLibraryState({payload});")
        }
    }
}
