//! Reacting to filesystem changes after the initial scan.

use super::*;

/// Bring one path up to date with disk, outside any crawl: index a readable
/// file or forget a gone one. The live path for opened/edited files and the
/// right-click actions.
fn sync_markdown_file(conn: &mut Connection, abs: &Path) -> DbResult<()> {
    let Some(root) = abs.ancestors().last().map(Path::to_path_buf) else {
        return Ok(());
    };
    let meta = std::fs::metadata(io_path(abs)).map_err(to_err)?;
    let scan_root = match ensure_roots(conn, &[root.clone()]) {
        Ok(roots) => match roots.into_iter().next() {
            Some(root) => root,
            None => return Ok(()),
        },
        Err(error) => return Err(error),
    };

    let job = ParseJob {
        root_id: scan_root.id,
        display_path: display_path_for(&root, abs),
        filename: abs
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        abs_path: abs.to_path_buf(),
        size: meta.len() as i64,
        mtime: mtime_secs(&meta),
    };
    let never_cancel = AtomicBool::new(false);
    let outcome = process_file(&job, &never_cancel);
    apply_result(conn, ParseResult { job, outcome }, None)
}

fn like_prefix(prefix: &str) -> String {
    let mut escaped = String::with_capacity(prefix.len());
    for ch in prefix.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '%' => escaped.push_str("\\%"),
            '_' => escaped.push_str("\\_"),
            _ => escaped.push(ch),
        }
    }
    escaped.push('%');
    escaped
}

fn forget_directory_tree(conn: &mut Connection, dir: &Path, sink: &dyn Fn(IndexerEvent)) {
    let dir_text = path_to_string(dir);
    let prefix = if dir_text.ends_with(['/', '\\']) {
        dir_text.clone()
    } else {
        format!("{dir_text}{}", std::path::MAIN_SEPARATOR)
    };
    let like = like_prefix(&prefix);
    let removed = match conn.execute(
        "DELETE FROM files WHERE abs_path LIKE ?1 ESCAPE '\\'",
        params![like],
    ) {
        Ok(count) => count,
        Err(error) => {
            sink(IndexerEvent::Error(to_err(error)));
            return;
        }
    };
    if removed > 0 {
        emit_tree(conn, sink);
    }
}

fn sync_directory_tree(conn: &mut Connection, dir: &Path, sink: &dyn Fn(IndexerEvent)) {
    let mut queue = VecDeque::from([dir.to_path_buf()]);
    let mut seen = HashSet::new();

    while let Some(current) = queue.pop_front() {
        let entries = match std::fs::read_dir(io_path(&current)) {
            Ok(entries) => entries,
            Err(error) => {
                if is_benign_dir_error(&error) {
                    continue;
                }
                sink(IndexerEvent::Error(to_err(error)));
                return;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            let child = current.join(entry.file_name());
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };

            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_repo_noise_dir(&name) || is_dir_reparse(&child) {
                    continue;
                }
                queue.push_back(child);
                continue;
            }

            if !file_type.is_file() || !is_indexable_file(&child) {
                continue;
            }

            let abs = normal_path(&child);
            seen.insert(path_to_string(&abs));
            if let Err(error) = sync_markdown_file(conn, &abs) {
                sink(IndexerEvent::Error(error));
                return;
            }
        }
    }

    let dir_text = path_to_string(dir);
    let prefix = if dir_text.ends_with(['/', '\\']) {
        dir_text.clone()
    } else {
        format!("{dir_text}{}", std::path::MAIN_SEPARATOR)
    };
    let like = like_prefix(&prefix);
    let mut stale =
        match conn.prepare("SELECT abs_path FROM files WHERE abs_path LIKE ?1 ESCAPE '\\'") {
            Ok(stmt) => stmt,
            Err(error) => {
                sink(IndexerEvent::Error(to_err(error)));
                return;
            }
        };
    let rows = match stale.query_map(params![like], |row| row.get::<_, String>(0)) {
        Ok(rows) => rows,
        Err(error) => {
            sink(IndexerEvent::Error(to_err(error)));
            return;
        }
    };
    let stale_paths: Vec<String> = rows.filter_map(Result::ok).collect();
    drop(stale);

    for abs_path in stale_paths {
        if !seen.contains(&abs_path) {
            if let Err(error) =
                conn.execute("DELETE FROM files WHERE abs_path = ?1", params![abs_path])
            {
                sink(IndexerEvent::Error(to_err(error)));
                return;
            }
        }
    }

    emit_tree(conn, sink);
}

pub(super) fn sync_single_file(conn: &mut Connection, path: &Path, sink: &dyn Fn(IndexerEvent)) {
    let Some(abs) = resolve_for_manifest(path) else {
        return;
    };
    match std::fs::metadata(io_path(&abs)) {
        Ok(meta) if meta.is_dir() => {
            sync_directory_tree(conn, &abs, sink);
        }
        Ok(meta) if meta.is_file() && is_indexable_file(&abs) => {
            if let Err(error) = sync_markdown_file(conn, &abs) {
                sink(IndexerEvent::Error(error));
                return;
            }
            emit_tree(conn, sink);
        }
        Ok(_) => {}
        Err(_) if is_indexable_file(&abs) => {
            forget_single_file(conn, &abs, sink);
        }
        Err(_) => {
            forget_directory_tree(conn, &abs, sink);
        }
    }
}

/// Drop one file from the manifest; foreign keys cascade to its headings,
/// chunks, frontmatter, and feature state. Refreshes the pane only when a row
/// was removed.
fn forget_single_file(conn: &mut Connection, abs: &Path, sink: &dyn Fn(IndexerEvent)) {
    let removed = match conn.execute(
        "DELETE FROM files WHERE abs_path = ?1",
        params![path_to_string(abs)],
    ) {
        Ok(count) => count,
        Err(error) => {
            sink(IndexerEvent::Error(to_err(error)));
            return;
        }
    };
    if removed > 0 {
        emit_tree(conn, sink);
    }
}

// ---------------------------------------------------------------------------
// Worker handle
// ---------------------------------------------------------------------------
