//! The link graph the graph view renders.

use super::*;

/// The label shown on a graph node: the document title, else its filename with a
/// Markdown extension stripped.
fn graph_label(title: Option<&str>, filename: &str) -> String {
    match title {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => stem_of(filename),
    }
}

/// Build the library link graph: one node per `ok` document, one undirected edge
/// per link resolving to another indexed document. Path links match `abs_path`
/// (exact, then case-insensitively); `[[wiki]]` links match a filename stem.
/// Dangling links contribute no edge. `request` chooses the slice (see
/// [`GraphRequest`]).
pub fn build_graph(conn: &Connection, request: &GraphRequest) -> DbResult<DocumentGraph> {
    // 1. Load every indexed document and index it by id + resolution keys.
    struct Row {
        id: i64,
        path: String,
        label: String,
    }
    let mut stmt = conn
        .prepare("SELECT id, abs_path, filename, title FROM files WHERE status = 'ok'")
        .map_err(to_err)?;
    let rows: Vec<Row> = stmt
        .query_map([], |row| {
            let path: String = row.get(1)?;
            let filename: String = row.get(2)?;
            let title: Option<String> = row.get(3)?;
            Ok(Row {
                id: row.get(0)?,
                label: graph_label(title.as_deref(), &filename),
                path,
            })
        })
        .map_err(to_err)?
        .collect::<Result<_, _>>()
        .map_err(to_err)?;

    let mut path_to_id: HashMap<String, i64> = HashMap::with_capacity(rows.len());
    let mut lower_path_to_id: HashMap<String, i64> = HashMap::with_capacity(rows.len());
    // Name keys can collide across folders; first writer wins, which is a fine
    // best-effort for wiki-style links in a flat vault.
    let mut name_to_id: HashMap<String, i64> = HashMap::new();
    for row in &rows {
        path_to_id.insert(row.path.clone(), row.id);
        lower_path_to_id
            .entry(row.path.to_lowercase())
            .or_insert(row.id);
        let filename = Path::new(&row.path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        name_to_id
            .entry(normalize_name_key(&stem_of(&filename)))
            .or_insert(row.id);
    }

    // 2. Resolve every link to a target document id, collecting undirected edges
    //    keyed by the ordered id pair so A->B and B->A collapse to one edge.
    let mut link_stmt = conn
        .prepare("SELECT from_file_id, target_abs, target_name FROM links")
        .map_err(to_err)?;
    let resolved = link_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(to_err)?;

    let mut edge_set: HashSet<(i64, i64)> = HashSet::new();
    for entry in resolved {
        let (from_id, target_abs, target_name) = entry.map_err(to_err)?;
        let to_id = target_abs
            .as_deref()
            .and_then(|abs| {
                path_to_id
                    .get(abs)
                    .or_else(|| lower_path_to_id.get(&abs.to_lowercase()))
                    .copied()
            })
            .or_else(|| {
                target_name
                    .as_deref()
                    .and_then(|name| name_to_id.get(name).copied())
            });
        let Some(to_id) = to_id else { continue };
        if to_id == from_id {
            continue; // a document linking itself is not an edge
        }
        let key = if from_id < to_id {
            (from_id, to_id)
        } else {
            (to_id, from_id)
        };
        edge_set.insert(key);
    }

    // 3. Degree per node, then choose which documents to keep for the requested
    //    scope: a focused neighborhood, the densest N, or everything.
    let mut degree: HashMap<i64, u32> = HashMap::new();
    for (a, b) in &edge_set {
        *degree.entry(*a).or_insert(0) += 1;
        *degree.entry(*b).or_insert(0) += 1;
    }

    let (kept, truncated): (Vec<&Row>, bool) = if let Some(seeds) = &request.focus {
        // Focus: the seed documents plus every document one link away. Seeds are
        // paths the frontend stored as node ids; resolve them exactly, then
        // case-insensitively (matching how links resolve on Windows).
        let mut adjacency: HashMap<i64, Vec<i64>> = HashMap::new();
        for (a, b) in &edge_set {
            adjacency.entry(*a).or_default().push(*b);
            adjacency.entry(*b).or_default().push(*a);
        }
        let mut included: HashSet<i64> = HashSet::new();
        for seed in seeds {
            let id = path_to_id
                .get(seed)
                .or_else(|| lower_path_to_id.get(&seed.to_lowercase()))
                .copied();
            if let Some(id) = id {
                included.insert(id);
                if let Some(neighbors) = adjacency.get(&id) {
                    included.extend(neighbors.iter().copied());
                }
            }
        }
        (
            rows.iter()
                .filter(|row| included.contains(&row.id))
                .collect(),
            false,
        )
    } else if let Some(limit) = request.limit.filter(|limit| rows.len() > *limit) {
        // Capped: keep the densest documents, flag the result as partial.
        let mut ranked: Vec<&Row> = rows.iter().collect();
        ranked.sort_by(|a, b| {
            degree
                .get(&b.id)
                .unwrap_or(&0)
                .cmp(degree.get(&a.id).unwrap_or(&0))
                .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
        });
        ranked.truncate(limit);
        (ranked, true)
    } else {
        // Everything (the XL scope, or a capped scope under its limit).
        (rows.iter().collect(), false)
    };
    let kept_ids: HashSet<i64> = kept.iter().map(|row| row.id).collect();
    let id_to_path: HashMap<i64, &str> =
        kept.iter().map(|row| (row.id, row.path.as_str())).collect();

    let nodes: Vec<GraphNode> = kept
        .iter()
        .map(|row| GraphNode {
            path: row.path.clone(),
            label: row.label.clone(),
            degree: *degree.get(&row.id).unwrap_or(&0),
        })
        .collect();

    let edges: Vec<GraphEdge> = edge_set
        .into_iter()
        .filter(|(a, b)| kept_ids.contains(a) && kept_ids.contains(b))
        .map(|(a, b)| GraphEdge {
            source: id_to_path[&a].to_string(),
            target: id_to_path[&b].to_string(),
        })
        .collect();

    Ok(DocumentGraph {
        nodes,
        edges,
        truncated,
    })
}

// ---------------------------------------------------------------------------
// Parse pool
// ---------------------------------------------------------------------------
