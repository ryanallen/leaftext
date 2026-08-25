// A front-end test that names a line of the page holds nothing when the page holds that line twice: the pin passes from wherever the line landed, so emptying the function the test names leaves it green. This refuses such a pin.
//
// The refusal is here rather than in `assert_contains`, which most of the suite reads through — most of those calls over a rendered document, a stylesheet or XML, where a line appearing many times is the right claim. A needle handed to `assert_in` is deliberately scoped and is left alone.
//
// The rules are proved on made-up test source before the real files are opened, so a reader that quietly stops matching fails the build instead of passing everything.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { check, pageMarkup, root, source } from './shared.mjs';

// ---- the haystacks ----------------------------------------------------------

// The four Rust builders this file rebuilds a string from, named once.
const PAGE_BUILDER = 'app_shell_html_for_host';
const BOOTSTRAP_BUILDER = 'theme_bootstrap_script_for_host';
const VENDORED_ASSETS_BUILDER = 'vendored_asset_urls_json_for_host';
const MINIMAP_BUILDER = 'exported_page_minimap_script';

/** A stand-in for a URL only the host can spell: `bundled_asset_url` composes the platform's scheme and the running version, and no pin needs either. What a pin does reach for is the asset's own path and the version query, so those are what this carries. */
function standInAssetUrl(asset) {
  return `leaf-asset://leaf.local/${asset}?v=stand-in`;
}

/** The app's Rust, which every seam below is read out of rather than copied from. */
function rustSource() {
  return readFileSync(join(root, 'src/lib.rs'), 'utf8');
}

// The theme bootstrap as the page carries it: a second script inline in the page, so a line in it is a second place a test would match. The vendored runtimes' URLs are built from the key-and-file pairs Rust builds them from; the other two seams are the theme registry's own lists, stood in for because their values are Rust's and no pin needs one spelled — what matters is that the name is gone, since a placeholder left standing reads as page text and every pin under it counts nowhere.
function filledThemeBootstrap(lib) {
  const urls = vendoredAssetsIn(lib, VENDORED_ASSETS_BUILDER)
    .map(([key, asset]) => `"${key}":"${standInAssetUrl(asset)}"`)
    .join(',');
  let script = readFileSync(join(root, 'src/assets/theme-bootstrap.js'), 'utf8');
  for (const seam of substitutionsIn(lib, BOOTSTRAP_BUILDER)) {
    const value = seam.fill === VENDORED_ASSETS_BUILDER ? `{${urls}}` : 'null';
    script = script.replace(`{{${seam.placeholder}}}`, () => value);
  }
  return script;
}

// What `app_shell_html()` hands a test, with every name the host fills filled — so a pin over it is counted in the string the test reads rather than in a copy short of it. The seams are read out of the Rust that fills them and never typed here, because a hand-made copy that drifts throws nothing: it stops holding the lines the tests pin, every pin over it counts nowhere, and the check reports green.
function pageAlone() {
  const lib = rustSource();
  const bootstrap = filledThemeBootstrap(lib);
  let page = pageMarkup();
  for (const seam of substitutionsIn(lib, PAGE_BUILDER)) {
    const value = seam.asset
      ? standInAssetUrl(seam.asset)
      : seam.fill === BOOTSTRAP_BUILDER
        ? bootstrap
        : null;
    // `{{THEME_ITEMS}}` is the one left standing: its value is markup Rust composes — twelve cards, their swatches and their styling — which is the value reader this check deliberately does not have, and no pin needs it. A pin written inside a card counts nowhere, and the last rule below names it rather than miscounting in silence.
    if (value === null) continue;
    page = page.replace(`{{${seam.placeholder}}}`, () => value);
  }
  return page;
}

// What `app_shell_page()` hands a test: that page and the script joined, which is what the web view ends up with.
function joinedPage() {
  return `${pageAlone()}\n${source}`;
}

// What `exported_page_minimap_script()` hands a test: `site/minimap.js` with the one `export` mark off, since a browser refuses a module script on a page opened off a disk, and one call on the foot. The mark, what replaces it and the foot are read out of that Rust function's own literals rather than spelled again here — both files move, and a respelling that has stopped applying is a rebuild that has already broken.
function exportedPageMinimapScript() {
  return respelledScript(
    rustSource(),
    MINIMAP_BUILDER,
    readFileSync(join(root, 'site/minimap.js'), 'utf8'),
  );
}

