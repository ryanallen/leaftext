// The block of fields at the top of a note, editable where it is read.
//
// It binds to the block, never to where the block sits: it finds `.frontmatter` and works from there, so the table can later move into a sheet and the same binding reaches it with nothing rewritten.
//
// The renderer stamps each value cell with the key it stands for, what type the field is, and the bytes its value occupies in the file. The write itself goes back to the host by key: where a field's bytes are, and whether a quote goes back on, is the parser's to know, and a reader of the block in here would be a second answer to the same question. A field change is a normal undoable edit and waits for Save, not the checkbox's write-straight-to-disk: saving is what ends an undo stack, so a field that saved itself could not be taken back -- and the history is what takes a removed field back, which is why the cross needs no undo button beside it.

// The names this app really reads out of a block, offered on the add row rather than typed. Not a list of likely-looking keys: `aliases`, `cssclasses` and `tags` are the three the parser gives a type to without looking at a value, and `leaftext-types` is the note's own word on what its fields are.
const FRONTMATTER_KNOWN_KEYS = ['aliases', 'cssclasses', 'tags', 'leaftext-types'];

// The offered names, as one list on the page rather than one per box. An input cannot hold a datalist of its own, and a fresh one per opened cell would leave a pile of them behind every time a document re-renders.
const FRONTMATTER_KEY_LIST_ID = 'frontmatterKnownKeys';
function frontmatterKnownKeyList() {
  if (!document.getElementById(FRONTMATTER_KEY_LIST_ID)) {
    const list = document.createElement('datalist');
    list.id = FRONTMATTER_KEY_LIST_ID;
    for (const name of FRONTMATTER_KNOWN_KEYS) {
      const option = document.createElement('option');
      option.value = name;
      list.appendChild(option);
    }
    appSurface.appendChild(list);
  }
  return FRONTMATTER_KEY_LIST_ID;
}

// The field block of the document on screen, or null when the note has none. A note with no block is not a failure to bind -- it is the state the top of the page offers to start one from.
function frontmatterBlock(root) {
  return (root || app).querySelector('.frontmatter');
}

// Send one field to the host. `value` null removes the field. Through the reading view's own edit path, because a field write is an undoable buffer edit like any other — the dot and the two buttons have to answer for it at once, or a save fired straight after one would find nothing to write.
function sendFieldEdit(key, value) {
  sendEditCommand({ command: 'setField', key, value });
}

// Every key inside a field box is the box's own, except the save: the window owns that one, and the box's blur commit writes what was typed on the way out. Answers whether the key was let past, so the box knows not to swallow it.
function frontmatterKeyLeavesBox(event) {
  if (!isSaveKey(event)) {
    event.stopPropagation();
    return false;
  }
  return true;
}

// A single-line box that lives inside a table cell for as long as it is being typed into: Enter commits, Escape abandons, leaving it commits. The vault menu's fields, in the field block. `commit` is given the trimmed text; a falsy return leaves the box open, which is how the add row refuses a blank name without throwing away what was typed beside it.
function frontmatterBox(label, known) {
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'frontmatter-input';
  field.spellcheck = false;
  field.setAttribute('autocomplete', 'off');
  field.setAttribute('aria-label', label);
  // The browser's own completion over the drawn box: names offered, nothing new on the page, and anything else still typeable.
  if (known) field.setAttribute('list', frontmatterKnownKeyList());
  // A field typed in is words on screen like any other, so the dot, Save and Undo answer for it from the first keystroke rather than from the box being left.
  field.addEventListener('input', raiseTypingChrome);
  return field;
}

