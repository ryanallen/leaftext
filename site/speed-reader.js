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
  '.site-settings',
  '.document-minimap',
  '.docs-sidebar',
  '.docs-mobile-nav',
  '.docs-pager',
  '[data-speed-reader-skip]',
  '.speed-reader-anchor',
].join(',');

// Building the splitter is the browser standing a language service up, and on a published page nothing asks for one before this — so it waits for the first word a reader actually starts on rather than being paid by every page that loads the module. Kept from that call on; `null` where the browser has no `Intl.Segmenter`, which is why the held answer is told apart by `undefined` rather than by being falsy.
let heldWordSegmenter;

function wordSegmenter() {
  if (heldWordSegmenter === undefined) {
    heldWordSegmenter =
      typeof Intl !== 'undefined' && Intl.Segmenter
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
  }
  return heldWordSegmenter;
}

function graphemes(text) {
  const segmenter = wordSegmenter();
  if (segmenter) return Array.from(segmenter.segment(text), (part) => part.segment);
  return Array.from(text);
}

function hasCjk(text) {
  return /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text);
}

function isEligibleWord(word) {
  if (word.length < 2 || hasCjk(word)) return false;
  if (!/^\p{L}+(?:['\u2019]\p{L}+)?$/u.test(word)) return false;
  return true;
}

// An all-uppercase word (HTML, GFM, JSON) is an acronym read as a single unit, so it gets bolded whole rather than split into a lead prefix and a dim tail \u2014 a half-bold "HT\u200bML" reads as broken.
function isAcronym(word) {
  return /^\p{Lu}+$/u.test(word);
}

const DIRECT_SLICE_WORD = /^[A-Za-z]+(?:['\u2019][A-Za-z]+)?$/;

export function leadAnchorPrefixLength(count) {
  if (count <= 1) return 0;
  if (count <= 3) return 1;
  if (count <= 5) return 2;
  if (count <= 8) return 3;
  if (count <= 12) return 4;
  return Math.min(6, Math.ceil(count * 0.35));
}

function appendAnchoredWord(fragment, word) {
  const chars = DIRECT_SLICE_WORD.test(word) ? null : graphemes(word);
  const count = chars ? chars.length : word.length;
  const prefixLength = isAcronym(word) ? count : leadAnchorPrefixLength(count);
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

function appendCandidate(fragment, token) {
  const parts = token.split(/(-)/);
  for (const part of parts) {
    if (part === '') continue;
    if (part === '-') {
      fragment.append(document.createTextNode(part));
      continue;
    }
    if (!isEligibleWord(part)) {
      fragment.append(document.createTextNode(part));
      continue;
    }
    appendAnchoredWord(fragment, part);
  }
}

function isWordChar(char) {
  return Boolean(char && /[\p{L}\p{N}]/u.test(char));
}

// A token is part of a code-like run — and so should not get a lead anchor — only when a digit is fused to it (page2, COVID19) or a joiner punctuation glues it to another word character on the joiner's far side (file.md, a@b, x=y, v1.2). A joiner against whitespace, the end of the text, or sentence punctuation (a trailing period, comma, colon, …) is ordinary prose, so words ending a sentence still get anchored.
const SPEED_READER_JOINER = /[:/\\._@#?=&%+~]/;
function touchesCodeRun(text, start, end) {
  const before = text[start - 1];
  const after = text[end];
  if (/[0-9]/.test(before || '') || /[0-9]/.test(after || '')) return true;
  if (SPEED_READER_JOINER.test(before || '') && isWordChar(text[start - 2])) return true;
  if (SPEED_READER_JOINER.test(after || '') && isWordChar(text[end + 1])) return true;
  return false;
}

function anchoredFragment(text) {
  const fragment = document.createDocumentFragment();
  const tokenPattern = /\p{L}+(?:['\u2019-]\p{L}+)*/gu;
  let cursor = 0;
  let changed = false;
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index || 0;
    if (index > cursor) fragment.append(document.createTextNode(text.slice(cursor, index)));
    if (touchesCodeRun(text, index, index + token.length)) {
      fragment.append(document.createTextNode(token));
      cursor = index + token.length;
      continue;
    }
    const before = fragment.childNodes.length;
    appendCandidate(fragment, token);
    changed = changed || fragment.childNodes.length !== before + 1 || fragment.lastChild?.textContent !== token;
    cursor = index + token.length;
  }
  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  return changed ? fragment : null;
}

function shouldSkipTextNode(node, root) {
  if (!node.nodeValue || !node.nodeValue.trim()) return true;
  if (!/\p{L}/u.test(node.nodeValue)) return true;
  const parent = node.parentElement;
  if (!parent || parent.closest(SPEED_READER_SKIP_SELECTOR)) return true;
  return !root.contains(parent);
}

export function applySpeedReader(root) {
  if (!root || root.dataset.speedReaderProcessed === 'true') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipTextNode(node, root) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  // Do not mark empty/unrendered content as processed. The settings boot applies speed reader to every .markdown-body, which can run against a still-empty content element before the document is rendered. Marking it processed here would block the real anchoring pass once the content arrives, leaving dimmed prose with no bold lead anchors.
  if (nodes.length === 0) return;
  for (const node of nodes) {
    const fragment = anchoredFragment(node.nodeValue || '');
    if (fragment) node.replaceWith(fragment);
  }
  root.dataset.speedReaderProcessed = 'true';
}

export function applySpeedReaderIfEnabled(root) {
  if (document.documentElement.dataset.speedReader !== 'true') return;
  applySpeedReader(root);
}