/**
 * Every haystack a front-end test pins against, and what this check does with it: `build` where the string can be rebuilt here and a pin counted in the one its own test asked for, `why` where it cannot and the reason stands in its place.
 *
 * One builder to a row and no wildcards — a row that could swallow the next one is the ambiguity this whole check exists to refuse. A pin against a builder no row names fails, so the next haystack somebody writes is written down here rather than going unread.
 */
const HAYSTACKS = [
  { builder: 'app_shell_page', build: joinedPage },
  { builder: 'app_shell_html', build: pageAlone },
  { builder: 'app_shell_script', build: () => source },
  { builder: 'exported_page_minimap_script', build: exportedPageMinimapScript },
  {
    builder: 'reading_mode_css',
    why: 'a stylesheet holds one declaration under many selectors on purpose, so counting places in it would refuse hundreds of pins that are right',
  },
  { builder: 'rule_body', why: 'one rule out of that stylesheet, and the same reason' },
  { builder: 'rule', why: 'the same, taken by a closure of the test file that wants it' },
  { builder: 'overflow_panel_rule', why: 'the same, for the pane the library folds its controls into' },
  {
    builder: 'exported_page_document',
    why: 'a fixed markup template composed from the arguments a test hands it, holding no function and so no block for assert_in to name',
  },
  {
    builder: 'initial_state_script',
    why: 'src/scripts.rs emits one assignment or one call per builder and holds no function across the whole file, so a line in it has nowhere to move to and assert_in has no opener to name',
  },
  { builder: 'initial_document_formats_script', why: 'the same, for the formats the app opens' },
  { builder: 'document_state_script', why: 'the same, for the document being opened' },
  { builder: 'workspace_reload_script', why: 'the same, for a reload keeping its place' },
  { builder: 'workspace_switch_script', why: 'the same, for a switch to another vault' },
  { builder: 'source_updated_script', why: 'the same, for the source coming back from a save' },
];

/** The haystacks a pin can be counted in, built once. */
function buildCounted() {
  return new Map(HAYSTACKS.filter((row) => row.build).map((row) => [row.builder, row.build()]));
}

const NAMED = new Set(HAYSTACKS.map((row) => row.builder));

/** A failure line for every pin whose builder no row names — the next haystack, found the moment a test pins against it. */
function unnamedHaystacks(file, pins) {
  const found = [];
  for (const pin of pins) {
    if (NAMED.has(pin.builder)) continue;
    found.push(
      `src/tests/${file}:${pin.line} ${pin.test} pins a line in ${pin.builder}(), which no row in this check names — give it one saying either how to rebuild it here or why a pin in it cannot be counted`,
    );
  }
  return found;
}

/**
 * A failure line for every pin holding no place at all in the haystack its own test named.
 *
 * A pin over a rebuilt haystack sits inside a Rust test asserting the same line against the string Rust builds, and that test passes or the suite is red — so there is no honest case where it counts nowhere here. A pin this check cannot find is proof the rebuild above has stopped being the string that test reads, which is the same fault as a pin that has stopped holding anything, one layer up.
 */
function pinsCountingNowhere(file, pins, built) {
  const found = [];
  for (const pin of pins) {
    const haystack = built.get(pin.builder);
    if (haystack === undefined) continue;
    if (places(haystack, pin.value) > 0) continue;
    found.push(
      `src/tests/${file}:${pin.line} ${pin.test} pins a line this check finds nowhere in the ${pin.builder}() it rebuilds, while the Rust test asserting it passes — so the rebuild in this file has stopped being the string that test reads, and the rebuild is what moves, never the pin: ${JSON.stringify(pin.value)}`,
    );
  }
  return found;
}

function places(page, needle) {
  let total = 0;
  let at = 0;
  while ((at = page.indexOf(needle, at)) >= 0) {
    total += 1;
    at += 1;
  }
  return total;
}

// ---- reading a Rust string literal ------------------------------------------