function frontmatterInput({ value, label, known, commit, abandon }) {
  const field = frontmatterBox(label, known);
  field.value = value || '';
  let settled = false;
  const finish = (write) => {
    if (settled) return;
    if (write && commit && commit(field.value.trim()) === false) return;
    settled = true;
    if (!write && abandon) abandon();
  };
  field.addEventListener('keydown', (event) => {
    if (frontmatterKeyLeavesBox(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      if (abandon) abandon();
    }
  });
  field.addEventListener('blur', () => finish(true));
  return field;
}

// Put a box over a cell's own text. `write` is handed the new text and says whether to send it; the cell shows it at once either way, because the host's re-render replaces the whole document a moment later and this is only what stands in until it arrives.
function editFrontmatterCell(cell, label, write, known) {
  if (cell.classList.contains('is-editing')) return;
  const before = cell.textContent;
  const settle = (text) => {
    cell.classList.remove('is-editing');
    cell.textContent = text;
  };
  const field = frontmatterInput({
    value: before,
    label,
    known,
    commit: (text) => {
      settle(text || before);
      if (text && text !== before) write(text);
    },
    abandon: () => settle(before),
  });
  cell.classList.add('is-editing');
  cell.textContent = '';
  cell.appendChild(field);
  field.focus();
  field.select();
}

// A date the app can actually read: the one shape a date picker speaks, and the one the parser types as a date. Anything else keeps the text box rather than opening a picker that shows nothing and clears the value on the way out.
function frontmatterDateValue(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

// A date field: the platform's own picker, in the row. Committing writes the same `YYYY-MM-DD` the file already holds, so nothing about the value's shape changes by being edited.
function editFrontmatterDate(cell, key) {
  if (cell.classList.contains('is-editing')) return;
  const before = cell.textContent.trim();
  const field = document.createElement('input');
  field.type = 'date';
  field.className = 'frontmatter-input frontmatter-date';
  field.value = frontmatterDateValue(before);
  field.setAttribute('aria-label', key);
  field.addEventListener('input', raiseTypingChrome);
  let settled = false;
  const settle = (text, write) => {
    if (settled) return;
    settled = true;
    cell.classList.remove('is-editing');
    cell.textContent = text;
    if (write && text !== before) sendFieldEdit(key, text);
  };
  field.addEventListener('keydown', (event) => {
    if (frontmatterKeyLeavesBox(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      settle(before, false);
    }
  });
  field.addEventListener('change', () => settle(field.value || before, true));
  field.addEventListener('blur', () => settle(field.value || before, true));
  cell.classList.add('is-editing');
  cell.textContent = '';
  cell.appendChild(field);
  field.focus();
}

// A checkbox field: the box the renderer already drew, with its `disabled` taken off. Same control, now answering — rather than a second one beside it.
function bindFrontmatterCheckbox(cell, key) {
  const box = cell.querySelector('input[type="checkbox"]');
  if (!box) return;
  box.disabled = false;
  box.setAttribute('aria-label', key);
  box.addEventListener('change', () => sendFieldEdit(key, box.checked ? 'true' : 'false'));
}

// A list field: one chip an item, each with its own cross, and a `+` that opens a box for the next one. The whole list goes back to the host at once, because how it is written -- inline or a line each -- is the file's own shape to keep.
function bindFrontmatterChips(cell, key) {
  const items = Array.from(cell.querySelectorAll('li')).map((item) => item.textContent);
  const chips = document.createElement('div');
  chips.className = 'frontmatter-chips';
  const write = (next) => sendEditCommand({ command: 'setListField', key, items: next });
  for (let at = 0; at < items.length; at += 1) {
    const chip = document.createElement('span');
    chip.className = 'frontmatter-chip';
    chip.appendChild(document.createTextNode(items[at]));
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'frontmatter-chip-remove';
    drop.title = `Remove ${items[at]}`;
    drop.setAttribute('aria-label', `Remove ${items[at]}`);
    drop.innerHTML = '<span class="lt-icon lt-icon-close"></span>';
    drop.addEventListener('click', () => write(items.filter((_, index) => index !== at)));
    chip.appendChild(drop);
    chips.appendChild(chip);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'frontmatter-chip-add';
  add.title = `Add to ${key}`;
  add.setAttribute('aria-label', `Add to ${key}`);
  add.innerHTML = '<span class="lt-icon lt-icon-new"></span>';
  add.addEventListener('click', () => {
    add.hidden = true;
    const box = frontmatterInput({
      label: `New ${key} item`,
      commit: (text) => {
        add.hidden = false;
        box.remove();
        if (text) write(items.concat(text));
      },
      abandon: () => {
        add.hidden = false;
        box.remove();
      },
    });
    chips.appendChild(box);
    box.focus();
  });
  chips.appendChild(add);
  cell.textContent = '';
  cell.appendChild(chips);
}

// The cross at the right end of a row. Drawn on every row, shown under the pointer, so the table reads as a table until somebody reaches for it.
function frontmatterRemoveCell(key) {
  const cell = document.createElement('td');
  cell.className = 'frontmatter-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'frontmatter-remove';
  button.title = `Remove ${key}`;
  button.setAttribute('aria-label', `Remove ${key}`);
  button.innerHTML = '<span class="lt-icon lt-icon-close"></span>';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    sendFieldEdit(key, null);
  });
  cell.appendChild(button);
  return cell;
}

// The "Add a field" row under the last field, inside the same block. Pressing it opens a name and a value side by side; the field is written when both are filled, so a name typed and abandoned leaves the file alone.
function frontmatterAddRow(block, onEmpty) {
  const row = document.createElement('tr');
  row.className = 'frontmatter-add';
  const cell = document.createElement('td');
  cell.colSpan = 3;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'frontmatter-add-button';
  button.innerHTML = '<span class="lt-icon lt-icon-new"></span><span>Add a field</span>';
  const rest = () => {
    cell.textContent = '';
    cell.appendChild(button);
  };
  button.addEventListener('click', () => {
    cell.textContent = '';
    // Two boxes, one editor: a name with no value beside it is not a field yet, so what settles the row is leaving both of them, not leaving either.
    const name = frontmatterBox('Name', true);
    const value = frontmatterBox('Value');
    let settled = false;
    const settle = (write) => {
      if (settled) return;
      settled = true;
      const key = name.value.trim();
      rest();
      if (write && key) sendFieldEdit(key, value.value.trim());
      // Nothing was written, so a block that only existed to hold this row goes again and the file is left exactly as it was.
      else if (onEmpty) onEmpty();
    };
    const leaving = () => window.setTimeout(() => {
      if (document.activeElement === name || document.activeElement === value) return;
      settle(true);
    }, 0);
    for (const box of [name, value]) {
      box.addEventListener('blur', leaving);
      box.addEventListener('keydown', (event) => {
        if (frontmatterKeyLeavesBox(event)) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          // Enter on a half-filled row moves to the empty half rather than writing a key with nothing under it.
          if (!name.value.trim()) name.focus();
          else if (!value.value.trim()) value.focus();
          else settle(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          settle(false);
        }
      });
      cell.appendChild(box);
    }
    name.focus();
  });
  cell.appendChild(button);
  row.appendChild(cell);
  const body = block.querySelector('tbody');
  if (body) body.appendChild(row);
  return button;
}

// Whether the gutter's plus, aimed at this gap, starts a field block rather than opening the insert options. Only above everything, and only on a Markdown note that has none: anywhere else it would make metadata out of an insert nobody meant that way.
function frontmatterCanStart(gap) {
  return !!gap
    && !gap.above
    && currentDocumentFormat === 'markdown'
    && readerEditingAllowed()
    && !frontmatterBlock();
}

// Start a field block on a note with none: an empty one at the top of the page, open on its own add row. Committing writes the fences and the first field together, through the same command every other field write goes through; abandoning takes the block away again and the file never moved.
function startFrontmatterAtTop() {
  const body = app.querySelector('.document-body');
  if (!body || frontmatterBlock(body)) return;
  const block = document.createElement('div');
  block.className = 'frontmatter is-editable';
  block.innerHTML = '<table><tbody></tbody></table>';
  body.insertBefore(block, body.firstChild);
  const button = frontmatterAddRow(block, () => block.remove());
  if (button) button.click();
}

// Bind the field block. A locked document gets none of this: no edit box, no cross, no add row, and the table reads exactly as it did before.
function bindFrontmatterFields(root) {
  const block = frontmatterBlock(root);
  if (!block || !readerEditingAllowed()) return;
  block.classList.add('is-editable');
  for (const cell of block.querySelectorAll('td[data-leaf-field]')) {
    const key = cell.dataset.leafField;
    // Which control to draw comes from the type the parser already worked out; this never guesses one, and a value the picker cannot read keeps the text box rather than opening a picker that would clear it.
    const kind = cell.dataset.leafFieldKind;
    if (kind === 'list') {
      bindFrontmatterChips(cell, key);
    } else if (kind === 'checkbox') {
      bindFrontmatterCheckbox(cell, key);
    } else if (kind === 'date' && frontmatterDateValue(cell.textContent.trim())) {
      cell.addEventListener('click', () => editFrontmatterDate(cell, key));
    } else {
      cell.addEventListener('click', () => editFrontmatterCell(cell, key, (text) => sendFieldEdit(key, text)));
    }
    const row = cell.parentElement;
    const name = row && row.querySelector('th');
    if (name) {
      // Renaming is one splice over the key's own bytes on the host side, so the field keeps its value, its quoting and its place in the block.
      name.addEventListener('click', () => editFrontmatterCell(name, `Name of ${key}`, (text) => {
        sendEditCommand({ command: 'renameField', key, to: text });
      }, true));
    }
    if (row) row.appendChild(frontmatterRemoveCell(key));
  }
  frontmatterAddRow(block);
}
