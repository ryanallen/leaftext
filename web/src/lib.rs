//! The renderer as a module a browser can load.
//!
//! It is the desktop's own render path compiled for `wasm32` — same parser, same sanitizer, same block maps — so a document embedded in somebody else's page is the document Leaftext draws. Nothing here renders anything itself; it hands bytes across the boundary and calls the core.
//!
//! **Strings cross as length-prefixed bytes**, because a module and its page share only memory and numbers. The page calls [`leaf_alloc`], writes UTF-8 into what comes back, calls [`leaf_render`], reads a `u32` length off the front of the answer, then frees both. No binding generator, which keeps this package to one dependency the app did not already ship.
//!
//! **What a browser can answer, it answers.** A page has no vault types, no repository and no image files to measure, so a document arrives without those three decorations rather than failing. A glossary it can have: the host walks the folder and hands the text over with [`leaf_set_glossary`], and the render auto-links its terms exactly as the desktop does.

use leaftext::{opened_document_from_source_with_host, GlossaryTerm, LeafHost};
use std::path::Path;
use std::sync::Mutex;

#[cfg(feature = "shell")]
use leaftext::EditableDocument;
#[cfg(feature = "shell")]
use std::path::PathBuf;

/// The glossary the page handed over, if it has one. A browser has no folder to walk for the nearest `GLOSSARY.md`, so the host that does the walking hands the text across instead — and the render auto-links its terms exactly as it does on the desktop.
static GLOSSARY: Mutex<Vec<GlossaryTerm>> = Mutex::new(Vec::new());

/// The glossary's own text, kept so the sheet a `glossary:` link raises can be rendered from it.
static GLOSSARY_SOURCE: Mutex<String> = Mutex::new(String::new());

/// A host with the one read a page can actually answer.
struct PageHost;

impl LeafHost for PageHost {
    fn glossary_terms(&self, _document_dir: &Path) -> Vec<GlossaryTerm> {
        GLOSSARY.lock().map(|held| held.clone()).unwrap_or_default()
    }

    /// This host does know a document's neighbors — the page holds the list — so it draws the waiting state and fills it, the same bargain the desktop makes.
    fn pager_placeholder(&self) -> Option<&'static str> {
        leaftext::pager_loading_html()
    }
}

/// Hand over a glossary's text — the same `## Term` headings the desktop reads off the nearest `GLOSSARY.md`. Empty text takes it away.
///
/// # Safety
/// `ptr` must address `len` initialized bytes.
#[no_mangle]
pub unsafe extern "C" fn leaf_set_glossary(ptr: *const u8, len: usize) {
    let terms = borrow_str(ptr, len)
        .map(leaftext::glossary_terms_in)
        .unwrap_or_default();
    if let Ok(mut held) = GLOSSARY.lock() {
        *held = terms;
    }
    if let Ok(mut held) = GLOSSARY_SOURCE.lock() {
        *held = borrow_str(ptr, len).unwrap_or_default().to_string();
    }
}

/// Memory for the page to write a string into. It owns what comes back until it hands the same pointer and length to [`leaf_free`].
///
/// # Safety
/// The returned pointer is valid for `len` bytes and must be freed with the same `len`.
#[no_mangle]
pub extern "C" fn leaf_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Hand back memory that came from [`leaf_alloc`] or [`leaf_render`].
///
/// # Safety
/// `ptr` must have come from this module with exactly this `len`, and must not be used again.
#[no_mangle]
pub unsafe extern "C" fn leaf_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    drop(Vec::from_raw_parts(ptr, len, len));
}