const RAW_OPENER = /^r(#*)"/;

/** The literal starting at `at`, and where it ends — a raw string keeps its bytes, a plain one has its escapes read. `null` where `at` is not a literal. */
function literalAt(text, at) {
  const raw = RAW_OPENER.exec(text.slice(at, at + 16));
  if (raw) {
    const close = `"${raw[1]}`;
    const start = at + raw[0].length;
    const end = text.indexOf(close, start);
    if (end < 0) return null;
    return { value: text.slice(start, end), end: end + close.length };
  }
  if (text[at] !== '"') return null;
  let out = '';
  let index = at + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === '\\') {
      const next = text[index + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
      index += 2;
      continue;
    }
    if (character === '"') return { value: out, end: index + 1 };
    out += character;
    index += 1;
  }
  return null;
}

/** The text with `// …` taken out, so a comment quoting a word is not read as a pin — one list in the tree explains itself with `"so far"` in a comment above the rows. A `//` inside a literal is left alone. */
function withoutComments(text) {
  let out = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"' || RAW_OPENER.test(text.slice(index, index + 16))) {
      const literal = literalAt(text, index);
      if (literal) {
        out += text.slice(index, literal.end);
        index = literal.end;
        continue;
      }
    }
    if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index);
      if (end < 0) break;
      out += '\n';
      index = end + 1;
      continue;
    }
    out += text[index];
    index += 1;
  }
  return out;
}

/** Every literal in `text`, in order, each with where it starts — so a failure names the row rather than the head of the list it is in. */
function literalsIn(text) {
  const found = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"' || RAW_OPENER.test(text.slice(index, index + 16))) {
      const literal = literalAt(text, index);
      if (literal) {
        found.push({ value: literal.value, at: index });
        index = literal.end;
        continue;
      }
    }
    index += 1;
  }
  return found;
}

// ---- reading the seams Rust fills, out of Rust ------------------------------
//
// Only the names: which placeholder a builder substitutes, which bundled file each one names, and which two literals the minimap respelling is made of. The values are the host's and the theme registry's — an asset URL composed per platform, twelve theme cards of markup — and reading those would be a Rust reader written in JavaScript. No pin needs one spelled exactly; every pin needs the name it sits beside to be gone.

/** The block starting at `at`, counted from the bracket that opened it and with literals skipped. `null` where it never closes. */
function blockAfter(text, at, open, close) {
  let depth = 1;
  let index = at;
  while (index < text.length) {
    if (text[index] === '"' || RAW_OPENER.test(text.slice(index, index + 16))) {
      const literal = literalAt(text, index);
      if (literal) {
        index = literal.end;
        continue;
      }
    }
    if (text[index] === open) depth += 1;
    if (text[index] === close) {
      depth -= 1;
      if (depth === 0) return { text: text.slice(at, index), end: index };
    }
    index += 1;
  }
  return null;
}

/** The body of `fn name` in `text`. `null` where no function of that name is there. */
function rustFunctionBody(text, name) {
  const named = new RegExp(`\\bfn ${name}\\b`).exec(text);
  if (!named) return null;
  const opened = text.indexOf('{', named.index);
  if (opened < 0) return null;
  return blockAfter(text, opened + 1, '{', '}');
}

/** The first Rust literal at or after `from`, with where it ends. `null` where there is none. */
function literalAfter(text, from) {
  for (let index = from; index >= 0 && index < text.length; index += 1) {
    const literal = literalAt(text, index);
    if (literal) return literal;
  }
  return null;
}

