//! Walking the roots: the parse pool, per-file work, progress reporting.

use super::*;

pub(super) struct ParseJob {
    pub(super) root_id: i64,
    pub(super) abs_path: PathBuf,
    pub(super) display_path: String,
    pub(super) filename: String,
    pub(super) size: i64,
    pub(super) mtime: i64,
}

pub(super) enum FileOutcome {
    Indexed {
        content_hash: String,
        title: String,
        headings: Vec<Heading>,
        chunks: Vec<Chunk>,
        frontmatter: Vec<FrontmatterField>,
        links: Vec<DocLink>,
    },
    Unreadable,
    Cancelled,
}

pub(super) struct ParseResult {
    pub(super) job: ParseJob,
    pub(super) outcome: FileOutcome,
}

/// Read, hash, and parse a single file. Pure CPU/IO; no database access. Hashes
/// the full indexed content (not a prefix) so edits anywhere change the hash.
pub(super) fn process_file(job: &ParseJob, cancel: &AtomicBool) -> FileOutcome {
    if cancel.load(Ordering::SeqCst) {
        return FileOutcome::Cancelled;
    }
    // Read at most MAX_INDEX_BYTES; a file over the cap is indexed from this
    // prefix rather than skipped, so it still appears and is searchable.
    let mut bytes = Vec::new();
    match std::fs::File::open(io_path(&job.abs_path)) {
        Ok(file) => {
            if file.take(MAX_INDEX_BYTES).read_to_end(&mut bytes).is_err() {
                return FileOutcome::Unreadable;
            }
        }
        Err(_) => return FileOutcome::Unreadable,
    }
    // A file at/beyond the cap was cut off and may end in a partial codepoint.
    let truncated = bytes.len() as u64 >= MAX_INDEX_BYTES;
    if bytes.contains(&0u8) {
        return FileOutcome::Unreadable;
    }
    let content = match std::str::from_utf8(&bytes) {
        Ok(text) => text.to_string(),
        // A truncated read may split a char at the end; keep the valid prefix.
        Err(error) if truncated => {
            String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned()
        }
        Err(_) => return FileOutcome::Unreadable,
    };
    let content_hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    // Parsing runs here on the parse pool; the writer thread only persists.
    // Link extraction runs for every type so the graph can edge MD and XML.
    let links = document_links(&content, &job.abs_path);
    // Only Markdown is outlined and chunked for search so far; a tree format
    // contributes its title and links, leaving the rest empty. Titles come from the
    // renderer the reading view uses, so the library and the tab agree on the name.
    let title = match DocumentFormat::from_path(&job.abs_path) {
        DocumentFormat::Xml => crate::render_xml_body(&content).0,
        DocumentFormat::Json => crate::render_json_body(&content).0,
        DocumentFormat::Yaml => crate::render_yaml_body(&content).0,
        DocumentFormat::Markdown => {
            let parsed = parse_markdown(&content, &stem_of(&job.filename));
            return FileOutcome::Indexed {
                content_hash,
                title: parsed.title,
                headings: parsed.headings,
                chunks: chunk_file(&content),
                frontmatter: frontmatter_fields(&content),
                links,
            };
        }
    };
    FileOutcome::Indexed {
        content_hash,
        title: title.unwrap_or_else(|| stem_of(&job.filename)),
        headings: Vec::new(),
        chunks: Vec::new(),
        frontmatter: Vec::new(),
        links,
    }
}

