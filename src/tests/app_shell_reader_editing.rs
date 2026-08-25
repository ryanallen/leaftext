//! The editable views: the find bar, the code view, undo, the anchor and a note's fields.

use super::*;

#[test]
fn app_shell_reader_editor_round_trips_safe_inline_html() {
    let html = app_shell_page();

    for expected in [
        "const MARKDOWN_RAW_INLINE_TAGS = new Set(['abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div']);",
        "div: ['align', 'id'],",
        "return '<' + tag + rawInlineHtmlAttributes(el, tag) + '>' + inlineDomToMarkdown(el) + '</' + tag + '>';",
        "out += '<br>';",
        "'abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div',",
        "out += rawInlineHtmlToMarkdown(child, tag);",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn one_find_bar_serves_both_views_and_replaces_through_the_source() {
    let html = app_shell_page();

    // The bar, its field and counter, the three how-to-match toggles and the scope one, both steps, and the replace row.
    for expected in [
        r#"<div id="findBar" class="find-bar" role="search" aria-label="Find in this document" hidden>"#,
        r#"<input id="findInput" class="find-input" type="text""#,
        r#"<span id="findCount" class="find-count" aria-live="polite">"#,
        r#"title="Match case (Alt+C)">Aa</button>"#,
        r#"title="Whole word (Alt+W)">ab|</button>"#,
        r#"title="Regular expression (Alt+R)">.*</button>"#,
        r#"title="Find in selection (Alt+L)""#,
        r#"title="Previous match (Shift+Enter)""#,
        r#"title="Next match (Enter)""#,
        // Every control on the bar carries the app bar's own icon button. The class and the stylesheet are each half of the 32px box, so both are checked.
        r#"id="findPrev" class="find-step icon-button""#,
        r#"id="findClose" class="find-step icon-button""#,
        r#"id="findMatchCase" class="find-flag icon-button""#,
        r#"id="findInSelection" class="find-flag icon-button""#,
        r#"id="findReplaceAll" class="find-action icon-button""#,
        // `folds` is the mark: the row slides down to its height rather than the bar arriving at a new one.
        r#"<div class="find-row find-replace-row folds" id="findReplaceRow" hidden>"#,
        // A cursor on every match takes hold of them, so it stands with Previous and Next on the row that is always there — the two-caret mask says more than one cursor.
        r#"<button type="button" id="findSelectAll" class="find-step icon-button" aria-label="Put a cursor on every match" title="Put a cursor on every match (Alt+Enter)"><span class="lt-icon lt-icon-select-all"></span></button>"#,
    ] {
        assert_contains(&html, expected);
    }

    // On the always-visible row, between Next and the Replace toggle — and out of the hidden replace row, which now holds only Replace and All.
    let place = |id: &str| {
        html.find(id)
            .unwrap_or_else(|| panic!("{id} is not in the page"))
    };
    let replace_row = place(r#"id="findReplaceRow""#);
    let select_all = place(r#"id="findSelectAll""#);
    assert!(
        place(r#"id="findNext""#) < select_all && select_all < place(r#"id="findReplaceToggle""#),
        "the cursor-on-every-match button does not sit between Next and Replace"
    );
    assert!(
        select_all < replace_row,
        "the cursor-on-every-match button is still in the hidden replace row"
    );

    // One keyboard path, and it reaches both views: Ctrl+F opens, Ctrl+H opens on the replace row, Escape closes, Enter steps.
    for expected in [
        "(key === 'f' || key === 'h')",
        "openFindBar({ replacing: key === 'h' });",
        "closeFindBar();",
        "else findStep(event.shiftKey ? -1 : 1);",
        "return codeViewActive && !!monacoEditor;",
    ] {
        assert_contains(&html, expected);
    }

    // The source view uses the editor's own searching, and nothing was added to the vendored bundle for it.
    for expected in [
        "const found = model.findMatches(",
        "monacoEditor.createDecorationsCollection(decorations);",
        "monacoEditor.executeEdits('leaf-find', edits);",
        "monacoEditor.setSelections(",
    ] {
        assert_contains(&html, expected);
    }

    // The reading view draws with the highlight API rather than wrapping matches in tags, which the editor would serialize back into the file.
    assert_contains(&html, "CSS.highlights.set(FIND_HIGHLIGHT_ALL, all);");

    // And a replace there is one splice over the whole document, so one undo puts every replacement back. One send, and its range is the whole buffer.
    assert_contains(
        &html,
        "sendEditCommand({ command: 'editBlock', start: 0, end: total, text: next });",
    );
    let reading_replace = html
        .split("function replaceInReading(all) {")
        .nth(1)
        .expect("the reading view's replace is in the script");
    let body = reading_replace
        .split("\nfunction ")
        .next()
        .expect("the function has an end");
    assert_eq!(
        body.matches("sendEditCommand(").count(),
        1,
        "replace all in the reading view must write one splice, not one per match"
    );
}

#[test]
fn app_shell_save_success_clears_reader_undo_state() {
    let html = app_shell_page();

    assert_contains(&html, "window.leafSaved = (path, ok, error) => {");
    assert_contains(&html, "undoableByPath.delete(path);");
}

#[test]
fn app_shell_resets_new_documents_to_rendered_content_top() {
    let html = app_shell_page();

    for expected in [
        "let resetReaderScrollOnNextRender = false;",
        "resetReaderScrollOnNextRender = true;",
        "function resetReaderScrollToContentStart() {",
        "setReaderScrollTop(content.topOffset);",
        "const firstContent = source.firstElementChild;",
        "const rawTopOffset = Math.ceil(app.scrollTop + firstContentRect.top - shellRect.top);",
        "const topOffset = Math.max(0, rawTopOffset - READER_CONTENT_TOP_GAP);",
    ] {
        assert_contains(&html, expected);
    }

    // Each of these three is in the page more than once, so where it is is the claim: the landing resets when a new document asked for it, and the reset re-origins and re-pins.
    for (inside, expected) in [
        (
            "} else if (resetReaderScrollOnNextRender) {",
            "resetReaderScrollToContentStart();",
        ),
        (
            "function resetReaderScrollToContentStart() {",
            "const content = correctReaderScrollOrigin(source);",
        ),
        (
            "function resetReaderScrollToContentStart() {",
            "refreshReaderScrollAnchor();",
        ),
    ] {
        assert_in(&html, inside, expected);
    }

    assert!(
        !html.contains("app.scrollTop = 0;"),
        "new document reset should account for reader padding instead of blindly scrolling to zero"
    );
}

#[test]
fn app_shell_clamps_reader_scroll_to_rendered_content_range() {
    let html = app_shell_page();

    for expected in [
            "function measureReaderScrollRange(documentContent, viewportHeight) {",
            "minScrollTop: documentContent.topOffset,",
            "maxScrollTop: documentContent.topOffset + scrollable,",
            "function readerScrollOrigin(source) {",
            "function correctReaderScrollOrigin(source = app.querySelector('.document-body')) {",
            "const nextOrigin = Math.max(0, Math.ceil(content.rawTopOffset + origin - READER_CONTENT_TOP_GAP));",
            "source.style.setProperty('--reader-scroll-origin', `${nextOrigin}px`);",
            "function clampReaderScrollTop(scrollTop) {",
            "return Math.min(range.maxScrollTop, Math.max(range.minScrollTop, nextScrollTop));",
            "function setReaderScrollTop(scrollTop) {",
            "app.scrollTop = clampReaderScrollTop(scrollTop);",
            "function clampReaderScrollPosition() {",
            "const clampedScrollTop = clampReaderScrollTop(app.scrollTop);",
            // A scroll reaches the clamp through the settle, and this line is the whole of that path.
            "readerScrollSettleTimer = window.setTimeout(settleReaderScroll, READER_SCROLL_SETTLE_MS);",
            "setReaderScrollTop(app.scrollTop);",
        ] {
            assert_contains(&html, expected);
        }

    // The page holds this line in more than one place, so the settle is what has to hold it.
    assert_in(
        &html,
        "function settleReaderScroll() {",
        "clampReaderScrollPosition();",
    );

    assert!(
        !html.contains("app.scrollTop = Math.max(0, nextScrollTop);"),
        "restored reader scroll positions must clamp to the rendered content top, not raw zero"
    );
}

#[test]
fn app_shell_preserves_reader_anchor_across_layout_reflow() {
    let html = app_shell_page();

    for expected in [
            "let readerLayoutFrame = 0;",
            "let readerScrollAnchor = null;",
            "let readerReflowObserver = null;",
            "const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';",
            "function captureReaderScrollAnchor() {",
            // Capture and restore share one cached block list so a serialized {section, block} anchor always resolves back to the element it named.
            "readerAnchorBlocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR)).filter(",
            // And never what is inside a drawing. A mermaid label is a `<p>` in a `<foreignObject>`, so a page of diagrams grows hundreds of them the moment they land — each taking a slot in this list, above the reader, walking the restore back toward the top a batch at a time.
            "(block) => !block.closest('svg'),",
            "return { section, block: targetIndex - (sectionIndex < 0 ? 0 : sectionIndex), offsetY };",
            "function resolveReaderAnchorElement(anchor) {",
            "function restoreReaderScrollAnchor(anchor) {",
            "setReaderScrollTop(app.scrollTop + rect.top - shellRect.top + offsetY);",
            "function scheduleReaderLayoutUpdate() {",
            "restoreReaderScrollAnchor(readerScrollAnchor || captureReaderScrollAnchor());",
            "    if (readerOffScreen()) {",
            "readerScrollAnchor = captureReaderScrollAnchor() || readerScrollAnchor;",
            // A resize is what queues the pass, and the pair is that path — either line on its own is in the page several times.
            "invalidateMinimapMetrics();\n  scheduleReaderLayoutUpdate();",
            // The reflow observer re-pins the anchor as images decode and grow, and drops the stale anchor-block cache so the re-pin resolves against the current DOM rather than detached, zero-rect entries.
            "function observeReaderReflow() {",
            "readerReflowObserver = new ResizeObserver(() => {",
            "image.addEventListener('load', () => scheduleReaderLayoutUpdate(), { once: true });",
        ] {
            assert_contains(&html, expected);
        }

    // The page holds all three of these lines in several places, so the block each is in is the claim: the capture reads the cached list, the queued pass re-origins, and the reflow observer drops the cache.
    for (inside, expected) in [
        (
            "function captureReaderScrollAnchor() {",
            "const blocks = readerAnchorBlockList(source);",
        ),
        (
            "function scheduleReaderLayoutUpdate() {",
            "correctReaderScrollOrigin();",
        ),
        (
            "readerReflowObserver = new ResizeObserver(() => {",
            "readerAnchorBlocks = null;",
        ),
    ] {
        assert_in(&html, inside, expected);
    }
}

#[test]
fn app_shell_code_view_is_a_worker_free_monaco_with_its_own_minimap() {
    // The code view is Monaco: it renders only what's on screen, so typing never re-lays-out the whole document. Guard the load-bearing choices behind that.
    let html = app_shell_page();

    // Entering the code view mounts a Monaco container and clears the reader's own rail — Monaco draws its own minimap.
    assert!(html.contains(r#"app.innerHTML = '<div class="code-view-monaco"></div>';"#));
    // The page clears the rail in more than one place, so the code view's own render is what has to.
    assert_in(
        &html,
        "function renderCodeView(state) {",
        "setMinimapMarkup('');",
    );

    // Wrapping stays on and the minimap is Monaco's own. The wrap is 'bounded' (not 'on') so applyCodeViewWrapColumn can hold the text short of the minimap — 'on' wraps flush under the minimap's drop-shadow.
    assert!(html.contains("wordWrap: 'bounded',"));
    assert!(html.contains("monacoEditor.onDidLayoutChange(() => {"));
    // A relayout re-derives the wrap column and re-checks the viewport box.
    assert!(html.contains("    clampMinimapSliderToRail();\n  });"));
    assert!(html.contains("minimap: { enabled: true"));

    // Edits relay to the host as source splices (scheduleSourceUpdate), not a whole-buffer resend per keystroke.
    assert!(html.contains("monacoEditor.onDidChangeModelContent(() => {"));
    assert!(html.contains("scheduleSourceUpdate();"));

    // The bundle loads lazily, and Monaco is handed an inert worker stub so it never spawns a worker or evaluates worker code on the main thread — the app's security policy (no 'unsafe-eval', no blob: workers) stays untouched.
    assert!(html.contains("function loadMonacoOnce()"));
    assert!(html.contains("self.MonacoEnvironment = {"));
    assert!(html.contains("getWorker() {"));
}

// The editor's add-a-cursor commands come from a contribution, not the core, so a re-bundle that drops the import from scripts/bundle-monaco.mjs takes them out with nothing on screen to show for it — Ctrl-click keeps working (the mouse handling is core) while add-a-cursor-below and add-the-next-match silently do nothing. Only a regeneration touches this file, and it is not part of `just verify`.
#[test]
fn the_vendored_editor_carries_its_add_a_cursor_commands() {
    let bundle = String::from_utf8_lossy(assets::MONACO_JS);

    for command in ["insertCursorBelow", "addSelectionToNextFindMatch"] {
        assert!(
            bundle.contains(command),
            "the vendored editor is missing {command} — re-run `just bundle-monaco` with contrib/multicursor imported"
        );
    }
}

// The code view's wrap is a column count, so it is only a width once a character has been measured — and every theme brings its own code font. Monaco measures a font when it is told to use it, which for a web font is before the face has arrived, so it measures the fallback; a font landing changes no geometry, so the layout event the column rides never fires to correct it. Uncorrected, the wrap reads as a property of the theme: text running under the minimap on some, stopping short on others, depending only on whether that font is loaded already and how wide the fallback is.
//
// The re-fit is pinned here because it has to keep working for fonts nobody has picked yet: it is driven by the web view saying "faces finished loading", which names no font and covers every source, so a new theme needs no code. Anything that starts listing font names, or fits only the fonts that ship today, fails this test.
#[test]
fn app_shell_refits_the_code_view_wrap_to_whatever_font_is_actually_measured() {
    let html = app_shell_page();

    // Forcing the measurement again is the load-bearing half — Monaco does not re-measure on its own — and the column cache has to go first, because the same count against a different font reads as "nothing changed".
    let refit = html
        .split("function refitCodeViewToFont()")
        .nth(1)
        .expect("the shell must expose the wrap re-fit");
    let refit = &refit[..refit.find("\n}").expect("re-fit body should close")];
    assert_contains(refit, "editor.remeasureFonts();");
    assert_contains(refit, "codeViewWrapColumn = 0;");
    assert_contains(refit, "applyCodeViewWrapColumn();");

    // Both things that change the measurement re-fit: the theme's own font swap, and any face finishing its load afterwards. The listener is generic on purpose — `loadingdone` fires for every font from every source and names none.
    assert_contains(&html, "if (codeFont) monacoEditor.updateOptions({ fontFamily: codeFont });\n  // A theme brings its own code font, so the wrap has to be re-fitted to it.\n  refitCodeViewToFont();");
    assert_contains(
        &html,
        "document.fonts.addEventListener('loadingdone', monacoFontsDoneHandler);",
    );
    // And it is dropped on teardown, or it re-fits an editor that no longer exists.
    assert_contains(
        &html,
        "document.fonts.removeEventListener('loadingdone', monacoFontsDoneHandler);",
    );
}

// The edge fades dissolve the top and bottom of the page so a line sliced by the app bar's edge or the card's stroke doesn't read as a rendering fault. Scrolled to either end there is no slice to hide — and Monaco puts line 1 and the last line flush against those same two edges, so the wash falls on text instead and the first line comes up half erased. The editor therefore has to hold its content clear of both edges the way the reading view's page does, which is why the clearance is READ from the reading view's own numbers rather than typed again here.
#[test]
fn app_shell_holds_the_code_view_clear_of_the_edge_fades() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The option exists at all, and is Monaco's own padding — the scroll height grows, so the ends of the document can be scrolled out of the wash.
    assert_contains(&html, "padding: monacoEditorPadding(),");

    let padding = html
        .split("function monacoEditorPadding()")
        .nth(1)
        .expect("the shell must size the code view's padding");
    let padding = &padding[..padding.find("\n}\n").expect("padding body should close")];

    // Top: the gap the reading view opens for its first block, less the bar the editor's box already starts below.
    assert_contains(padding, "READER_CONTENT_TOP_GAP - barHeight");
    assert_contains(padding, "root.getPropertyValue('--app-bar-height')");

    // Bottom: what .document-body leaves — the content pad plus the floating toolbar's room. That one is declared on <body>, not the root, so it must be read from the body or it comes back 0 and the last line sits under the bar.
    assert_contains(padding, "contentPad + toolbarSpace");
    assert_contains(padding, "root.getPropertyValue('--reader-content-pad')");
    assert_contains(
        padding,
        "getComputedStyle(document.body).getPropertyValue('--reader-toolbar-space')",
    );
    assert_contains(&css, "body:has(#readerToolbar:not([hidden])) {");

    // And the clearance actually covers the fade, whatever the three numbers become: the top gap left over after the app bar has to be at least as deep as the wash.
    let px = |name: &str| -> f64 {
        let value = css
            .split(&format!("{name}: "))
            .nth(1)
            .unwrap_or_else(|| panic!("{name} must be declared"));
        value[..value.find("px").expect("a pixel length")]
            .parse()
            .expect("a number")
    };
    let clearance = px("--reader-content-top-gap") - px("--app-bar-height");
    let fade = px("--reader-edge-fade-depth");
    assert!(
        clearance >= fade,
        "the code view's top padding is {clearance}px, which does not clear the {fade}px fade"
    );
}

#[test]
fn the_field_block_at_the_top_of_a_note_is_bound_to_the_block_not_to_a_place_on_the_page() {
    let html = app_shell_page();

    // Found by the block, never by where the block sits, so the table can later move into a sheet and the same binding reaches it. Its absence is an answer too — a note with no block is the state a first field is started from.
    assert_contains(&html, "function frontmatterBlock(root) {");
    assert_contains(&html, "return (root || app).querySelector('.frontmatter');");
    assert_contains(&html, "function bindFrontmatterFields(root) {");
    assert_contains(&html, "const block = frontmatterBlock(root);");
    assert_contains(&html, "if (!block || !readerEditingAllowed()) return;");
    assert_contains(&html, "bindFrontmatterFields(body);");

    // The value cells the renderer stamped, and the control each type asks for — never one this guesses at.
    assert_contains(&html, "block.querySelectorAll('td[data-leaf-field]')");
    // The markdown writer holds this line too, so the binding is where it has to be.
    assert_in(
        &html,
        "function bindFrontmatterFields(root) {",
        "if (kind === 'list') {",
    );
    assert_contains(&html, "} else if (kind === 'checkbox') {");
    // A date the picker cannot read keeps the text box, rather than opening a picker that shows nothing and clears the value on the way out.
    assert_contains(
        &html,
        "} else if (kind === 'date' && frontmatterDateValue(cell.textContent.trim())) {",
    );
    assert_contains(
        &html,
        "return /^\\d{4}-\\d{2}-\\d{2}$/.test(text) ? text : '';",
    );
    // The checkbox the renderer already drew, with its `disabled` taken off — not a second one beside it.
    assert_contains(&html, "box.disabled = false;");
    assert_contains(
        &html,
        "box.addEventListener('change', () => sendFieldEdit(key, box.checked ? 'true' : 'false'));",
    );
    // A list goes back whole, because how it is written is the file's own shape to keep — and through the reading view's own edit path, because a field write is an undoable buffer edit and the dot has to answer for it at once.
    assert_contains(
        &html,
        "sendEditCommand({ command: 'setListField', key, items: next });",
    );

    // Enter commits, Escape abandons, leaving the box commits — the vault menu's fields, in a table cell.
    assert_contains(&html, "field.addEventListener('blur', () => finish(true));");
    assert_contains(
        &html,
        "if (write && commit && commit(field.value.trim()) === false) return;",
    );

    // The host owns every write: where a field's bytes are, whether a quote goes back on, and whether a new name would collide, are all the parser's to know.
    assert_contains(
        &html,
        "sendEditCommand({ command: 'setField', key, value });",
    );
    assert_contains(
        &html,
        "sendEditCommand({ command: 'renameField', key, to: text });",
    );

    // The cross per row and the add row under the last field, both inside the block.
    assert_contains(&html, "button.className = 'frontmatter-remove';");
    assert_contains(&html, "sendFieldEdit(key, null);");
    assert_contains(&html, "row.className = 'frontmatter-add';");
    assert_contains(
        &html,
        "if (write && key) sendFieldEdit(key, value.value.trim());",
    );

    // The names the app really reads, offered rather than typed — and one list on the page, since an input cannot hold a datalist of its own.
    assert_contains(
        &html,
        "const FRONTMATTER_KNOWN_KEYS = ['aliases', 'cssclasses', 'tags', 'leaftext-types'];",
    );
    assert_contains(
        &html,
        "if (known) field.setAttribute('list', frontmatterKnownKeyList());",
    );
}

#[test]
fn a_note_with_no_fields_starts_one_from_the_plus_that_is_already_in_the_gutter() {
    let html = app_shell_page();

    // Above everything, on an unlocked Markdown note that has no block — and nowhere else, or an insert between two paragraphs would make metadata nobody meant.
    assert_contains(&html, "function frontmatterCanStart(gap) {");
    // Both clauses are in the page more than once, so the test names the one function that has to carry them.
    assert_in(
        &html,
        "function frontmatterCanStart(gap) {",
        "&& !gap.above",
    );
    assert_in(
        &html,
        "function frontmatterCanStart(gap) {",
        "&& currentDocumentFormat === 'markdown'",
    );
    assert_contains(&html, "&& readerEditingAllowed()");
    assert_contains(&html, "&& !frontmatterBlock();");

    // The plus already there, saying what it does rather than reading as the insert menu it is not.
    assert_contains(&html, "function labelBlockAdd(startsFrontmatter) {");
    assert_contains(
        &html,
        "const what = startsFrontmatter ? 'Add frontmatter' : 'Insert a block';",
    );
    assert_contains(&html, "if (frontmatterCanStart(blockGutterGap)) {");
    assert_contains(&html, "startFrontmatterAtTop();");

    // It opens the same name-and-value pair the add row opens, and an abandoned one takes the block away again so the file never moved.
    assert_contains(&html, "function startFrontmatterAtTop() {");
    assert_contains(&html, "block.className = 'frontmatter is-editable';");
    assert_contains(
        &html,
        "const button = frontmatterAddRow(block, () => block.remove());",
    );
    assert_contains(&html, "else if (onEmpty) onEmpty();");
}