const SUBSTITUTION = /\.replace\(\s*"\{\{(\w+)\}\}"\s*,\s*&(\w+)\(\s*(?:"([^"]*)")?/g;

/**
 * Every `{{NAME}}` a Rust builder substitutes, as `{ placeholder, fill, asset }` — `fill` the function whose answer goes in, `asset` the bundled file it names where it names one.
 *
 * An empty read is refused rather than taken for a builder with nothing to fill: a read that has quietly stopped matching leaves this file's copy of the page exactly as short as the hand-written one it replaced, which is the drift this whole rule exists to refuse.
 */
export function substitutionsIn(lib, builder) {
  const body = rustFunctionBody(lib, builder);
  if (!body) throw new Error(`could not find fn ${builder} in src/lib.rs`);
  const found = [...body.text.matchAll(SUBSTITUTION)].map((one) => ({
    placeholder: one[1],
    fill: one[2],
    asset: one[3],
  }));
  if (!found.length) {
    throw new Error(
      `fn ${builder} substitutes no {{NAME}} this check can read — the string it builds is one pins are counted in, so an empty read is drift rather than nothing to fill`,
    );
  }
  return found;
}

/** The vendored runtimes a Rust builder names, as `[key, file]` pairs — the keys the page reads them back by and the files they are served from. Empty is refused for the same reason. */
export function vendoredAssetsIn(lib, builder) {
  const body = rustFunctionBody(lib, builder);
  if (!body) throw new Error(`could not find fn ${builder} in src/lib.rs`);
  const pairs = [...body.text.matchAll(/\("(\w+)",\s*"([^"]+)"\)/g)].map((one) => [one[1], one[2]]);
  if (!pairs.length) {
    throw new Error(
      `fn ${builder} names no vendored asset this check can read — an empty read leaves every URL the page carries out of the string pins are counted in`,
    );
  }
  return pairs;
}

/**
 * `script` respelled the way a Rust builder respells it: the mark it replaces, what it replaces it with and the text it wraps the answer in, all read out of that function's own literals.
 *
 * Rust's `replacen(…, 1)` takes the first occurrence, which is what JavaScript's string `.replace` does. A mark the script no longer holds is refused: a respelling that has stopped applying is a rebuild that has already broken, and it would go on producing a string no test ever reads.
 */
export function respelledScript(lib, builder, script) {
  const body = rustFunctionBody(lib, builder);
  if (!body) throw new Error(`could not find fn ${builder} in src/lib.rs`);
  const wrapper = literalAfter(body.text, body.text.indexOf('format!('));
  const respellAt = body.text.indexOf('.replacen(');
  const mark = respellAt < 0 ? null : literalAfter(body.text, respellAt);
  const into = mark ? literalAfter(body.text, mark.end) : null;
  if (!wrapper || !mark || !into || !wrapper.value.includes('{}')) {
    throw new Error(
      `fn ${builder} no longer reads as one format! wrapping one replacen — this check rebuilds the string it hands a test, so it cannot go on guessing at the two edits`,
    );
  }
  if (!script.includes(mark.value)) {
    throw new Error(
      `fn ${builder} replaces ${JSON.stringify(mark.value)}, which the script it respells no longer holds — the rebuild here has already stopped being the string that builder hands a test`,
    );
  }
  return wrapper.value.replace('{}', () => script.replace(mark.value, () => into.value));
}

// ---- reading the pins out of a test file ------------------------------------

/** The line `at` sits on, counted from one, so a failure names somewhere to look. */
function lineAt(text, at) {
  return text.slice(0, at).split('\n').length;
}

/**
 * Every haystack a test's pins are read against, as `{ pattern, builder }` — `pattern` how the call site spells it, `builder` the function it came from.
 *
 * Two shapes: a variable bound from a builder, and the builder handed straight to the assert with nothing bound at all, which is how three pins over the script are written. The builder is carried rather than assumed, because the string a pin is counted in is the one its own test asked for.
 */
function haystacksIn(block) {
  const found = new Map();
  for (const bound of block.matchAll(/let (?:mut )?(\w+)\s*=\s*(\w+)\(/g)) {
    found.set(bound[1], { pattern: bound[1], builder: bound[2] });
  }
  for (const call of block.matchAll(/assert_contains\(\s*&?(\w+)\(\)\s*,/g)) {
    found.set(`${call[1]}()`, { pattern: `${call[1]}\\(\\)`, builder: call[1] });
  }
  return [...found.values()];
}

/**
 * Every line the tests in `text` pin against a haystack they built, as `{ test, line, value, builder }`.
 *
 * Three shapes, because all three are in the tree: `assert_contains(&html, "…")`, a hand-written `assert!(html.contains("…"))`, and a `for expected in [ … ]` list whose body makes one of those calls. The `&` is optional, because a builder handing back a borrowed string — `app_shell_script()` does — is passed without one. A negative — `assert!(!html.contains("…"))` — is left alone: a line that must be nowhere in the page is unambiguous by nature and gets stronger from the whole page being the haystack. So is a needle handed to `assert_in`, which says where the line has to be and is the repair this check asks for.
 */
export function pinsIn(text) {
  const clean = withoutComments(text);
  const pins = [];
  for (const block of splitTests(clean)) {
    const named = /\bfn (\w+)\s*\(/.exec(block.text);
    if (!named) continue;
    const test = named[1];
    for (const { pattern, builder } of haystacksIn(block.text)) {
      const record = (at, value) =>
        pins.push({ test, line: lineAt(clean, block.at + at), value, builder });

      // assert_contains(&html, "…"), and assert_contains(script, "…") where the builder lends its string
      for (const hit of block.text.matchAll(
        new RegExp(`assert_contains\\(\\s*&?${pattern}\\s*,\\s*`, 'g'),
      )) {
        const literal = literalAt(block.text, hit.index + hit[0].length);
        if (literal) record(hit.index, literal.value);
      }

      // html.contains("…"), and never !html.contains("…")
      for (const hit of block.text.matchAll(
        new RegExp(`(!?)\\b${pattern}\\.contains\\(\\s*`, 'g'),
      )) {
        if (hit[1] === '!') continue;
        const literal = literalAt(block.text, hit.index + hit[0].length);
        if (literal) record(hit.index, literal.value);
      }

      // for expected in [ … ] { assert_contains(&html, expected); }
      for (const loop of block.text.matchAll(/for (\w+) in \[/g)) {
        const list = listAfter(block.text, loop.index + loop[0].length);
        if (!list) continue;
        const body = block.text.slice(list.end, list.end + 400);
        const positive = new RegExp(
          `assert_contains\\(\\s*&?${pattern}\\s*,\\s*${loop[1]}\\s*\\)|(?<!!)\\b${pattern}\\.contains\\(\\s*${loop[1]}\\s*\\)`,
        ).test(body);
        const negative = new RegExp(`!\\b${pattern}\\.contains\\(\\s*${loop[1]}\\s*\\)`).test(body);
        if (!positive || negative) continue;
        const listAt = loop.index + loop[0].length;
        for (const row of literalsIn(list.text)) record(listAt + row.at, row.value);
      }
    }
  }
  return pins;
}

/** One entry per `#[test]`, with where in the file it started. */
function splitTests(text) {
  const blocks = [];
  const marks = [...text.matchAll(/#\[test\]/g)].map((one) => one.index);
  for (let index = 0; index < marks.length; index += 1) {
    const at = marks[index];
    const end = index + 1 < marks.length ? marks[index + 1] : text.length;
    blocks.push({ at, text: text.slice(at, end) });
  }
  return blocks;
}

/** The `[ … ]` starting at `at`, bracket-counted with literals skipped. */
function listAfter(text, at) {
  return blockAfter(text, at, '[', ']');
}

// ---- the made-up source the reader is proved on -----------------------------

const MADE_UP = `#[test]
fn a_plain_call_is_read() {
    let html = app_shell_page();

    assert_contains(&html, "plainCall();");
    assert!(html.contains("handWritten();"));
    assert!(!html.contains("mustBeNowhere();"));
    assert_contains(&html, r#"<div class="raw">"#);
    assert_in(&html, "function scoped() {", "alreadyScoped();");
    // A comment quoting "notAPin();" is not a pin.
}

#[test]
fn a_loop_list_is_read() {
    let html = app_shell_page();

    for expected in [
        "inTheList();",
        // And the comment above this row says "alsoNotAPin();".
        "andThis();",
    ] {
        assert_contains(&html, expected);
    }

    for forbidden in ["neverThis();"] {
        assert!(!html.contains(forbidden));
    }
}

#[test]
fn the_script_on_its_own_is_read_too() {
    let script = app_shell_script();

    // Borrowed, so the call is written without the ampersand a page's own String needs.
    assert_contains(script, "lentWithNoAmpersand();");
    assert!(script.contains("lentAndHandWritten();"));
}

#[test]
fn a_builder_handed_straight_to_the_call_is_read() {
    assert_contains(app_shell_script(), "boundToNothing();");
}

#[test]
fn another_haystack_is_left_alone() {
    let css = reading_mode_css();

    assert_contains(&css, "notThePage();");
}

#[test]
fn a_haystack_no_row_names_is_refused() {
    let made = a_builder_with_no_row();

    assert_contains(&made, "unreadHaystack();");
}
`;

// The made-up Rust the seam readers are proved on, before `src/lib.rs` is opened — so a reader that has quietly stopped matching fails the build rather than filling a copy of the page with nothing.
const MADE_UP_RUST = `pub fn a_page_for_host(host: &dyn LeafHost) -> String {
    let asset = |name: &str| host.asset_url(name).unwrap_or_default();
    MADE_UP_HTML
        .replace("{{MADE_UP_SCRIPT_URL}}", &asset("made-up.js"))
        .replace(
            "{{MADE_UP_COMPOSED}}",
            &made_up_composed_html(),
        )
}

fn made_up_asset_urls_for_host(host: &dyn LeafHost) -> String {
    let entries = [
        ("madeUp", "made-up.min.js"),
        ("alsoMadeUp", "also/made-up.min.css"),
    ];
    format!("{{{}}}", entries.len())
}

fn a_builder_that_fills_nothing() -> String {
    String::new()
}

pub fn a_respelling() -> String {
    format!(
        "{}
madeUp(document);
",
        MADE_UP_JS.replacen(
            "
export function madeUp",
            "
function madeUp",
            1
        )
    )
}
`;

// A made-up script for that respelling to be read against, and what the two edits have to make of it.
const MADE_UP_SCRIPT = `
export function madeUp(doc) {}
`;

const MADE_UP_RESPELLING = `
function madeUp(doc) {}

madeUp(document);
`;

/** Whether `run` refused. A read that comes back empty and a respelling that no longer applies both have to throw, since either one silently leaves this file's copy short. */
function refused(run) {
  try {
    run();
  } catch {
    return true;
  }
  return false;
}

const EXPECTED = [
  'plainCall();',
  'handWritten();',
  '<div class="raw">',
  'inTheList();',
  'andThis();',
  'lentWithNoAmpersand();',
  'lentAndHandWritten();',
  'boundToNothing();',
];

// ---- the check --------------------------------------------------------------

export function run() {
  check('the seams this check fills its copies from are read out of the Rust that fills them', () => {
    const read = substitutionsIn(MADE_UP_RUST, 'a_page_for_host')
      .map((seam) => `${seam.placeholder}=${seam.fill}(${seam.asset ?? ''})`)
      .join(' ');
    const expected = 'MADE_UP_SCRIPT_URL=asset(made-up.js) MADE_UP_COMPOSED=made_up_composed_html()';
    if (read !== expected) {
      throw new Error(`the seams should read ${expected}, got ${read}`);
    }
    const assets = JSON.stringify(vendoredAssetsIn(MADE_UP_RUST, 'made_up_asset_urls_for_host'));
    const expectedAssets = '[["madeUp","made-up.min.js"],["alsoMadeUp","also/made-up.min.css"]]';
    if (assets !== expectedAssets) {
      throw new Error(`the vendored pairs should read ${expectedAssets}, got ${assets}`);
    }
    // An empty read is the drift this ticket is about, so it is refused rather than taken for a builder with nothing to fill.
    if (!refused(() => substitutionsIn(MADE_UP_RUST, 'a_builder_that_fills_nothing'))) {
      throw new Error('a builder substituting no name should be refused, not read as nothing to fill');
    }
    if (!refused(() => vendoredAssetsIn(MADE_UP_RUST, 'a_builder_that_fills_nothing'))) {
      throw new Error('a builder naming no vendored asset should be refused, not read as nothing to fill');
    }
    const respelled = respelledScript(MADE_UP_RUST, 'a_respelling', MADE_UP_SCRIPT);
    if (respelled !== MADE_UP_RESPELLING) {
      throw new Error(
        `the respelling should make ${JSON.stringify(MADE_UP_RESPELLING)}, got ${JSON.stringify(respelled)}`,
      );
    }
    if (!refused(() => respelledScript(MADE_UP_RUST, 'a_respelling', 'function madeUp(doc) {}'))) {
      throw new Error(
        'a mark the script no longer holds should be refused — a respelling that has stopped applying is a rebuild that has already broken',
      );
    }
  });

  check('the pin reader answers every shape a front-end test pins in', () => {
    const counted = buildCounted();
    const read = pinsIn(MADE_UP)
      .filter((pin) => counted.has(pin.builder))
      .map((pin) => pin.value);
    const missing = EXPECTED.filter((one) => !read.includes(one));
    if (missing.length) {
      throw new Error(`the reader missed ${JSON.stringify(missing)}, found ${JSON.stringify(read)}`);
    }
    const wrong = read.filter((one) => !EXPECTED.includes(one));
    if (wrong.length) {
      throw new Error(
        `the reader took ${JSON.stringify(wrong)} for a pin — a negative, a scoped needle, a comment or another haystack`,
      );
    }
    const named = pinsIn(MADE_UP).find((pin) => pin.value === 'inTheList();');
    if (named.test !== 'a_loop_list_is_read') {
      throw new Error(`a pin should name the test it is in, got ${named.test}`);
    }
    // Its own row rather than the head of the list, or every pin in a list of twenty reads as one line.
    const row = MADE_UP.split('\n').findIndex((line) => line.includes('"inTheList();"')) + 1;
    if (named.line !== row) {
      throw new Error(`a pin in a list should name its own row ${row}, got ${named.line}`);
    }
    // A builder no row names is the next haystack going unread, so it is named the moment a test pins against it — and the one that does have a row, counted or not, is left alone.
    const unnamed = unnamedHaystacks('made_up.rs', pinsIn(MADE_UP));
    if (unnamed.length !== 1 || !unnamed[0].includes('a_builder_with_no_row()')) {
      throw new Error(
        `the reader should name a_builder_with_no_row and nothing else, got ${JSON.stringify(unnamed)}`,
      );
    }
  });

  check('every haystack a front-end test pins against is one this check names', () => {
    const found = [];
    for (const file of frontEndTestFiles()) {
      found.push(...unnamedHaystacks(file, pinsIn(readFileSync(join(root, 'src/tests', file), 'utf8'))));
    }
    if (found.length) throw new Error(`\n    ${found.join('\n    ')}`);
  });

  check('no front-end test pins a line its own haystack holds more than once', () => {
    const built = buildCounted();
    const found = [];
    for (const file of frontEndTestFiles()) {
      for (const pin of pinsIn(readFileSync(join(root, 'src/tests', file), 'utf8'))) {
        const haystack = built.get(pin.builder);
        if (haystack === undefined) continue;
        const held = places(haystack, pin.value);
        if (held > 1) {
          found.push(
            `src/tests/${file}:${pin.line} ${pin.test} pins a line ${pin.builder}() holds ${held} times — say which block it has to be in with assert_in: ${JSON.stringify(pin.value)}`,
          );
        }
      }
    }
    if (found.length) throw new Error(`\n    ${found.join('\n    ')}`);
  });

  check('every line a front-end test pins is one this check finds in the haystack it rebuilds', () => {
    const madeUpPins = [
      { test: 'a_made_up_test', line: 3, value: 'inTheHaystack();', builder: 'app_shell_page' },
      { test: 'a_made_up_test', line: 4, value: 'nowhereInIt();', builder: 'app_shell_page' },
    ];
    const short = pinsCountingNowhere(
      'made_up.rs',
      madeUpPins,
      new Map([['app_shell_page', 'inTheHaystack();']]),
    );
    if (short.length !== 1 || !short[0].includes('nowhereInIt();')) {
      throw new Error(`the pin its haystack does not hold should be named, got ${JSON.stringify(short)}`);
    }
    const whole = pinsCountingNowhere(
      'made_up.rs',
      madeUpPins,
      new Map([['app_shell_page', 'inTheHaystack();nowhereInIt();']]),
    );
    if (whole.length) {
      throw new Error(`a haystack holding every pin should be left alone, got ${JSON.stringify(whole)}`);
    }

    const built = buildCounted();
    const found = [];
    for (const file of frontEndTestFiles()) {
      found.push(
        ...pinsCountingNowhere(file, pinsIn(readFileSync(join(root, 'src/tests', file), 'utf8')), built),
      );
    }
    if (found.length) throw new Error(`\n    ${found.join('\n    ')}`);
  });
}

/** The front-end test files, refused where the folder has stopped holding them rather than read as nothing to check. */
function frontEndTestFiles() {
  const files = readdirSync(join(root, 'src/tests')).filter(
    (name) => name.startsWith('app_shell_') && name.endsWith('.rs'),
  );
  if (files.length < 10) throw new Error(`expected the front-end test files, found ${files.length}`);
  return files;
}