/// Render `source` as the document at `path`, and answer with the same shape the desktop sends its own page: the title, the HTML, the outline, the block ranges and the task offsets, as JSON.
///
/// The answer is its own byte length as a little-endian `u32` followed by that many bytes of UTF-8. The page frees it with [`leaf_free`] over `4 + length`. A null pointer back means the source was not UTF-8 — the only way this can fail.
///
/// # Safety
/// Both pointers must address that many initialized bytes, and both stay the page's to free.
#[no_mangle]
pub unsafe extern "C" fn leaf_render(
    source_ptr: *const u8,
    source_len: usize,
    path_ptr: *const u8,
    path_len: usize,
) -> *mut u8 {
    let Some(source) = borrow_str(source_ptr, source_len) else {
        return std::ptr::null_mut();
    };
    // A path with nothing readable in it still names the document; the render only ever reads its name and its folder.
    let path = borrow_str(path_ptr, path_len).unwrap_or("document.md");

    let document = opened_document_from_source_with_host(source, Path::new(path), &PageHost);
    let json = serde_json::to_string(&document).unwrap_or_else(|_| String::from("{}"));
    into_length_prefixed(json.into_bytes())
}

/// Leaftext's own stylesheet — the themes, the tokens, the icons and the document rules, in the order they have to resolve in. The embedding page owns the frame; this is what makes what sits inside it a Leaftext document rather than someone's approximation of one.
///
/// A theme is chosen by stamping `data-leaf-theme` and `data-leaf-appearance` on the root element, which is what the desktop's own page does.
///
/// Answers length-prefixed, freed like the rest.
#[no_mangle]
pub extern "C" fn leaf_styles() -> *mut u8 {
    into_length_prefixed(leaftext::reading_mode_css().as_bytes().to_vec())
}

// The app in a browser: its own page and front end, for a host that means to be Leaftext rather than to embed a document in something else.

/// Where a browser serves the app's own assets from. The desktop answers this with its own protocol; a page answers with a path.
#[cfg(feature = "shell")]
struct WebHost;

#[cfg(feature = "shell")]
impl LeafHost for WebHost {
    // Relative, not rooted: a static site is often published under a folder rather than at the top of a domain, and the page's own address is the only thing that knows which.
    fn asset_url(&self, name: &str) -> Option<String> {
        Some(format!("assets/{name}"))
    }
}

/// The app's own page, with its asset URLs pointed at a browser. Everything the reader is drawn with — the bar, the pane, the toolbar, the minimap — is markup this returns, not markup an embedding page writes.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_page() -> *mut u8 {
    into_length_prefixed(leaftext::app_shell_html_for_host(&WebHost).into_bytes())
}

/// The app's own front end, the same ordered fragments the desktop serves as `app.js`.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_script() -> *mut u8 {
    into_length_prefixed(leaftext::app_shell_script().as_bytes().to_vec())
}

/// What the page reads on boot before anything is open: the reader's settings, the version, the formats it may open. The host is what fills these in, so a browser sends the same lines the desktop injects.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_boot_script() -> *mut u8 {
    into_length_prefixed(boot_lines(leaftext::Settings::default(), false).into_bytes())
}

/// The same lines for a document inside somebody else's page, plus the one that says so. Told on boot rather than worked out later: the front end draws the bar and the pane as it loads, and a page that had to take them down again would show them first.
///
/// `unlocked` is whether the reader may type. An embed draws no padlock — the product decides whether it mounted a reader or an editor — so a locked editor would be a document nobody can change with no control to change that.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_embed_boot_script(unlocked: u32) -> *mut u8 {
    let settings = leaftext::Settings {
        reading_unlocked: unlocked == 1,
        ..leaftext::Settings::default()
    };
    into_length_prefixed(boot_lines(settings, true).into_bytes())
}

/// The boot lines a browser sends, for a site or for an embed.
#[cfg(feature = "shell")]
fn boot_lines(settings: leaftext::Settings, embedded: bool) -> String {
    format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        leaftext::initial_settings_script(&settings),
        // No recents and no favorites: a page has neither, and an empty pair is what the start screen already draws from.
        leaftext::initial_state_script(&[], &leaftext::Favorites::default()),
        leaftext::initial_document_exts_script(),
        leaftext::initial_version_script(),
        // No installer to offer, which the page already reads as notify-only.
        leaftext::initial_update_script(""),
        leaftext::initial_embedded_script(embedded),
    )
}

