// ---- Code view: typing help (completions, hover, broken-link underlines) ----
// Monaco brings the popup, the hover card and the squiggle machinery; the
// answers come from the host over one round trip — the same corpus the graph
// and search read, so the popup can only know what the user pointed at. All of
// it is trigger-driven ([[, #, hover, a pause after typing): quickSuggestions
// stays off, because a popup guessing prose words is noise, not help.

// One preference for the whole app, like the speed reader. Default on.
let codeIntelEnabled = LEAF_SETTINGS.codeIntelEnabled !== false;
// The Monaco namespace once an editor exists; providers and markers need it
// outside setup's scope.
let codeIntelMonaco = null;
// Registered once per page load: Monaco keeps providers globally, not per
// editor, so re-entering the code view must not stack duplicates.
let codeIntelProvidersRegistered = false;
// The lint pass only means anything where links mean anything.
let codeIntelLintable = false;
let codeIntelChangeSub = null;
let codeLintTimer = 0;
// Drops a lint answer that arrives after a newer pass (or after teardown).
let codeLintSerial = 0;

// ---- the round trip ---------------------------------------------------------
// Each ask carries a token; the host answers window.leafCodeIntelAnswer with
// the same token. A keystroke must never wait on the bridge, so an answer that
// misses its window resolves to null and the popup simply shows nothing.
let codeIntelToken = 0;
const codeIntelPending = new Map();
const CODE_INTEL_TIMEOUT_MS = 2500;

function requestCodeIntel(message) {
  codeIntelToken += 1;
  const token = codeIntelToken;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      codeIntelPending.delete(token);
      resolve(null);
    }, CODE_INTEL_TIMEOUT_MS);
    codeIntelPending.set(token, { resolve, timer });
    send({ ...message, token });
  });
}

window.leafCodeIntelAnswer = (payload) => {
  const pending = payload && codeIntelPending.get(payload.token);
  if (!pending) return; // timed out, or a view we already left
  codeIntelPending.delete(payload.token);
  clearTimeout(pending.timer);
  pending.resolve(payload);
};

// ---- the toolbar toggle -----------------------------------------------------
// Shares the recess with the padlock, and arrives and leaves with the code view
// the way the speed reader does with the reading view. Plain words on the
// tooltip: the person reading a vault has not necessarily met an editor that
// types back.

function codeIntelTooltip() {
  return codeIntelEnabled
    ? 'Typing help is on: type [[ to see your notes, # to see headings, and broken links get a wavy underline. Click to turn it off.'
    : 'Typing help is off. Click to get note and heading suggestions as you type, and a wavy underline on broken links.';
}

function renderCodeTools(onCodeView) {
  if (!codeIntelButton) return;
  codeIntelButton.hidden = !onCodeView;
  if (!onCodeView) return;
  setSubtoolState(codeIntelButton, codeIntelEnabled, codeIntelTooltip());
}

if (codeIntelButton) {
  codeIntelButton.addEventListener('click', () => {
    codeIntelEnabled = !codeIntelEnabled;
    send({ command: 'setCodeIntelEnabled', enabled: codeIntelEnabled });
    renderCodeTools(true);
    // Take effect now, not at the next keystroke: markers appear or go with
    // the switch, which is what makes the click feel like it did something.
    if (codeIntelEnabled) scheduleCodeLint(0);
    else clearCodeLintMarkers();
  });
}

// ---- wiring an editor -------------------------------------------------------
// Called by createMonacoEditor once the editor is on screen, and undone by
// disposeMonacoEditor. The providers register once; per-editor state is only
// the lint subscription.

function setupCodeIntel(monaco) {
  codeIntelMonaco = monaco;
  registerCodeIntelProviders(monaco);
  const model = monacoEditor && monacoEditor.getModel();
  const language = model ? model.getLanguageId() : '';
  // Markdown and XML carry links the host can check; the data formats are
  // values, not prose, and the host answers them with no links by design.
  codeIntelLintable = language === 'markdown' || language === 'xml';
  if (!codeIntelLintable) return;
  codeIntelChangeSub = monacoEditor.onDidChangeModelContent(() => scheduleCodeLint());
  scheduleCodeLint(0);
}

function teardownCodeIntel() {
  if (codeIntelChangeSub) {
    codeIntelChangeSub.dispose();
    codeIntelChangeSub = null;
  }
  if (codeLintTimer) {
    clearTimeout(codeLintTimer);
    codeLintTimer = 0;
  }
  // An answer still on the bridge belongs to the editor that just went away.
  codeLintSerial += 1;
  codeIntelLintable = false;
}

// ---- completions ------------------------------------------------------------

