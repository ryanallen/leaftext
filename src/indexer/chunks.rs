//! Splitting a document into the chunks search matches against.

use super::*;

#[derive(Debug, Clone, PartialEq)]
pub(super) struct Heading {
    pub(super) ordinal: i64,
    pub(super) depth: i64,
    pub(super) text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct ParsedDoc {
    pub(super) title: String,
    pub(super) headings: Vec<Heading>,
}

fn heading_depth(level: pulldown_cmark::HeadingLevel) -> i64 {
    use pulldown_cmark::HeadingLevel::*;
    match level {
        H1 => 1,
        H2 => 2,
        H3 => 3,
        H4 => 4,
        H5 => 5,
        H6 => 6,
    }
}

/// Parse the title (first H1, else the filename) and the document's headings in
/// document order. Uses the real Markdown parser, not regex.
pub(super) fn parse_markdown(content: &str, fallback_title: &str) -> ParsedDoc {
    use pulldown_cmark::{Event, Parser, Tag, TagEnd};

    let mut headings: Vec<Heading> = Vec::new();
    let mut ordinal = 0i64;
    let mut current: Option<(i64, String)> = None;

    for event in Parser::new(content) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current = Some((heading_depth(level), String::new()));
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((depth, text)) = current.take() {
                    headings.push(Heading {
                        ordinal,
                        depth,
                        text: text.trim().to_string(),
                    });
                    ordinal += 1;
                }
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some((_, accumulator)) = current.as_mut() {
                    accumulator.push_str(&text);
                }
            }
            _ => {}
        }
    }

    let title = headings
        .iter()
        .find(|h| h.depth == 1 && !h.text.is_empty())
        .map(|h| h.text.clone())
        .unwrap_or_else(|| fallback_title.to_string());

    ParsedDoc { title, headings }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/// Byte offset of the start of each source line. `line_of` maps any byte offset
/// to its one-based line number with a binary search.
fn line_starts_of(content: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (index, byte) in content.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(index + 1);
        }
    }
    starts
}

fn line_of(line_starts: &[usize], offset: usize) -> i64 {
    // The count of line starts at or before `offset` is its one-based line.
    line_starts.partition_point(|&start| start <= offset) as i64
}

/// A top-level Markdown block with its source byte range. Headings carry the
/// rendered slug so the section's chunks can point at them.
pub(super) struct SourceBlock {
    pub(super) start: usize,
    pub(super) end: usize,
    pub(super) is_heading: bool,
    pub(super) anchor: Option<String>,
}

/// Split a document into searchable chunks, delimited by headings; each chunk
/// carries its heading's slug as its anchor. A section over [`CHUNK_TARGET_BYTES`]
/// splits at block boundaries. Deterministic. Slugs match the renderer's own
/// `unique_heading_slug`, so `leafScrollToFragment` can land on the heading.
pub fn chunk_file(content: &str) -> Vec<Chunk> {
    let line_starts = line_starts_of(content);
    let blocks = collect_source_blocks(content);

    let mut chunks: Vec<Chunk> = Vec::new();
    let mut ordinal: i64 = 0;
    let mut current_anchor: Option<String> = None;
    let mut pending_start: Option<usize> = None;
    let mut pending_end: usize = 0;

    let flush = |chunks: &mut Vec<Chunk>,
                 ordinal: &mut i64,
                 start: &mut Option<usize>,
                 end: usize,
                 anchor: &Option<String>| {
        if let Some(from) = start.take() {
            let text = content[from..end].trim();
            if !text.is_empty() {
                chunks.push(Chunk {
                    ordinal: *ordinal,
                    start_line: line_of(&line_starts, from),
                    end_line: line_of(&line_starts, end.saturating_sub(1)),
                    anchor: anchor.clone(),
                    text: text.to_string(),
                    text_hash: blake3::hash(text.as_bytes()).to_hex().to_string(),
                });
                *ordinal += 1;
            }
        }
    };

    for block in blocks {
        if block.is_heading {
            // A heading starts a new section: flush the previous, then open a
            // fresh chunk with the heading line.
            flush(
                &mut chunks,
                &mut ordinal,
                &mut pending_start,
                pending_end,
                &current_anchor,
            );
            current_anchor = block.anchor.clone();
            pending_start = Some(block.start);
            pending_end = block.end;
            continue;
        }
        if pending_start.is_none() {
            pending_start = Some(block.start);
        }
        pending_end = block.end;
        // Once a section's accumulated source exceeds the target, close the chunk
        // at this block boundary. A single oversized block still becomes one chunk.
        if let Some(from) = pending_start {
            if pending_end.saturating_sub(from) >= CHUNK_TARGET_BYTES {
                flush(
                    &mut chunks,
                    &mut ordinal,
                    &mut pending_start,
                    pending_end,
                    &current_anchor,
                );
            }
        }
    }
    flush(
        &mut chunks,
        &mut ordinal,
        &mut pending_start,
        pending_end,
        &current_anchor,
    );

    chunks
}