pub(super) fn apply_result(
    conn: &mut Connection,
    result: ParseResult,
    scan_run_id: Option<i64>,
) -> DbResult<()> {
    let job = result.job;
    let abs = path_to_string(&job.abs_path);
    match result.outcome {
        FileOutcome::Indexed {
            content_hash,
            title,
            headings,
            chunks,
            frontmatter,
            links,
        } => {
            write_file_record(
                conn,
                job.root_id,
                &abs,
                &job.display_path,
                &job.filename,
                job.size,
                job.mtime,
                "ok",
                Some(&content_hash),
                Some(&title),
                &headings,
                &chunks,
                &frontmatter,
                &links,
                scan_run_id,
            )?;
        }
        FileOutcome::Unreadable => {
            write_file_record(
                conn,
                job.root_id,
                &abs,
                &job.display_path,
                &job.filename,
                job.size,
                job.mtime,
                "unreadable",
                None,
                None,
                &[],
                &[],
                &[],
                &[],
                scan_run_id,
            )?;
        }
        FileOutcome::Cancelled => {}
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/// Run one incremental scan over `roots`. Used for both the first crawl and
/// every later launch rescan; unchanged files fast-path on `mtime + size`.
pub(super) fn run_scan(
    conn: &mut Connection,
    roots: &[ScanRoot],
    cancel: &Arc<AtomicBool>,
    sink: &dyn Fn(IndexerEvent),
) -> DbResult<()> {
    let scan_run_id: i64 = conn
        .query_row(
            "INSERT INTO scan_runs (started_at, completed) VALUES (?1, 0) RETURNING id",
            params![now_secs()],
            |row| row.get(0),
        )
        .map_err(to_err)?;
    for root in roots {
        conn.execute(
            "INSERT INTO scan_run_roots (scan_run_id, scan_root_id, completed) VALUES (?1, ?2, 0)",
            params![scan_run_id, root.id],
        )
        .map_err(to_err)?;
    }

    // Spin up the parse/hash pool. One bounded job queue (shared receiver) and an
    // unbounded result channel back to this writer thread.
    let (job_tx, job_rx) = mpsc::sync_channel::<ParseJob>(JOB_QUEUE_BOUND);
    let (result_tx, result_rx) = mpsc::channel::<ParseResult>();
    let job_rx = Arc::new(Mutex::new(job_rx));
    let mut workers: Vec<JoinHandle<()>> = Vec::with_capacity(PARSE_WORKERS);
    for _ in 0..PARSE_WORKERS {
        let rx = Arc::clone(&job_rx);
        let tx = result_tx.clone();
        let cancel = Arc::clone(cancel);
        workers.push(thread::spawn(move || loop {
            let job = {
                let guard = match rx.lock() {
                    Ok(guard) => guard,
                    Err(_) => break,
                };
                guard.recv()
            };
            match job {
                Ok(job) => {
                    let outcome = process_file(&job, &cancel);
                    if tx.send(ParseResult { job, outcome }).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }));
    }
    drop(result_tx);

    let mut files_found: u64 = 0;
    let mut last_progress = Instant::now();
    let mut last_tree = Instant::now();
    let mut tree_dirty = false;

    // Tell the UI a scan is underway right away.
    sink(IndexerEvent::Progress(ScanProgress {
        phase: ScanPhase::Scanning,
        files_found,
    }));

    for root in roots {
        let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
        queue.push_back((root.path.clone(), 0));
        let mut dispatched = 0usize;
        let mut written = 0usize;
        let mut root_failed = false;

        while let Some((dir, depth)) = queue.pop_front() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let entries = match std::fs::read_dir(io_path(&dir)) {
                Ok(entries) => entries,
                Err(error) => {
                    if depth == 0 || !is_benign_dir_error(&error) {
                        // Root unreadable, or a non-benign error deeper: fail the
                        // root so its files aren't demoted on this partial run.
                        root_failed = true;
                        break;
                    }
                    continue;
                }
            };

            for entry in entries {
                if cancel.load(Ordering::SeqCst) {
                    break;
                }
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => continue,
                };
                let name = entry.file_name();
                let name_str = name.to_string_lossy().to_string();
                let child = dir.join(&name);
                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(_) => continue,
                };

                if file_type.is_dir() {
                    if is_repo_noise_dir(&name_str) {
                        continue;
                    }
                    if depth == 0 && is_system_dir(&name_str) {
                        continue;
                    }
                    if is_dir_reparse(&child) {
                        continue;
                    }
                    queue.push_back((child, depth + 1));
                } else if file_type.is_file() && is_indexable_file(&child) {
                    files_found += 1;
                    if last_progress.elapsed() >= PROGRESS_THROTTLE {
                        sink(IndexerEvent::Progress(ScanProgress {
                            phase: ScanPhase::Scanning,
                            files_found,
                        }));
                        last_progress = Instant::now();
                    }

                    let meta = match std::fs::metadata(io_path(&child)) {
                        Ok(meta) => meta,
                        Err(_) => continue,
                    };
                    let size = meta.len() as i64;
                    let mtime = mtime_secs(&meta);
                    let abs = path_to_string(&child);

                    let existing = lookup_file(conn, &abs)?;
                    let fast_id = if let Some(existing) = &existing {
                        if existing.mtime == mtime
                            && existing.size == size
                            && existing.derived_version == CURRENT_DERIVED_VERSION
                            && all_features_current(
                                conn,
                                existing.id,
                                existing.content_hash.as_deref(),
                            )?
                        {
                            Some(existing.id)
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    if let Some(id) = fast_id {
                        update_last_seen(conn, id, scan_run_id)?;
                    } else {
                        let job = ParseJob {
                            root_id: root.id,
                            display_path: display_path_for(&root.path, &child),
                            filename: name_str.clone(),
                            abs_path: child.clone(),
                            size,
                            mtime,
                        };
                        if job_tx.send(job).is_ok() {
                            dispatched += 1;
                            tree_dirty = true;
                        }
                        // Apply any results that are ready so memory stays bounded
                        // and the tree refresh below has fresh rows.
                        while let Ok(result) = result_rx.try_recv() {
                            apply_result(conn, result, Some(scan_run_id))?;
                            written += 1;
                        }
                    }

                    if tree_dirty && last_tree.elapsed() >= TREE_THROTTLE {
                        // Drain what is ready before snapshotting so shallow files
                        // surface first.
                        while let Ok(result) = result_rx.try_recv() {
                            apply_result(conn, result, Some(scan_run_id))?;
                            written += 1;
                        }
                        let tree = build_tree(conn)?;
                        sink(IndexerEvent::Library {
                            tree,
                            progress: ScanProgress {
                                phase: ScanPhase::Scanning,
                                files_found,
                            },
                        });
                        last_tree = Instant::now();
                        tree_dirty = false;
                    }
                }
            }
        }

        // Drain every dispatched result for this root before deciding completion
        // (workers always send one result per job, even when cancelling).
        while written < dispatched {
            match result_rx.recv() {
                Ok(result) => {
                    apply_result(conn, result, Some(scan_run_id))?;
                    written += 1;
                }
                Err(_) => break,
            }
        }

        // Missing-marking is gated on per-root completion, so a cancelled or
        // failed root never demotes its files.
        if !cancel.load(Ordering::SeqCst) && !root_failed {
            mark_root_completed(conn, scan_run_id, root.id)?;
            mark_missing_for_root(conn, root.id, scan_run_id)?;
        }
    }

    // Close the job channel and wait for the pool to wind down.
    drop(job_tx);
    for worker in workers {
        let _ = worker.join();
    }

    if !cancel.load(Ordering::SeqCst) {
        conn.execute(
            "UPDATE scan_runs SET finished_at = ?2, completed = 1 WHERE id = ?1",
            params![scan_run_id, now_secs()],
        )
        .map_err(to_err)?;
        prune_old_runs(conn)?;
    }

    // Final snapshot: hide the scanning indicator and deliver the settled tree.
    let tree = build_tree(conn)?;
    sink(IndexerEvent::Library {
        tree,
        progress: ScanProgress {
            phase: ScanPhase::Idle,
            files_found,
        },
    });
    Ok(())
}

pub(super) fn perform_scan(
    conn: &mut Connection,
    cancel: &Arc<AtomicBool>,
    sink: &dyn Fn(IndexerEvent),
) {
    let roots = detect_roots();
    let scan_roots = match ensure_roots(conn, &roots) {
        Ok(roots) => roots,
        Err(error) => {
            sink(IndexerEvent::Error(error));
            return;
        }
    };
    if let Err(error) = run_scan(conn, &scan_roots, cancel, sink) {
        sink(IndexerEvent::Error(error));
    }
}

/// Normalize a path for manifest storage: make it absolute, then strip any
/// `\\?\` prefix to match the crawl's convention. `None` when a relative path
/// has no current directory to anchor against.
pub(super) fn resolve_for_manifest(path: &Path) -> Option<PathBuf> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    Some(normal_path(&abs))
}

/// Push the current tree to the pane after a single-file change. Errors surface
/// as a backend error event rather than silently leaving the pane stale.
pub(super) fn emit_tree(conn: &Connection, sink: &dyn Fn(IndexerEvent)) {
    match build_tree(conn) {
        Ok(tree) => sink(IndexerEvent::Library {
            tree,
            progress: ScanProgress {
                phase: ScanPhase::Idle,
                files_found: 0,
            },
        }),
        Err(error) => sink(IndexerEvent::Error(error)),
    }
}