/// A rendered document as the line the page already knows how to take: the same call the desktop makes when a file opens.
///
/// # Safety
/// Both pointers must address that many initialized bytes.
#[cfg(feature = "shell")]
#[no_mangle]
pub unsafe extern "C" fn leaf_document_script(
    source_ptr: *const u8,
    source_len: usize,
    path_ptr: *const u8,
    path_len: usize,
) -> *mut u8 {
    let Some(source) = borrow_str(source_ptr, source_len) else {
        return std::ptr::null_mut();
    };
    let path = borrow_str(path_ptr, path_len).unwrap_or("document.md");
    let document = opened_document_from_source_with_host(source, Path::new(path), &PageHost);
    // The whole workspace, not just the document: the tab strip and the floating toolbar are drawn off the tabs, so a document sent without them arrives in a window with no chrome around it. Title first, then path — the order the page reads a tab in.
    let tabs = vec![(
        leaftext::tab_title_from_path(Path::new(path)),
        path.to_string(),
    )];
    into_length_prefixed(
        leaftext::workspace_state_script(
            &[],
            &leaftext::Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
        )
        .into_bytes(),
    )
}

/// The glossary itself, rendered, for the sheet a `glossary:` link raises. The page asks the host for it; on the desktop the host reads the file, and here it renders the text it was handed.
///
/// `href` is the link that was followed — `glossary:some-term` — because the sheet scrolls to that term rather than to the top of the file. Without it the sheet opens on a glossary and says it has no entry for nothing.
///
/// # Safety
/// `ptr` must address `len` initialized bytes.
#[cfg(feature = "shell")]
#[no_mangle]
pub unsafe extern "C" fn leaf_glossary_script(ptr: *const u8, len: usize) -> *mut u8 {
    let Ok(source) = GLOSSARY_SOURCE.lock() else {
        return into_length_prefixed(leaftext::glossary_failed_script("failed").into_bytes());
    };
    if source.is_empty() {
        return into_length_prefixed(leaftext::glossary_failed_script("missing").into_bytes());
    }
    let anchor = borrow_str(ptr, len)
        .and_then(|href| href.split_once(':').map(|(_, rest)| rest))
        .map(|rest| rest.trim_start_matches('#'))
        .unwrap_or_default();
    let rendered =
        leaftext::render_markdown_document_with_host(&source, Path::new("GLOSSARY.md"), &PageHost);
    into_length_prefixed(leaftext::glossary_sheet_script(&rendered.html, anchor).into_bytes())
}

// The document buffer an edit splices into: what makes a page inside somebody else's product an editor rather than a picture of one.
//
// **The arithmetic is the library's and none of it is repeated here.** One splice, one undo stack, one table rewrite, one field parser — [`EditableDocument`] and `leaftext::store`, the same code the desktop's own editing arms call. Every export below seeds a buffer, calls into it, and answers what changed; a second implementation in a browser is how two copies of the same document start disagreeing about where a diacritic sits.
//
// **A handle, not one buffer.** A page can hold more than one document — a product embedding two editors on one screen is an ordinary thing to want — so a buffer is opened, addressed by a small number, and closed. Zero is never a handle: it is what an export answers with when it could not do the thing. A closed slot is taken again by the next open, so a reader working through documents all afternoon does not grow this list.
//
// **The edit vocabulary crosses as JSON, and it is this crate's rather than a copy of the page's.** Two of the edits carry a list — every item of a frontmatter list, and the source ranges of one run of sibling blocks — which a numeric signature cannot hold, and writing seven near-identical byte-protocol signatures would be seven copies of the marshalling rather than one. Each host maps the commands its page sends onto this, which is the same shape as a host mapping them onto the desktop's event loop.