function registerCodeIntelProviders(monaco) {
  if (codeIntelProvidersRegistered) return;
  codeIntelProvidersRegistered = true;

  monaco.languages.registerCompletionItemProvider('markdown', {
    triggerCharacters: ['[', '#'],
    provideCompletionItems(model, position) {
      if (!codeIntelEnabled || !codeViewActive) return { suggestions: [] };
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      // `[[note#` — the headings of that note.
      const wikiHeading = before.match(/\[\[([^[\]#|]+)#([^[\]#|]*)$/);
      if (wikiHeading) {
        return headingSuggestions(monaco, model, position, wikiHeading[1].trim(), wikiHeading[2]);
      }
      // `](#` — the anchors of this document.
      const anchor = before.match(/\]\(#([^)\s]*)$/);
      if (anchor) return anchorSuggestions(monaco, model, position, anchor[1]);
      // `[[` — the notes this document can reach.
      const wiki = before.match(/\[\[([^[\]#|]*)$/);
      if (wiki) return noteSuggestions(monaco, model, position, wiki[1]);
      return { suggestions: [] };
    },
  });

  monaco.languages.registerHoverProvider('markdown', {
    provideHover(model, position) {
      if (!codeIntelEnabled || !codeViewActive) return null;
      const found = wikiLinkAt(model.getLineContent(position.lineNumber), position.column);
      if (!found) return null;
      return requestCodeIntel({ command: 'codeHoverNote', note: found.name }).then((answer) => {
        if (!answer || !answer.hover) return null;
        return {
          range: new monaco.Range(
            position.lineNumber,
            found.start + 1,
            position.lineNumber,
            found.end + 1
          ),
          contents: [{ value: '**' + answer.hover.label + '**' }, { value: answer.hover.preview }],
        };
      });
    },
  });
}

// The `[[name]]` (or `[[name#heading]]`, `[[name|alias]]`) covering a 1-based
// column, and the note name inside it. Null when the column is outside every one.
function wikiLinkAt(line, column) {
  const pattern = /\[\[([^[\]\n]+)\]\]/g;
  let match;
  while ((match = pattern.exec(line))) {
    const start = match.index;
    const end = start + match[0].length;
    if (column - 1 < start || column - 1 > end) continue;
    const name = match[1].split(/[|#]/)[0].trim();
    if (!name) return null;
    return { name, start, end };
  }
  return null;
}

// What typing this suggestion should leave behind after the cursor: nothing
// when the closing pair is already there, the closer otherwise.
function closingSuffix(model, position, closer) {
  const after = model.getLineContent(position.lineNumber).slice(position.column - 1);
  return after.startsWith(closer) ? '' : closer;
}

function suggestReplaceRange(monaco, position, queryLength) {
  return new monaco.Range(
    position.lineNumber,
    position.column - queryLength,
    position.lineNumber,
    position.column
  );
}

function noteSuggestions(monaco, model, position, query) {
  return requestCodeIntel({ command: 'codeCompleteNotes' }).then((answer) => {
    if (!answer || !Array.isArray(answer.notes)) return { suggestions: [] };
    const range = suggestReplaceRange(monaco, position, query.length);
    const close = closingSuffix(model, position, ']]');
    return {
      suggestions: answer.notes.map((note) => ({
        label: note.detail ? { label: note.label, description: note.detail } : note.label,
        kind: monaco.languages.CompletionItemKind.File,
        insertText: note.label + close,
        filterText: note.label,
        range,
      })),
    };
  });
}

function headingSuggestions(monaco, model, position, note, query) {
  return requestCodeIntel({ command: 'codeCompleteHeadings', note }).then((answer) => {
    if (!answer || !Array.isArray(answer.headings)) return { suggestions: [] };
    const range = suggestReplaceRange(monaco, position, query.length);
    const close = closingSuffix(model, position, ']]');
    return {
      suggestions: answer.headings.map((heading) => ({
        label: { label: heading.text, description: '#' + heading.slug },
        kind: monaco.languages.CompletionItemKind.Reference,
        insertText: heading.text + close,
        filterText: heading.text,
        range,
      })),
    };
  });
}

function anchorSuggestions(monaco, model, position, query) {
  // The anchors on offer must be the anchors of the text on screen, so any
  // keystroke still inside the debounce reaches the host first.
  flushSourceUpdate();
  return requestCodeIntel({ command: 'codeCompleteHeadings' }).then((answer) => {
    if (!answer || !Array.isArray(answer.headings)) return { suggestions: [] };
    const range = suggestReplaceRange(monaco, position, query.length);
    const close = closingSuffix(model, position, ')');
    return {
      suggestions: answer.headings.map((heading) => ({
        label: { label: heading.text, description: '#' + heading.slug },
        kind: monaco.languages.CompletionItemKind.Reference,
        insertText: heading.slug + close,
        // Whichever of the two the person started typing, match it.
        filterText: heading.slug + ' ' + heading.text,
        range,
      })),
    };
  });
}

// ---- broken-link underlines -------------------------------------------------
// A pause after typing, then one pass: the host walks the buffer's links —
// the same scan the graph draws from — and answers with the ranges pointing
// at nothing. Monaco draws the squiggles.

const CODE_LINT_DEBOUNCE_MS = 700;

function scheduleCodeLint(delay) {
  if (!codeIntelLintable || !codeIntelEnabled) return;
  if (codeLintTimer) clearTimeout(codeLintTimer);
  codeLintTimer = setTimeout(
    () => {
      codeLintTimer = 0;
      runCodeLint();
    },
    delay == null ? CODE_LINT_DEBOUNCE_MS : delay
  );
}

function runCodeLint() {
  if (!monacoEditor || !codeIntelMonaco || !codeIntelEnabled || !codeViewActive) return;
  // The host checks its copy of the buffer, so the buffer has to be current
  // before the ask crosses — both ride the same channel, in order.
  flushSourceUpdate();
  codeLintSerial += 1;
  const serial = codeLintSerial;
  const model = monacoEditor.getModel();
  requestCodeIntel({ command: 'codeLint' }).then((answer) => {
    if (!answer || serial !== codeLintSerial) return;
    if (!monacoEditor || monacoEditor.getModel() !== model) return;
    const markers = (answer.markers || []).map((marker) => ({
      severity: codeIntelMonaco.MarkerSeverity.Warning,
      message: marker.message,
      startLineNumber: marker.startLine,
      startColumn: marker.startCol,
      endLineNumber: marker.endLine,
      endColumn: marker.endCol,
    }));
    codeIntelMonaco.editor.setModelMarkers(model, 'leaf-links', markers);
  });
}

function clearCodeLintMarkers() {
  if (!monacoEditor || !codeIntelMonaco) return;
  codeLintSerial += 1; // and orphan any pass still out
  codeIntelMonaco.editor.setModelMarkers(monacoEditor.getModel(), 'leaf-links', []);
}
