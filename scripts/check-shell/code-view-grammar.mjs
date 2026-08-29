// The code view's grammar, and the offsets it reads a document back at.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  check,
  record,
  root,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { lineIndexAtByteOffset, byteOffsetAtLineIndex } = booted;

  // JSON has no bundled colorizer, so its grammar is ours. Monarch compiles a grammar only when a file is first opened, so a bad rule is otherwise a wrongly colored code view on somebody's machine and nothing before it. Monaco cannot load here — no DOM, and it is installed only to regenerate the bundle — so the real rules are driven the way Monarch drives them: one line at a time, first rule that matches at the position wins, the state stack carried across lines.
  check('the JSON grammar colors a JSON file, comments and all', () => {
    const { jsonMonarchLanguage, monacoLanguageFor } = booted;
    if (monacoLanguageFor({ language: 'json' }) !== 'json') throw new Error('a .json payload is not sent to the grammar');
    if (monacoLanguageFor({ language: 'html' }) !== 'html') throw new Error('an .html payload is not sent to the grammar');
    if (monacoLanguageFor({ language: 'unknown' }) !== 'plaintext') throw new Error('an unknown payload is not plain text');
    const grammar = jsonMonarchLanguage();
    const tokenize = (text) => {
      const out = [];
      const stack = ['root'];
      for (const line of text.split('\n')) {
        let at = 0;
        while (at < line.length) {
          let matched = null;
          for (const [pattern, token, action] of grammar.tokenizer[stack[stack.length - 1]]) {
            const anchored = new RegExp(pattern.source, 'y');
            anchored.lastIndex = at;
            const hit = anchored.exec(line);
            if (!hit || !hit[0].length) continue;
            matched = { text: hit[0], token, action };
            break;
          }
          if (!matched) {
            at += 1; // Monarch's own fallback: one character as the default token.
            continue;
          }
          out.push([matched.text, matched.token]);
          if (matched.action === '@pop') stack.pop();
          else if (matched.action) stack.push(matched.action.slice(1));
          at += matched.text.length;
        }
      }
      return out;
    };
    const colorOf = (text, want) => {
      const found = tokenize(text).find((pair) => pair[0] === want[0]);
      if (!found) throw new Error(`${JSON.stringify(want[0])} is not a token of ${JSON.stringify(text)}`);
      if (found[1] !== want[1]) throw new Error(`${JSON.stringify(want[0])} is ${found[1]}, wanted ${want[1]}`);
    };
    // A key is `type` and a value is `string`, the way the bundled YAML grammar spells them — the same pair of colors in both formats, in one code view.
    colorOf('{ "name": "leaf" }', ['"name"', 'type']);
    colorOf('{ "name": "leaf" }', ['"leaf"', 'string']);
    colorOf('{ "name" : "leaf" }', ['"name"', 'type']); // space before the colon
    colorOf('{ "a\\"b": 1 }', ['"a\\"b"', 'type']); // an escaped quote inside a key
    colorOf('{ "on": true }', ['true', 'keyword']);
    colorOf('{ "on": null }', ['null', 'keyword']);
    colorOf('{ "n": -12.5e-3 }', ['-12.5e-3', 'number']);
    colorOf('{ "n": 0 }', ['0', 'number']);
    colorOf('[1, 2]', [',', 'delimiter']);
    // Neither is JSON, and both are in real .json files — the ones whose reading view refuses to parse, which is why their author is in the code view.
    colorOf('{ "a": 1 } // trailing note', ['// trailing note', 'comment']);
    colorOf('/* head */ { "a": 1 }', ['/*', 'comment']);
    // A block comment holds its color to the end, over a line break and a `*` that closes nothing.
    const block = tokenize('/*\n * still a comment\n */\n{ "a": 1 }');
    for (const [text, token] of block.slice(0, block.findIndex((pair) => pair[0] === '*/') + 1)) {
      if (token !== 'comment') throw new Error(`${JSON.stringify(text)} inside a block comment is ${token}`);
    }
    colorOf('/*\n * x\n */\n{ "a": 1 }', ['"a"', 'type']); // and the file carries on after it
    // An unclosed quote takes the rest of its line and no more.
    colorOf('{ "a": "oops\n{ "b": 1 }', ['"oops', 'string']);
    colorOf('{ "a": "oops\n{ "b": 1 }', ['"b"', 'type']);
    // Every color the grammar asks for has to be one the theme paints, or the text silently falls back to the foreground. `type`/`key`/`number`/`delimiter` are in defineLeafMonacoTheme for exactly these formats.
    const painted = ['string', 'number', 'keyword', 'comment', 'type', 'key', 'delimiter'];
    for (const state of Object.values(grammar.tokenizer)) {
      for (const [, token] of state) {
        if (!painted.includes(token)) throw new Error(`nothing paints ${token}`);
      }
    }
  });

  // The source view's color squares. Monaco draws them; what it is missing is anything saying where the colors are, and that is leafColorRanges — a plain function over a string, so it is driven here with no editor and no page, the way the grammar above is. The spellings are src/tests/colors.json, which the reading view's own recognizer joins when css-documents ships: one list, so the two views cannot disagree about what a color is.
  check('every color spelling in the fixture is recognized, and every non-color is not', () => {
    const { leafColorRanges } = booted;
    const fixture = JSON.parse(readFileSync(join(root, 'src/tests/colors.json'), 'utf8'));
    if (fixture.colors.length < 20) throw new Error('the color fixture has gone thin');
    const byte = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
    for (const entry of fixture.colors) {
      const found = leafColorRanges(entry.value);
      // Only "anywhere" draws in the source view: a color name has no place of its own in prose, which is what "value" records for the reading view.
      if (entry.where !== 'anywhere') {
        if (found.length) throw new Error(`${JSON.stringify(entry.value)} drew ${found.length} square(s)`);
        continue;
      }
      if (found.length !== 1) throw new Error(`${JSON.stringify(entry.value)} drew ${found.length} squares`);
      const one = found[0];
      if (one.start !== 0 || one.end !== entry.value.length) {
        throw new Error(`${JSON.stringify(entry.value)} was found at ${one.start}..${one.end}`);
      }
      const rgba = byte(one.red) + byte(one.green) + byte(one.blue) + byte(one.alpha);
      if (rgba !== entry.rgba) throw new Error(`${JSON.stringify(entry.value)} is ${rgba}, wanted ${entry.rgba}`);
    }
    // And in a line rather than alone: one of this repo's own theme rows, where the value sits in a table cell inside backticks.
    const row = '| surface-muted                | `#f6f6f6` |';
    const inRow = leafColorRanges(row);
    if (inRow.length !== 1 || row.slice(inRow[0].start, inRow[0].end) !== '#f6f6f6') {
      throw new Error(`a theme table row gave ${JSON.stringify(inRow)}`);
    }
    // Two on a line, each at its own place, and the count is what the fixture cases cannot show.
    const pair = leafColorRanges('from #000000 to rgb(255 255 255)');
    if (pair.length !== 2 || pair[0].start !== 5 || pair[1].start !== 16) {
      throw new Error(`two colors on one line gave ${JSON.stringify(pair)}`);
    }
    // A gradient is not a color, but the hex values inside one are.
    if (leafColorRanges('linear-gradient(#fff, #000000)').length !== 2) {
      throw new Error('the colors inside a gradient are not drawn');
    }
  });

  // The square is a mark, not a control, and it is one for free: the color picker's hover participant is built into Monaco and never registered, so a click on the square does nothing. That decision has to survive the next regeneration of the bundle, which is by hand — hence the guard on the import list rather than on the 2.8MB output.
  check('the vendored editor bundle asks for no color picker', () => {
    const bundler = readFileSync(join(root, 'scripts/bundle-monaco.mjs'), 'utf8');
    const entry = bundler.match(/const ENTRY = `([\s\S]*?)`;/);
    if (!entry) throw new Error("could not find the bundler's import list");
    for (const line of entry[1].split('\n')) {
      if (/^import\b/.test(line) && /colorPicker|colorContribution/i.test(line)) {
        throw new Error(`the bundle asks for the color picker: ${line.trim()}`);
      }
    }
    // And nothing may offer a presentation, which is the other half: a presentation is what the editor writes back through.
    const codeView = readFileSync(join(root, 'src/assets/shell/code-view.js'), 'utf8');
    if (!/provideColorPresentations\(\)\s*\{\s*return \[\];/.test(codeView)) {
      throw new Error('the color provider offers a way to rewrite a value');
    }
    // Every language the code view can put in front of somebody: a registration lost here is a format that silently stops drawing squares.
    const registered = codeView.match(/\[([^\]]*)\]\.forEach\(\(id\) =>\s*\n?\s*monaco\.languages\.registerColorProvider/);
    if (!registered) throw new Error('nothing registers the color provider');
    for (const id of ['markdown', 'html', 'xml', 'yaml', 'json', 'plaintext']) {
      if (!registered[1].includes(`'${id}'`)) throw new Error(`${id} gets no color squares`);
    }
  });

  check('byte offsets and line numbers agree in both directions', () => {
    // The reader's place is a byte offset on the Rust side and a line number in the editor; multi-byte characters are where the two disagree.
    const text = 'ascii\ncafé and ünicode\n😀 wide\nlast';
    for (let line = 0; line < 4; line += 1) {
      const bytes = byteOffsetAtLineIndex(text, line);
      const back = lineIndexAtByteOffset(text, bytes);
      if (back !== line) {
        throw new Error(`line ${line} -> byte ${bytes} -> line ${back}`);
      }
    }
    if (byteOffsetAtLineIndex(text, 0) !== 0) throw new Error('line 0 is not byte 0');
    // "café" is five characters but six bytes, so the second line's start must account for the accent.
    if (byteOffsetAtLineIndex(text, 1) !== 'ascii\n'.length) {
      throw new Error('the second line does not start after the first');
    }
    if (byteOffsetAtLineIndex(text, 2) !== Buffer.byteLength('ascii\ncafé and ünicode\n')) {
      throw new Error('the third line does not account for multi-byte characters');
    }
  });
}