/// Every open buffer. The handle is the slot's index plus one.
#[cfg(feature = "shell")]
static BUFFERS: Mutex<Vec<Option<EditableDocument>>> = Mutex::new(Vec::new());

/// Do something to one open buffer. `None` means the handle names nothing — closed, never opened, or zero.
#[cfg(feature = "shell")]
fn with_buffer<T>(handle: u32, act: impl FnOnce(&mut EditableDocument) -> T) -> Option<T> {
    let mut held = BUFFERS.lock().ok()?;
    let slot = held.get_mut(handle.checked_sub(1)? as usize)?;
    slot.as_mut().map(act)
}

/// The buffer's editing state, in the shape the desktop pushes to its own page after every edit: whether it differs from what was last saved, whether there is an edit to take back, where the task markers now sit, and what the page's own copy should measure.
///
/// The spelling rides along because a caller that handed over bytes owns the save, and the one thing it must not do is write the file back in another encoding.
#[cfg(feature = "shell")]
fn buffer_state(edit: &EditableDocument) -> serde_json::Value {
    serde_json::json!({
        "path": edit.path.display().to_string(),
        "dirty": edit.is_dirty(),
        "canUndo": edit.can_undo(),
        "tasks": edit.task_offsets(),
        "utf16Len": edit.utf16_len(),
        "spelling": {
            "encoding": match edit.spelling.encoding {
                leaftext::SourceEncoding::Utf8 => "utf8",
                leaftext::SourceEncoding::Utf16Le => "utf16le",
                leaftext::SourceEncoding::Utf16Be => "utf16be",
                leaftext::SourceEncoding::Utf32Le => "utf32le",
                leaftext::SourceEncoding::Utf32Be => "utf32be",
            },
            "mark": edit.spelling.mark,
        },
    })
}

/// Open a buffer over `source`, as the document at `path`. Answers the handle every other buffer call takes, or `0` when the bytes are not text at all.
///
/// The source crosses as **bytes rather than a string**, and is decoded the way the desktop decodes a file it read: a byte order mark says which encoding, an unmarked file is UTF-8, and anything else is read as Windows-1252 so it opens rather than failing. That is what makes the spelling a fact about this document instead of an assumption, and what lets the source come back out spelled the way it went in.
///
/// # Safety
/// Both pointers must address that many initialized bytes, and both stay the page's to free.
#[cfg(feature = "shell")]
#[no_mangle]
pub unsafe extern "C" fn leaf_buffer_open(
    source_ptr: *const u8,
    source_len: usize,
    path_ptr: *const u8,
    path_len: usize,
) -> u32 {
    let Some(bytes) = borrow_bytes(source_ptr, source_len) else {
        return 0;
    };
    let Ok(contents) = leaftext::decode_source(bytes) else {
        return 0;
    };
    let path = borrow_str(path_ptr, path_len).unwrap_or("document.md");
    let document = EditableDocument::new(PathBuf::from(path), contents);
    let Ok(mut held) = BUFFERS.lock() else {
        return 0;
    };
    if let Some(free) = held.iter().position(Option::is_none) {
        held[free] = Some(document);
        return free as u32 + 1;
    }
    held.push(Some(document));
    held.len() as u32
}

/// Let a buffer go. Its slot is taken by the next open, and a handle already closed is not an error — a page tearing a document down twice is a page, not a fault.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_buffer_close(handle: u32) {
    let (Ok(mut held), Some(at)) = (BUFFERS.lock(), handle.checked_sub(1)) else {
        return;
    };
    if let Some(slot) = held.get_mut(at as usize) {
        *slot = None;
    }
}

/// The buffer's text, so a caller can save it. Length-prefixed, freed like the rest; a null pointer back means the handle names nothing.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_buffer_source(handle: u32) -> *mut u8 {
    match with_buffer(handle, |edit| edit.text().to_string()) {
        Some(text) => into_length_prefixed(text.into_bytes()),
        None => std::ptr::null_mut(),
    }
}

