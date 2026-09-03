use crate::*;

/// One page in the Previous/Next reading order: the file to open and the label shown on the pager button.
pub(crate) struct PagerEntry {
    path: PathBuf,
    label: String,
}

pub fn document_pager_html(current: impl AsRef<Path>) -> String {
    pager_html(current.as_ref())
}

pub fn pager_loaded_script(path: impl AsRef<Path>, html: &str) -> String {
    let state = serde_json::json!({
        "path": path.as_ref().display().to_string(),
        "html": html,
    });
    format!("window.leafSetPager({state});")
}

/// The waiting state under a document, for a host that can find its neighbors and mean it.
pub fn pager_loading_html() -> Option<&'static str> {
    Some(
        r#"<nav class="docs-pager docs-pager-loading" aria-label="Document navigation" aria-busy="true"><span class="docs-pager-skeleton"><span class="lt-skeleton docs-pager-label-skeleton"></span><span class="lt-skeleton docs-pager-title-skeleton"></span></span><span class="docs-pager-skeleton docs-pager-next"><span class="lt-skeleton docs-pager-label-skeleton"></span><span class="lt-skeleton docs-pager-title-skeleton"></span></span></nav>"#,
    )
}

/// Build the Previous/Next pager for `current`. Ordering is a depth-first walk of the doc tree: at each folder, non-README files first (sorted by name), then each subfolder (its README as the landing page), then that folder's pages. The root is the highest ancestor still covered by a chain of READMEs. Empty string when the file has no neighbors.
pub(crate) fn pager_html(current: &Path) -> String {
    let root = pager_doc_root(current);
    let entries = collect_pager_entries(&root);

    let same = |a: &Path, b: &Path| -> bool {
        a == b || matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
    };
    let position = entries.iter().position(|entry| same(&entry.path, current));

    // The root README is the landing page, not a sequential entry; opening it sits before the first page (index -1, prev: none, next: first page).
    let index: isize = match position {
        Some(found) => found as isize,
        None => match readme_in(&root) {
            Some(readme) if same(&readme, current) => -1,
            _ => return String::new(),
        },
    };

    let prev = if index > 0 {
        entries.get((index - 1) as usize)
    } else {
        None
    };
    let next = entries.get((index + 1) as usize);
    if prev.is_none() && next.is_none() {
        return String::new();
    }

    // The page this button opens, for the hover card. Carried on the anchor because the pager is the only thing that knows it — the card sees a `file://` URL and nothing else.
    let button = |entry: &PagerEntry, side: &str, kicker: &str| -> String {
        match file_url_for_path(&entry.path) {
            Some(url) => format!(
                r#"<a class="docs-pager-{side}" href="{href}" data-pager-title="{attr}"><span class="docs-pager-label">{kicker}</span>{title}</a>"#,
                side = side,
                href = encode_text(url.as_str()),
                kicker = kicker,
                attr = encode_double_quoted_attribute(&entry.label),
                title = encode_text(&entry.label),
            ),
            None => "<span></span>".to_string(),
        }
    };
    let prev_html = prev.map_or_else(
        || "<span></span>".to_string(),
        |entry| button(entry, "prev", "Previous"),
    );
    let next_html = next.map_or_else(
        || "<span></span>".to_string(),
        |entry| button(entry, "next", "Next"),
    );

    format!(
        r#"<nav class="docs-pager" aria-label="Document navigation">{prev_html}{next_html}</nav>"#
    )
}

/// The case-insensitive `README.md` inside `dir`, if any.
pub(crate) fn readme_in(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.flatten().find_map(|entry| {
        let name = entry.file_name();
        let name = name.to_str()?;
        name.eq_ignore_ascii_case("README.md").then(|| entry.path())
    })
}

/// Climb from the current file's folder to the highest ancestor whose parent is no longer part of the README-covered documentation tree.
pub(crate) fn pager_doc_root(current: &Path) -> PathBuf {
    let mut root = current.parent().unwrap_or(current).to_path_buf();
    while let Some(parent) = root.parent() {
        if readme_in(parent).is_some() {
            root = parent.to_path_buf();
        } else {
            break;
        }
    }
    root
}

/// Depth-first collection of pager entries under `dir` (see [`pager_html`]). `README.md` (folder index, added by the parent) and `GLOSSARY.md` (opened in the glossary sheet, never a sequential page) are excluded as standalone pages.
pub(crate) fn collect_pager_entries(dir: &Path) -> Vec<PagerEntry> {
    let mut entries = Vec::new();
    collect_pager_entries_into(dir, &mut entries);
    entries
}

pub(crate) fn collect_pager_entries_into(dir: &Path, into: &mut Vec<PagerEntry>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut files: Vec<PathBuf> = Vec::new();
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            subdirs.push(path);
        } else if path.file_name().and_then(|n| n.to_str()).is_some() {
            // Every format the app renders is a page; README (landing page) and GLOSSARY (the sheet) are excluded by stem.
            let is_doc = is_listed_document_path(&path);
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            let is_index =
                stem.eq_ignore_ascii_case("README") || stem.eq_ignore_ascii_case("GLOSSARY");
            if is_doc && !is_index {
                files.push(path);
            }
        }
    }

    files.sort_by(by_pager_name);
    subdirs.sort_by(by_pager_name);

    for file in files {
        let label = file
            .file_name()
            .and_then(|n| n.to_str())
            .map(pager_label)
            .unwrap_or_default();
        into.push(PagerEntry { path: file, label });
    }
    for sub in subdirs {
        if let Some(readme) = readme_in(&sub) {
            let label = sub
                .file_name()
                .and_then(|n| n.to_str())
                .map(pager_label)
                .unwrap_or_default();
            into.push(PagerEntry {
                path: readme,
                label,
            });
        }
        collect_pager_entries_into(&sub, into);
    }
}

pub(crate) fn by_pager_name(a: &PathBuf, b: &PathBuf) -> std::cmp::Ordering {
    let an = a
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let bn = b
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();
    an.cmp(&bn)
}

/// Turn an on-disk name into a display label (matches the web `label()`): drop the extension of a name the pager lists, collapse `-`/`_` runs to spaces, title-case each word. e.g. `book-1-words--kangyur` -> `Book 1 Words Kangyur`. `is_listed_document_path` is the gate, the same one that decides which names the pager walks, so a source file or an unreadable ending keeps it in the label rather than being told apart twice.
pub(crate) fn pager_label(raw: &str) -> String {
    let base = raw
        .rsplit_once('.')
        .filter(|_| is_listed_document_path(Path::new(raw)))
        .map(|(stem, _)| stem)
        .unwrap_or(raw);
    let mut spaced = String::with_capacity(base.len());
    let mut prev_sep = false;
    for ch in base.chars() {
        if ch == '-' || ch == '_' {
            if !prev_sep {
                spaced.push(' ');
            }
            prev_sep = true;
        } else {
            spaced.push(ch);
            prev_sep = false;
        }
    }
    let mut out = String::with_capacity(spaced.len());
    let mut at_word_start = true;
    for ch in spaced.trim().chars() {
        if ch.is_whitespace() {
            at_word_start = true;
            out.push(ch);
        } else {
            if at_word_start {
                out.extend(ch.to_uppercase());
            } else {
                out.push(ch);
            }
            at_word_start = false;
        }
    }
    out
}
