const SPEED_READER_SKIP_SELECTOR = [
  'code',
  'pre',
  'kbd',
  'samp',
  'script',
  'style',
  'textarea',
  'input',
  'select',
  'button',
  'svg',
  'math',
  '.katex',
  '.mermaid',
  '.library-pane',
  '.tab-bar',
  '.app-bar',
  '.document-minimap',
  '.glossary-sheet',
  '.docs-pager',
  '[data-speed-reader-skip]',
  '.speed-reader-anchor',
].join(',');
// Building the splitter is the browser standing a language service up, and that is nearly the whole of what it costs — so it waits for the first word a reader actually starts on rather than being paid by every launch. Kept from that call on; `null` where the browser has no `Intl.Segmenter`, which is why the held answer is told apart by `undefined` rather than by being falsy.
let speedReaderSegmenterHeld;
function speedReaderSegmenter() {
  if (speedReaderSegmenterHeld === undefined) {
    speedReaderSegmenterHeld = (typeof Intl !== 'undefined' && Intl.Segmenter)
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  }
  return speedReaderSegmenterHeld;
}
function speedReaderGraphemes(text) {
  const segmenter = speedReaderSegmenter();
  if (segmenter) {
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  return Array.from(text);
}
function speedReaderHasCjk(text) {
  return /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text);
}
function isSpeedReaderWord(word) {
  if (word.length < 2 || speedReaderHasCjk(word)) {
    return false;
  }
  return /^\p{L}+(?:['\u2019]\p{L}+)?$/u.test(word);
}
// An all-uppercase word (HTML, GFM, JSON) is an acronym read as a single unit, so it is bolded whole rather than split into a lead prefix and a dim tail.
function isSpeedReaderAcronym(word) {
  return /^\p{Lu}+$/u.test(word);
}
// A word of basic-Latin letters and at most one apostrophe has one code unit per grapheme, so its lead and tail are slices of the string itself — 40,000 ordinary words cost 9.7 ms that way against 164.1 ms through the splitter, and a real 742,054-character document fell from 722–835 ms to 292–296. Every other eligible word keeps the splitter, or a letter outside the basic plane would be cut through its surrogate pair.
const DIRECT_SLICE_SPEED_READER_WORD = /^[A-Za-z]+(?:['\u2019][A-Za-z]+)?$/;
function leadAnchorPrefixLength(count) {
  if (count <= 1) return 0;
  if (count <= 3) return 1;
  if (count <= 5) return 2;
  if (count <= 8) return 3;
  if (count <= 12) return 4;
  return Math.min(6, Math.ceil(count * 0.35));
}
function appendSpeedReaderWord(fragment, word) {
  const chars = DIRECT_SLICE_SPEED_READER_WORD.test(word) ? null : speedReaderGraphemes(word);
  const count = chars ? chars.length : word.length;
  const prefixLength = isSpeedReaderAcronym(word) ? count : leadAnchorPrefixLength(count);
  if (prefixLength === 0) {
    fragment.append(document.createTextNode(word));
    return;
  }
  const anchor = document.createElement('span');
  anchor.className = 'speed-reader-anchor';
  anchor.textContent = chars ? chars.slice(0, prefixLength).join('') : word.slice(0, prefixLength);
  const tail = chars ? chars.slice(prefixLength).join('') : word.slice(prefixLength);
  fragment.append(anchor, document.createTextNode(tail));
}
function appendSpeedReaderCandidate(fragment, token) {
  const parts = token.split(/(-)/);
  parts.forEach((part) => {
    if (!part) return;
    if (part === '-' || !isSpeedReaderWord(part)) {
      fragment.append(document.createTextNode(part));
      return;
    }
    appendSpeedReaderWord(fragment, part);
  });
}
function isSpeedReaderWordChar(char) {
  return Boolean(char && /[\p{L}\p{N}]/u.test(char));
}
// A token is code-like (no lead anchor) only when a digit is fused to it (page2) or a joiner glues it to a word char on its far side (file.md, a@b, x=y). A joiner against whitespace or sentence punctuation is ordinary prose.
const SPEED_READER_JOINER = /[:/\\._@#?=&%+~]/;
function speedReaderTouchesCode(text, start, end) {
  const before = text[start - 1];
  const after = text[end];
  if (/[0-9]/.test(before || '') || /[0-9]/.test(after || '')) return true;
  if (SPEED_READER_JOINER.test(before || '') && isSpeedReaderWordChar(text[start - 2])) return true;
  if (SPEED_READER_JOINER.test(after || '') && isSpeedReaderWordChar(text[end + 1])) return true;
  return false;
}
function speedReaderFragment(text) {
  const fragment = document.createDocumentFragment();
  const tokenPattern = /\p{L}+(?:['\u2019-]\p{L}+)*/gu;
  let cursor = 0;
  let changed = false;
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index || 0;
    if (index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, index)));
    }
    if (speedReaderTouchesCode(text, index, index + token.length)) {
      fragment.append(document.createTextNode(token));
      cursor = index + token.length;
      continue;
    }
    const before = fragment.childNodes.length;
    appendSpeedReaderCandidate(fragment, token);
    changed = changed || fragment.childNodes.length !== before + 1 || fragment.lastChild?.textContent !== token;
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }
  return changed ? fragment : null;
}
function shouldSkipSpeedReaderTextNode(node, root) {
  if (!node.nodeValue || !node.nodeValue.trim()) {
    return true;
  }
  if (!/\p{L}/u.test(node.nodeValue)) {
    return true;
  }
  const parent = node.parentElement;
  if (!parent || parent.closest(SPEED_READER_SKIP_SELECTOR)) {
    return true;
  }
  return !root.contains(parent);
}
function applySpeedReaderToDocument(root = app.querySelector('.document-body')) {
  if (!speedReaderEnabled || !root || root.dataset.speedReaderProcessed === 'true') {
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipSpeedReaderTextNode(node, root) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node);
  }
  nodes.forEach((node) => {
    const fragment = speedReaderFragment(node.nodeValue || '');
    if (fragment) {
      node.replaceWith(fragment);
    }
  });
  root.dataset.speedReaderProcessed = 'true';
}
let speedReaderEnabled = LEAF_SETTINGS.speedReaderEnabled === true;
function setSpeedReaderEnabled(enabled) {
  speedReaderEnabled = Boolean(enabled);
  document.documentElement.dataset.speedReader = String(speedReaderEnabled);
  if (speedReaderEnabled) {
    applySpeedReaderToDocument();
  }
}
setSpeedReaderEnabled(speedReaderEnabled);
// The padlocks: whether documents open ready to type into. Saved settings, not a question asked again on every file you open. One per editable view, because typing in the page and typing in the source are two different risks and unlocking one is not consent to the other. Both locked by default.
readingUnlocked = LEAF_SETTINGS.readingUnlocked === true;
codeUnlocked = LEAF_SETTINGS.codeUnlocked === true;
function readerEditingAllowed() {
  return readingUnlocked;
}
// Set by the two gestures that mean "leave the map": a search hit, whose whole point is landing on the matching line, and the jump to the source view. Everything else that opens a file -- the pane, a tab, a link, a node on the map -- keeps the view you are in, so changing document does not change how you read.