/// The same text as **bytes spelled the way the document arrived**: the mark the read took off is put back on, and a wide encoding is written wide again. A caller holding a file rather than a string saves this, and saving it cannot re-spell somebody's document.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_buffer_encoded(handle: u32) -> *mut u8 {
    match with_buffer(handle, |edit| {
        leaftext::encode_source(edit.text(), edit.spelling)
    }) {
        Some(bytes) => into_length_prefixed(bytes),
        None => std::ptr::null_mut(),
    }
}

/// The buffer's editing state on its own, without a render — what a page reads to light its Save and Undo.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_buffer_state(handle: u32) -> *mut u8 {
    match with_buffer(handle, |edit| buffer_state(edit)) {
        Some(state) => into_length_prefixed(state.to_string().into_bytes()),
        None => std::ptr::null_mut(),
    }
}

/// The buffer as the two lines the page already knows how to take: the document itself, then its editing state. What the desktop's own editing arms do in a pair — re-render from the buffer, then let the host decide the Save and Undo buttons off the real dirty and undo state rather than the page's guess.
///
/// One export rather than two, because a page given the first without the second has a redrawn document and stale buttons. The source rides along, since the re-render is what delivers it and the reader's own raw-source editors slice from it.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_buffer_document_script(handle: u32) -> *mut u8 {
    let Some((text, path)) =
        with_buffer(handle, |edit| (edit.text().to_string(), edit.path.clone()))
    else {
        return std::ptr::null_mut();
    };
    let document = opened_document_from_source_with_host(&text, &path, &PageHost);
    let tabs = vec![(leaftext::tab_title_from_path(&path), text_path(&path))];
    let state = leaftext::workspace_state_script(
        &[],
        &leaftext::Favorites::default(),
        &tabs,
        Some(0),
        Some(&document),
    );
    let Some(resync) = with_buffer(handle, |edit| {
        leaftext::blocks_resynced_script(
            &edit.task_offsets(),
            edit.is_dirty(),
            edit.can_undo(),
            None,
        )
    }) else {
        return std::ptr::null_mut();
    };
    into_length_prefixed(format!("{state}\n{resync}").into_bytes())
}

/// What the page is told after the caller's own save came back. `ok` marks the buffer clean and clears its undo history, exactly as writing a file does on the desktop; a failure leaves the buffer as it is and carries the reason, because a save that did not happen must not look like one that did.
///
/// # Safety
/// `ptr` must address `len` initialized bytes, or be null when there is no message.
#[cfg(feature = "shell")]
#[no_mangle]
pub unsafe extern "C" fn leaf_buffer_save_script(
    handle: u32,
    ok: u32,
    ptr: *const u8,
    len: usize,
) -> *mut u8 {
    let message = borrow_str(ptr, len);
    let saved = ok == 1;
    let Some(path) = with_buffer(handle, |edit| {
        if saved {
            edit.mark_saved();
        }
        text_path(&edit.path)
    }) else {
        return std::ptr::null_mut();
    };
    let reply = leaftext::save_result_script(&path, saved, message.filter(|_| !saved));
    let Some(resync) = with_buffer(handle, |edit| {
        leaftext::blocks_resynced_script(
            &edit.task_offsets(),
            edit.is_dirty(),
            edit.can_undo(),
            None,
        )
    }) else {
        return std::ptr::null_mut();
    };
    into_length_prefixed(format!("{reply}\n{resync}").into_bytes())
}

/// A path as the page holds it. Its own helper because a document opened in an embed is named by whatever the product called it, and that name goes back out in every line the page is sent.
#[cfg(feature = "shell")]
fn text_path(path: &Path) -> String {
    path.display().to_string()
}

