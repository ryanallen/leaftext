//! Name and full-text search over the index.

use super::*;

/// Split user input into plain search terms: whitespace-separated, FTS operator
/// characters dropped. Shared by the FTS `MATCH` query and the filename match.
fn query_terms(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .filter_map(|raw| {
            let cleaned: String = raw
                .chars()
                .filter(|c| !matches!(c, '"' | '*' | '^' | '(' | ')' | ':'))
                .collect();
            let cleaned = cleaned.trim();
            if cleaned.is_empty() {
                None
            } else {
                Some(cleaned.to_string())
            }
        })
        .collect()
}

/// Turn user input into a safe FTS5 `MATCH` expression, or `None` for blank /
/// operator-only input. Each term becomes a quoted prefix token, so punctuation
/// and operators are literal text.
pub fn escape_fts_query(query: &str) -> Option<String> {
    let terms = query_terms(query);
    if terms.is_empty() {
        None
    } else {
        Some(
            terms
                .iter()
                .map(|term| format!("\"{term}\"*"))
                .collect::<Vec<_>>()
                .join(" "),
        )
    }
}

/// Escape LIKE metacharacters so `a_b` matches literally. Paired with `ESCAPE '\'`.
fn like_escape(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Build an ` AND f.abs_path IN (…)` fragment plus bound values restricting
/// results to `scope`. `None` = whole library (empty fragment); an empty slice
/// matches nothing (`AND 0`, since SQLite rejects a literal `IN ()`).
fn scope_clause(scope: Option<&[String]>) -> (String, Vec<Value>) {
    match scope {
        None => (String::new(), Vec::new()),
        Some(paths) if paths.is_empty() => (" AND 0".to_string(), Vec::new()),
        Some(paths) => {
            let placeholders = vec!["?"; paths.len()].join(",");
            let values = paths.iter().map(|p| Value::Text(p.clone())).collect();
            (format!(" AND f.abs_path IN ({placeholders})"), values)
        }
    }
}

fn search_by_name(
    conn: &Connection,
    terms: &[String],
    scope: Option<&[String]>,
) -> DbResult<Vec<SearchHit>> {
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let mut clauses = Vec::with_capacity(terms.len());
    let mut values: Vec<Value> = Vec::new();
    for term in terms {
        clauses.push(
            "(f.filename LIKE ? ESCAPE '\\' OR f.title LIKE ? ESCAPE '\\' \
              OR f.display_path LIKE ? ESCAPE '\\')",
        );
        let pattern = format!("%{}%", like_escape(term));
        values.push(Value::Text(pattern.clone()));
        values.push(Value::Text(pattern.clone()));
        values.push(Value::Text(pattern));
    }
    let (scope_sql, scope_values) = scope_clause(scope);
    values.extend(scope_values);
    values.push(Value::Integer(SEARCH_LIMIT));

    let sql = format!(
        "SELECT f.abs_path,
                COALESCE(NULLIF(f.title, ''), f.filename) AS title,
                f.display_path
         FROM files f
         WHERE f.status = 'ok' AND {}{}
         ORDER BY title COLLATE NOCASE, f.display_path COLLATE NOCASE
         LIMIT ?",
        clauses.join(" AND "),
        scope_sql,
    );

    let mut stmt = conn.prepare(&sql).map_err(to_err)?;
    let rows = stmt
        .query_map(params_from_iter(values), |row| {
            Ok(SearchHit {
                abs_path: row.get(0)?,
                title: row.get(1)?,
                start_line: 1,
                end_line: 1,
                anchor: None,
                snippet: row.get::<_, String>(2)?,
                score: 0.0,
            })
        })
        .map_err(to_err)?;
    let mut hits = Vec::new();
    for row in rows {
        hits.push(row.map_err(to_err)?);
    }
    Ok(hits)
}

/// Rank chunks against the prepared `match_query` with FTS5 `bm25()` and return
/// per-chunk snippets, scoped to `status = 'ok'` files.
fn search_by_content(
    conn: &Connection,
    match_query: &str,
    scope: Option<&[String]>,
) -> DbResult<Vec<SearchHit>> {
    let (scope_sql, scope_values) = scope_clause(scope);
    let sql = format!(
        "SELECT f.abs_path,
                COALESCE(NULLIF(f.title, ''), f.filename) AS title,
                c.start_line, c.end_line, c.anchor,
                snippet(chunks_fts, 0, char(2), char(3), '…', 12) AS snip,
                bm25(chunks_fts) AS score
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         JOIN files f ON f.id = c.file_id
         WHERE chunks_fts MATCH ? AND f.status = 'ok'{}
         ORDER BY score
         LIMIT ?",
        scope_sql,
    );
    let mut values: Vec<Value> = Vec::with_capacity(scope_values.len() + 2);
    values.push(Value::Text(match_query.to_string()));
    values.extend(scope_values);
    values.push(Value::Integer(SEARCH_LIMIT));
    let mut stmt = conn.prepare(&sql).map_err(to_err)?;

    let rows = stmt
        .query_map(params_from_iter(values), |row| {
            Ok(SearchHit {
                abs_path: row.get(0)?,
                title: row.get(1)?,
                start_line: row.get::<_, i64>(2)? as u32,
                end_line: row.get::<_, i64>(3)? as u32,
                anchor: row.get(4)?,
                snippet: row.get(5)?,
                score: row.get(6)?,
            })
        })
        .map_err(to_err)?;

    let mut hits = Vec::new();
    for row in rows {
        hits.push(row.map_err(to_err)?);
    }
    Ok(hits)
}

/// Search the library: filename/title/path matches first (a named file is a
/// strong hit), then content matches for files not already shown by name.
/// Scoped to `status = 'ok'`. Blank/operator queries return no hits.
pub fn search(
    conn: &Connection,
    query: &str,
    scope: Option<&[String]>,
) -> DbResult<Vec<SearchHit>> {
    let terms = query_terms(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    let limit = SEARCH_LIMIT as usize;
    let mut hits = search_by_name(conn, &terms, scope)?;
    let mut seen: HashSet<String> = hits.iter().map(|hit| hit.abs_path.clone()).collect();

    if hits.len() < limit {
        if let Some(match_query) = escape_fts_query(query) {
            for hit in search_by_content(conn, &match_query, scope)? {
                if hits.len() >= limit {
                    break;
                }
                if seen.insert(hit.abs_path.clone()) {
                    hits.push(hit);
                }
            }
        }
    }

    hits.truncate(limit);
    Ok(hits)
}

// ---------------------------------------------------------------------------
// File writes
// ---------------------------------------------------------------------------