/// Record each top-level block's byte range, tagging headings with their slug.
/// A per-document `seen` set gives duplicates the same `-1`/`-2` suffixes the
/// renderer assigns.
fn collect_source_blocks(content: &str) -> Vec<SourceBlock> {
    use pulldown_cmark::{Event, Parser, Tag};

    let mut blocks: Vec<SourceBlock> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut depth: i32 = 0;
    let mut block_start: usize = 0;
    let mut is_heading = false;
    let mut heading_text = String::new();

    for (event, range) in Parser::new_ext(content, crate::markdown_options()).into_offset_iter() {
        match &event {
            Event::Start(tag) => {
                if depth == 0 {
                    block_start = range.start;
                    is_heading = matches!(tag, Tag::Heading { .. });
                    heading_text.clear();
                } else if is_heading {
                    crate::append_heading_slug_text(&event, &mut heading_text);
                }
                depth += 1;
            }
            Event::End(_) => {
                depth -= 1;
                if depth == 0 {
                    let anchor = if is_heading {
                        Some(crate::unique_heading_slug(&heading_text, &mut seen))
                    } else {
                        None
                    };
                    blocks.push(SourceBlock {
                        start: block_start,
                        end: range.end,
                        is_heading,
                        anchor,
                    });
                }
            }
            _ => {
                if depth == 0 {
                    // A standalone top-level block (thematic break, raw HTML block).
                    blocks.push(SourceBlock {
                        start: range.start,
                        end: range.end,
                        is_heading: false,
                        anchor: None,
                    });
                } else if is_heading {
                    crate::append_heading_slug_text(&event, &mut heading_text);
                }
            }
        }
    }

    blocks
}

/// Replace one file's chunks, preserving `chunks.id` for surviving `(file_id,
/// ordinal)` rows: surviving ordinals update in place only when changed, new
/// ones insert, removed ones delete. The triggers keep `chunks_fts` in sync.
pub fn replace_chunks(conn: &Connection, file_id: i64, chunks: &[Chunk]) -> DbResult<()> {
    struct ExistingChunk {
        start_line: i64,
        end_line: i64,
        anchor: Option<String>,
        text_hash: String,
    }

    let mut existing: HashMap<i64, ExistingChunk> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT ordinal, start_line, end_line, anchor, text_hash
                 FROM chunks WHERE file_id = ?1",
            )
            .map_err(to_err)?;
        let rows = stmt
            .query_map(params![file_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    ExistingChunk {
                        start_line: row.get(1)?,
                        end_line: row.get(2)?,
                        anchor: row.get(3)?,
                        text_hash: row.get(4)?,
                    },
                ))
            })
            .map_err(to_err)?;
        for row in rows {
            let (ordinal, value) = row.map_err(to_err)?;
            existing.insert(ordinal, value);
        }
    }

    for chunk in chunks {
        match existing.remove(&chunk.ordinal) {
            Some(prev) => {
                let unchanged = prev.text_hash == chunk.text_hash
                    && prev.start_line == chunk.start_line
                    && prev.end_line == chunk.end_line
                    && prev.anchor == chunk.anchor;
                if !unchanged {
                    conn.execute(
                        "UPDATE chunks
                         SET start_line = ?3, end_line = ?4, anchor = ?5, text = ?6, text_hash = ?7
                         WHERE file_id = ?1 AND ordinal = ?2",
                        params![
                            file_id,
                            chunk.ordinal,
                            chunk.start_line,
                            chunk.end_line,
                            chunk.anchor,
                            chunk.text,
                            chunk.text_hash,
                        ],
                    )
                    .map_err(to_err)?;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO chunks
                        (file_id, ordinal, start_line, end_line, anchor, text, text_hash)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        file_id,
                        chunk.ordinal,
                        chunk.start_line,
                        chunk.end_line,
                        chunk.anchor,
                        chunk.text,
                        chunk.text_hash,
                    ],
                )
                .map_err(to_err)?;
            }
        }
    }

    for ordinal in existing.keys() {
        conn.execute(
            "DELETE FROM chunks WHERE file_id = ?1 AND ordinal = ?2",
            params![file_id, ordinal],
        )
        .map_err(to_err)?;
    }

    Ok(())
}

/// Remove all of a file's chunks (when it leaves status `ok`). The `chunks_ad`
/// trigger drops the matching FTS rows.
pub(super) fn delete_chunks(conn: &Connection, file_id: i64) -> DbResult<()> {
    conn.execute("DELETE FROM chunks WHERE file_id = ?1", params![file_id])
        .map_err(to_err)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------
//
// Parser scope (a documented subset, kept pure-Rust rather than a YAML crate):
//   - `key: value`
//   - `key: [a, b, c]`
//   - `key:` followed by `- item` block-list entries
//   - all scalars stored as text
// Unrecognized lines are skipped, never fatal. Keys are lowercased.