/// Render the buffer as it now stands — the same answer [`leaf_render`] gives, off the live text rather than off the file. This is what the page redraws from after an edit.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_buffer_render(handle: u32) -> *mut u8 {
    // Read out from under the lock before rendering: a render walks a whole document, and nothing about it needs the buffer list held.
    let Some((text, path)) =
        with_buffer(handle, |edit| (edit.text().to_string(), edit.path.clone()))
    else {
        return std::ptr::null_mut();
    };
    let document = opened_document_from_source_with_host(&text, &path, &PageHost);
    let json = serde_json::to_string(&document).unwrap_or_else(|_| String::from("{}"));
    into_length_prefixed(json.into_bytes())
}

/// Make one edit, described as JSON, and answer whether the buffer moved together with its new state.
///
/// `{"edit":"splice","start":0,"removed":2,"inserted":"hi"}` — a range given in UTF-16 code units, which is what a JavaScript string index counts. No undo step, like the code-view typing it serves. `{"edit":"block","start":0,"end":9,"text":"...","undo":true,"cell":{"row":1,"column":0,"columns":3,"text":"..."}}` — an inline edit over one block's source range. `cell` names the one cell that really changed, written on its own where the source map can prove where it sits so a table lined up by hand keeps its spacing; where it cannot, the whole-block rewrite is what lands, so no edit is ever refused. `{"edit":"text","text":"..."}` — the whole buffer replaced, which is the code view's resync path for when a splice left the page and the buffer disagreeing. `{"edit":"task","index":2}` — flip one task-list marker. One ASCII byte for another, so nothing after it shifts, and no undo step: the desktop's checkbox is not undoable either. `{"edit":"field","key":"title","set":"..."}`, `"items":[...]`, `"rename":"..."` or `"remove":true` — one frontmatter field. The splice comes from the parser, so the block keeps its order, its comments and its quoting. `{"edit":"move","ranges":[[0,9],[10,20]],"from":1,"to":0}` — reorder one run of sibling blocks. Whatever sits between them never moves. `{"edit":"undo"}` — take the last undoable edit back.
///
/// An edit this does not know, or one whose numbers do not describe anything, answers `changed: false` and leaves the buffer alone. A null pointer back means the handle names nothing or the JSON was not text.
///
/// # Safety
/// `ptr` must address `len` initialized bytes.
#[cfg(feature = "shell")]
#[no_mangle]
pub unsafe extern "C" fn leaf_buffer_edit(handle: u32, ptr: *const u8, len: usize) -> *mut u8 {
    let Some(asked) =
        borrow_str(ptr, len).and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
    else {
        return std::ptr::null_mut();
    };
    let answered = with_buffer(handle, |edit| {
        let changed = apply_buffer_edit(edit, &asked);
        let mut state = buffer_state(edit);
        if let Some(object) = state.as_object_mut() {
            object.insert(String::from("changed"), serde_json::Value::Bool(changed));
        }
        state
    });
    match answered {
        Some(state) => into_length_prefixed(state.to_string().into_bytes()),
        None => std::ptr::null_mut(),
    }
}

/// One edit against one buffer. Returns whether the buffer's text moved — which is what tells a host whether to re-render.
#[cfg(feature = "shell")]
fn apply_buffer_edit(edit: &mut EditableDocument, asked: &serde_json::Value) -> bool {
    let number = |name: &str| asked.get(name).and_then(serde_json::Value::as_u64);
    let at = |name: &str| number(name).unwrap_or_default() as usize;
    let text = |name: &str| asked.get(name).and_then(serde_json::Value::as_str);
    // The text before, not the dirty flag: an edit can move the buffer without changing whether it differs from the last save, and an edit that changes nothing must not make the page re-render.
    let before = edit.text().to_string();
    match asked.get("edit").and_then(serde_json::Value::as_str) {
        Some("splice") => {
            edit.splice_utf16_without_undo(
                at("start"),
                at("removed"),
                text("inserted").unwrap_or_default(),
            );
        }
        Some("block") => {
            let record_undo = asked
                .get("undo")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            // The cell first, exactly as the desktop's arm does it: a cell the source map can prove is written on its own, and the whole-block range is the fallback rather than a second attempt.
            let cell_written = asked.get("cell").is_some_and(|cell| {
                let field = |name: &str| {
                    cell.get(name)
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or_default() as usize
                };
                edit.replace_table_cell(
                    at("start"),
                    field("row"),
                    field("column"),
                    field("columns"),
                    cell.get("text")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default(),
                    record_undo,
                )
            });
            if !cell_written {
                let replacement = text("text").unwrap_or_default();
                if record_undo {
                    edit.replace_range(at("start"), at("end"), replacement);
                } else {
                    edit.replace_range_without_undo(at("start"), at("end"), replacement);
                }
            }
        }
        Some("text") => {
            edit.set_text(text("text").unwrap_or_default().to_string());
        }
        Some("task") => {
            edit.toggle_task_without_undo(at("index"));
        }
        Some("field") => {
            let Some(key) = text("key") else {
                return false;
            };
            let splice = if let Some(value) = text("set") {
                leaftext::store::set_field(edit.text(), key, value)
            } else if let Some(items) = asked.get("items").and_then(serde_json::Value::as_array) {
                let items: Vec<&str> = items.iter().filter_map(serde_json::Value::as_str).collect();
                leaftext::store::set_list_field(edit.text(), key, &items)
            } else if let Some(to) = text("rename") {
                leaftext::store::rename_field(edit.text(), key, to)
            } else if asked.get("remove").and_then(serde_json::Value::as_bool) == Some(true) {
                leaftext::store::remove_field(edit.text(), key)
            } else {
                None
            };
            let Some(splice) = splice else {
                return false;
            };
            edit.replace_range(splice.range.start, splice.range.end, &splice.text);
        }
        Some("move") => {
            let ranges: Vec<(usize, usize)> = asked
                .get("ranges")
                .and_then(serde_json::Value::as_array)
                .map(|ranges| {
                    ranges
                        .iter()
                        .filter_map(|pair| pair.as_array())
                        .filter_map(|pair| {
                            let read = |at: usize| pair.get(at)?.as_u64().map(|n| n as usize);
                            Some((read(0)?, read(1)?))
                        })
                        .collect()
                })
                .unwrap_or_default();
            edit.move_blocks(&ranges, at("from"), at("to"));
        }
        Some("undo") => {
            edit.undo();
        }
        _ => return false,
    }
    edit.text() != before
}

/// What the module can read, so a page can tell a stale module from a current one without loading a second copy of the app.
#[no_mangle]
pub extern "C" fn leaf_formats() -> *mut u8 {
    let extensions = leaftext::all_document_extensions().join(" ");
    into_length_prefixed(extensions.into_bytes())
}

/// # Safety
/// `ptr` must address `len` initialized bytes.
unsafe fn borrow_str<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    borrow_bytes(ptr, len).and_then(|bytes| std::str::from_utf8(bytes).ok())
}

/// The same, for the one thing that crosses as bytes rather than as text: a document's own source, which has to be decoded before anything can be assumed about how it is spelled.
///
/// # Safety
/// `ptr` must address `len` initialized bytes.
unsafe fn borrow_bytes<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if ptr.is_null() {
        return None;
    }
    Some(std::slice::from_raw_parts(ptr, len))
}

/// The little-endian `u32` length, then the bytes, in one allocation the page frees whole.
fn into_length_prefixed(bytes: Vec<u8>) -> *mut u8 {
    let mut answer = Vec::with_capacity(4 + bytes.len());
    answer.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    answer.extend_from_slice(&bytes);
    let ptr = answer.as_mut_ptr();
    std::mem::forget(answer);
    ptr
}
