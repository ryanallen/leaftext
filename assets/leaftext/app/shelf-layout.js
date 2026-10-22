// shelf-layout.js
// ---------------------------------------------------------------------------
// A shelf's composition, the Arthurian shelf's and any other the site lays out as one. `index.md` stays the one source of words and stays a plain list everywhere else — a heading per bay, a line per book — and this lays its drawn HTML out as a bookshelf inside the reading column: the hero, the switch between its orders, the finder, the key, the bays of spines, the open book, and the list itself kept under them.
//
// `shelf-data.json`, written beside the shelf's `index.md` by the same tool, holds each book's reach, dates and editions in the list's own order, so every drawn line is paired with its record and a list that no longer matches its data is refused rather than drawn wrong. Its `shelf` block holds the words that are a shelf's own — its name, the orders it offers with their lines and notes, its tones, its filters and the page a book still to come links — and a shelf that names none is drawn in the Arthurian shelf's. `web/preview/boot.js` hands this to the host, and `shelf.js` redraws the bays out of the same functions when the order or a filter changes. It works on the renderer's HTML as text, as the front page's layout does.
// ---------------------------------------------------------------------------

/** The class the laid-out page carries, which is how a reader tells it from the list drawn plain. */
export const SHELF_LAYOUT_CLASS = 'shelf-layout';

/** The Arthurian shelf's name, said over its title. */
export const SHELF_NAME = 'The Arthurian shelf';

/** The three ways the Arthurian shelf stands, each with the line said under the switch while it is chosen, and the dated two with the line said under the title — story order's is the document's own. */
export const SHELF_ORDERS = [
  { key: 'story', label: 'Where the story happens', note: 'Story order places a book in the legend, not in history.' },
  { key: 'written', label: 'When it was written', note: 'Each book stands in the century it was written, dated as its source words it.', line: 'Every telling of the legend, standing in the century it was written. Pull one out to read it.' },
  { key: 'printed', label: 'When its edition was printed', note: 'Each book stands in the decade its edition was printed; one whose edition is not chosen stands last.', line: 'Every telling of the legend, standing in the decade its edition was printed. Pull one out to read it.' },
];

/** The credit under the line: the list's second paragraph, drawn in the hero only when it links the shelf's how page at Ryan Allen. */
export const SHELF_CREDIT = /<a\b[^>]*href="how-it-was-made\.md#ryan-allen"/;

/** The Arthurian shelf's six tones, in the key's order: the tone key a spine carries and what the key calls it. */
export const SHELF_TONES = [
  ['latin', 'Latin'],
  ['french', 'French'],
  ['english', 'English and Scots'],
  ['welsh', 'Welsh'],
  ['german', 'German'],
  ['other', 'Other languages'],
];
/** What the Arthurian shelf's tones sort by, which its tone filter is named for. */
export const SHELF_TONE_LABEL = 'Tradition';
/** The Arthurian shelf's three filters: the part of the story a book reaches, its tradition and whether it is out yet. */
export const SHELF_FILTERS = ['part', 'tone', 'status'];
/** The page a book still to come links on the Arthurian shelf. */
export const SHELF_COMING = 'story-map.md';

/** The words that are a shelf's own, read from the `shelf` block of its data, each falling back to the Arthurian shelf's where a shelf names none: its name, its orders, its tones, what its tone filter is named for, which filters it offers, and the page a book still to come links. */
export function shelfWords(data) {
  const own = data && data.shelf && typeof data.shelf === 'object' ? data.shelf : {};
  const orders = Array.isArray(own.orders) ? own.orders.filter((order) => order && typeof order.key === 'string' && order.key) : [];
  const tones = Array.isArray(own.tones) ? own.tones.filter((tone) => Array.isArray(tone) && tone.length === 2).map((tone) => [String(tone[0]), String(tone[1])]) : [];
  return {
    name: typeof own.name === 'string' && own.name ? own.name : SHELF_NAME,
    orders: orders.length ? orders : SHELF_ORDERS,
    tones: tones.length ? tones : SHELF_TONES,
    toneLabel: typeof own.toneLabel === 'string' && own.toneLabel ? own.toneLabel : SHELF_TONE_LABEL,
    filters: Array.isArray(own.filters) ? own.filters.map(String) : SHELF_FILTERS,
    coming: typeof own.coming === 'string' && own.coming ? own.coming : SHELF_COMING,
  };
}

/** The order a shelf opens in and its list is written in: the first it offers. */
export const firstOrder = (data) => shelfWords(data).orders[0].key;

/** Whether a shelf stands its books where their story happens, which is what a reach, a story filter and a story's bays are about. */
const storied = (data) => shelfWords(data).orders.some((order) => order.key === 'story');

/** The paint of one tone on the element that carries it: the tone and its ink, as `shelf.js` sets them on the shelf from the theme in force, the primary standing in until it has. Written on the element rather than in the stylesheet, so a shelf's tones are whatever its data names. */
const toneStyle = (tone) => `--spine:var(--shelf-tone-${tone}, var(--lt-primary));--spine-ink:var(--shelf-ink-${tone}, var(--lt-primary-foreground))`;

const CENTURY_WORDS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth', 'Twenty-first'];
const UNDATED = 'Many periods or date unknown';
const UNPRINTED = 'Edition not chosen yet';

// A spine is thicker the more words its source holds: the least at `at` words or fewer, `perDoubling` more for every doubling, never past the most.
const SPINE_WIDTH = { least: 26, at: 2000, perDoubling: 4, most: 64 };
// Taller the longer its title, never shorter than a book and never capped; a two-line title's longer line is counted at the widest heading face any theme sets, IBM Plex Mono's 7.8px a letter rounded up.
const SPINE_HEIGHT = { base: 70, perLetter: 7.5, perLongLetter: 8, least: 150 };
// The written date stands under the title in the spine's small type, so the spine grows by its letters as well, at a smaller step than a title's; its width stays the book's length.
const SPINE_TAG = { gap: 8, perLetter: 6 };
// A title past this many letters goes on two lines, but only on a spine at least `SPINE_TWO_LINES` thick; a thinner spine stands taller instead.
const SPINE_ONE_LINE = 24;
const SPINE_TWO_LINES = 40;

const escaped = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The words of a drawn fragment, as a reader sees them, to hold a drawn line against its record. */
function words(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The Previous and Next strip the renderer leaves at a document's foot. */
const PAGER = /<nav class="docs-pager[\s\S]*?<\/nav>/;

/** The drawn list read back: its title, its lines under the title, and each bay's heading and the book lines under it. */
function readList(html) {
  const pager = PAGER.exec(html);
  const body = html.replace(PAGER, '').replace(/^\s*<article\b[^>]*>/, '').replace(/<\/article>\s*$/, '');
  const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(body);
  const starts = [...body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)];
  if (!title) throw new Error('shelf.md has no title');
  if (!starts.length) throw new Error('shelf.md has no bays, so there is no shelf to draw');
  const intro = body.slice(title.index + title[0].length, starts[0].index);
  const bays = starts.map((start, at) => {
    const section = body.slice(start.index + start[0].length, at + 1 < starts.length ? starts[at + 1].index : body.length);
    return { name: words(start[1]), lines: [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((line) => line[1]) };
  });
  // The paragraphs after the last bay's list are the shelf's foot, as a copyright line is, and stand under the list rather than inside it.
  const rest = body.slice(starts[0].index);
  const foot = /<\/(?:ul|ol)>((?:\s*<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<\/p>)+)\s*$/.exec(rest);
  const list = foot ? rest.slice(0, foot.index + foot[0].length - foot[1].length) : rest;
  return { title: title[1], paragraphs: intro.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) || [], bays, list, foot: foot ? foot[1].trim() : '', pager: pager ? pager[0] : '' };
}

/** A spine's thickness from its book's words, on a scale where twice the words is the same step wherever it falls. */
export function spineWidth(words) {
  const steps = words > SPINE_WIDTH.at ? Math.log2(words / SPINE_WIDTH.at) : 0;
  return Math.min(SPINE_WIDTH.most, Math.round(SPINE_WIDTH.least + SPINE_WIDTH.perDoubling * steps));
}

/** Every part a book's story touches, as indexes into the story's parts. */
export function reachedParts(book) {
  const reached = new Set();
  for (const segment of book.segments) for (let part = segment.from_part; part <= segment.to_part; part += 1) reached.add(part);
  return reached;
}

/** The year a book was written for standing it in order, or null where nobody knows. */
const writtenYear = (book) => (book.written.from ?? book.written.to ?? null);

/** The bays the shelf stands in for one order, each holding its books in the order they stand. Story order keeps every bay, an empty one saying so; the two dated orders keep only the bays a book stands in, in time. */
export function baysFor(data, order) {
  if (order === 'written' || order === 'printed') {
    const year = order === 'written' ? writtenYear : (book) => (book.printed ? book.printed.from : null);
    const span = order === 'written' ? 100 : 10;
    const groups = new Map();
    for (const book of data.books) {
      const at = year(book);
      const key = at == null ? Infinity : Math.floor(at / span) * span;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(book);
    }
    return [...groups.keys()].sort((a, b) => a - b).map((key) => ({
      name: key === Infinity ? (order === 'written' ? UNDATED : UNPRINTED) : order === 'written' ? `${CENTURY_WORDS[key / 100] || `${key}s`} century` : `The ${key}s`,
      plate: key === Infinity ? (order === 'written' ? UNDATED : UNPRINTED) : order === 'written' ? `${CENTURY_WORDS[key / 100] || `${key}s`} century` : `${key}s`,
      beside: key === Infinity,
      books: groups.get(key).sort((a, b) => (year(a) ?? 0) - (year(b) ?? 0) || data.books.indexOf(a) - data.books.indexOf(b)),
    }));
  }
  return data.bays.map((bay, at) => ({ name: bay.name, plate: bay.plate, beside: !!bay.beside, index: at, books: data.books.filter((book) => book.bay === at) }));
}

/** The letters of the longer line when a title breaks at the space that evens its two lines, so the spine is tall enough that no face wraps it onto a third. */
export function longerLine(title) {
  let best = title.length;
  for (let at = title.indexOf(' '); at !== -1; at = title.indexOf(' ', at + 1)) best = Math.min(best, Math.max(at, title.length - at - 1));
  return best;
}

/** One spine: its tone, whether it is out yet, how long the book is, how long its title is, and when it was written in every order, as its open card says it. */
export function spineMarkup(book, { picked = '' } = {}) {
  const width = spineWidth(book.words || 0);
  const long = book.title.length > SPINE_ONE_LINE && width >= SPINE_TWO_LINES;
  const letters = long ? longerLine(book.title) : book.title.length;
  const tag = book.written.label || '';
  const title = Math.max(SPINE_HEIGHT.least, SPINE_HEIGHT.base + (long ? SPINE_HEIGHT.perLongLetter : SPINE_HEIGHT.perLetter) * letters);
  const height = Math.round(title + (tag ? SPINE_TAG.gap + SPINE_TAG.perLetter * tag.length : 0));
  const classes = ['shelf-spine', book.status === 'planned' ? 'is-planned' : '', long ? 'is-long' : ''].filter(Boolean).join(' ');
  const said = `${book.title}, ${book.author}${book.status === 'planned' ? ', coming' : ''}${tag ? `, ${tag}` : ''}`;
  return [
    `<button type="button" class="${classes}" data-book="${escaped(book.book)}" data-tone="${escaped(book.tone)}" aria-pressed="${book.book === picked ? 'true' : 'false'}" aria-label="${escaped(said)}" style="width:${width}px;height:${height}px;${toneStyle(escaped(book.tone))}">`,
    `<span class="shelf-spine-title">${escaped(book.title)}</span>`,
    tag ? `<span class="shelf-spine-tag">${escaped(tag)}</span>` : '',
    `<span class="shelf-spine-lang">${escaped(book.code)}</span>`,
    '</button>',
  ].join('');
}

/** The cover a picked spine turns to, laid on it only for the length of its turn: its title and its author. */
export function spineCoverMarkup(book) {
  return `<span class="shelf-spine-cover" aria-hidden="true"><span class="shelf-spine-cover-title">${escaped(book.title)}</span><span class="shelf-spine-cover-by">${escaped(book.author)}</span></span>`;
}

/** The shelf's bays for one order, the shelf's first where none is named, with the bays a picked book's story reaches laid under a ledge in its tone. */
export function shelfMarkup(data, { order = firstOrder(data), picked = '', shown = null } = {}) {
  const book = data.books.find((one) => one.book === picked);
  const reached = book && order === 'story' ? reachedParts(book) : new Set();
  const bays = baysFor(data, order).map((bay) => {
    const books = shown ? bay.books.filter((one) => shown.has(one.book)) : bay.books;
    const isReached = bay.index != null && reached.has(bay.index);
    const classes = ['shelf-bay', bay.beside ? 'is-beside' : '', isReached ? 'is-reached' : ''].filter(Boolean).join(' ');
    const tone = isReached ? ` data-tone="${escaped(book.tone)}"` : '';
    const inside = books.length ? `<div class="shelf-books">${books.map((one) => spineMarkup(one, { picked })).join('')}</div>` : '<span class="shelf-empty">No book yet</span>';
    // The case's spare width follows the books, so a bay of four spines takes four shares of it and a bay of one takes one.
    return `<div class="${classes}"${tone} style="flex-grow:${Math.max(1, books.length)}${isReached ? `;${toneStyle(escaped(book.tone))}` : ''}"><span class="shelf-plate">${escaped(bay.plate)}</span>${inside}</div>`;
  });
  return `<div class="shelf-row">${bays.join('')}</div>`;
}

/** What a book's story reaches, in the bays' own words, each broad reach marked so. */
function reachWords(book, data) {
  if (book.beside) return 'Beside the story’s time';
  return book.segments
    .map((segment) => {
      const from = data.bays[segment.from_part].plate;
      const to = data.bays[segment.to_part].plate;
      const span = from === to ? from : `${from} to ${to}`;
      return segment.basis === 'text' ? span : `${span}, broad`;
    })
    .join('; then ');
}

/** The editions a book is read from, the base first and any second reading named as one. */
function editionWords(book) {
  if (!book.editions.length) return { said: 'Not chosen yet', cite: '' };
  const base = book.editions.filter((edition) => edition.base);
  const said = book.editions
    .map((edition) => `${edition.editor}${edition.published ? `, ${edition.published}` : ''}${edition.base ? '' : ', a second reading'}`)
    .filter((line, at, all) => all.indexOf(line) === at)
    .join('; ');
  return { said, cite: base.map((edition) => edition.cite).filter((cite, at, all) => cite && all.indexOf(cite) === at).join(' ') };
}

/** How long a book is, as the shelf says it: its counted words, or about its figure in its unit and about its words; a book measured in something else, as a Chinese text is in characters, says so in `length.measure`. */
function lengthWords(book) {
  if (!book.words) return 'Not measured yet';
  const count = (n) => n.toLocaleString('en-US');
  const length = book.length || {};
  const measure = length.measure || 'words';
  const words = `${count(book.words)} ${measure} of ${book.language}`;
  if (book.basis === 'counted') return words;
  return length.unit && length.unit !== measure ? `about ${count(length.count)} ${length.unit}, about ${words}` : `about ${words}`;
}

/** The book opened off the shelf: its title, author, premise and the way to read it on the left page, and on the right where its story falls, on a shelf that stands books by their story, its language, when it was written, the edition it is read from and how long it is, each with its evidence. */
export function bookMarkup(book, data) {
  if (!book) return '';
  const hasStory = storied(data);
  const reached = reachedParts(book);
  const cells = data.bays.filter((bay) => !bay.beside).map((bay, at) => `<i class="${reached.has(at) ? 'is-on' : ''}" title="${escaped(bay.plate)}"></i>`).join('');
  const story = book.beside ? escaped(book.outsideReason || 'Beside the story’s time') : escaped(reachWords(book, data));
  const storyWhy = (book.segments || []).map((segment) => segment.evidence).filter(Boolean).join(' ');
  const written = book.written.label ? escaped(book.written.label) : 'Not established';
  const writtenWhy = book.written.label ? book.written.evidence : book.written.unknownReason;
  const edition = editionWords(book);
  const read = book.status === 'published'
    ? `<p><a class="leaf-md-button" href="${escaped(book.read)}">Read ${escaped(book.title)}</a></p>`
    : hasStory ? `<p class="shelf-book-coming">Not published yet. <a href="${escaped(book.read)}">See the story it belongs to</a>.</p>` : '<p class="shelf-book-coming">Not published yet.</p>';
  return [
    `<section class="shelf-book" data-tone="${escaped(book.tone)}" data-book="${escaped(book.book)}" style="${toneStyle(escaped(book.tone))}">`,
    // Its cover, in its tone: the language it was written in, its title and who wrote it.
    '<header class="shelf-book-cover">',
    `<span class="shelf-book-code">${escaped(book.code)}</span>`,
    `<h2 class="shelf-book-title">${escaped(book.title)}</h2>`,
    `<p class="shelf-book-by">${escaped(book.author)}</p>`,
    '</header>',
    '<div class="shelf-book-pages">',
    '<div class="shelf-page">',
    `<p class="shelf-book-premise">${escaped(book.premise)}</p>`,
    read,
    '</div>',
    '<div class="shelf-page shelf-page-facts">',
    '<dl class="shelf-facts">',
    hasStory ? `<dt>Story</dt><dd>${book.beside ? '' : `<div class="shelf-parts">${cells}</div>`}${story}${storyWhy ? `<span class="shelf-why">${escaped(storyWhy)}</span>` : ''}</dd>` : '',
    `<dt>Language</dt><dd>${escaped(book.language)}, ${escaped(book.tradition)}</dd>`,
    `<dt>Written</dt><dd>${written}${writtenWhy ? `<span class="shelf-why">${escaped(writtenWhy)}</span>` : ''}</dd>`,
    `<dt>Edition</dt><dd>${escaped(edition.said)}${edition.cite ? `<span class="shelf-why">${escaped(edition.cite)}</span>` : ''}</dd>`,
    `<dt>Length</dt><dd>${escaped(lengthWords(book))}${book.length && book.length.evidence ? `<span class="shelf-why">${escaped(book.length.evidence)}</span>` : ''}</dd>`,
    '</dl>',
    '</div>',
    '</div>',
    '</section>',
  ].join('');
}

/** The switch between the shelf's orders, the chosen one pressed, and the chosen order's note; a shelf of one order has only the note to say. */
export function sortMarkup(order, data = null) {
  const orders = shelfWords(data).orders;
  const buttons = orders.length > 1 ? orders.map((one) => `<button type="button" class="shelf-sort-button" data-shelf-order="${one.key}" aria-pressed="${one.key === order ? 'true' : 'false'}">${escaped(one.label)}</button>`).join('') : '';
  const note = (orders.find((one) => one.key === order) || orders[0]).note || '';
  return `${buttons ? `<div class="shelf-sort" role="group" aria-label="Sort the shelf">${buttons}</div>` : ''}<p class="shelf-sort-note">${escaped(note)}</p>`;
}

/** Search by title and the filters the shelf offers: the part a book's story touches, where the shelf has a story, its tone under the shelf's own name for one, and whether it is out yet. */
function findMarkup(data) {
  const words = shelfWords(data);
  const parts = data.bays.filter((bay) => !bay.beside).map((bay, at) => `<option value="${at}">${escaped(bay.plate)}</option>`).join('');
  const tones = words.tones.map(([key, name]) => `<option value="${key}">${escaped(name)}</option>`).join('');
  const field = (key, label, options) => `<label class="leaf-select shelf-filter-field"><select class="shelf-filter" data-shelf-filter="${key}" aria-label="${escaped(label)}">${options}</select><span class="lt-icon lt-icon-chevron-down" aria-hidden="true"></span></label>`;
  return [
    '<div class="shelf-find" role="search">',
    '<input type="search" class="shelf-search" placeholder="Find a book by its title" aria-label="Find a book by its title">',
    words.filters.includes('part') && storied(data) ? field('part', 'Part of the story', `<option value="">Every part of the story</option>${parts}`) : '',
    words.filters.includes('tone') ? field('tone', words.toneLabel, `<option value="">Every ${escaped(words.toneLabel.toLowerCase())}</option>${tones}`) : '',
    words.filters.includes('status') ? field('status', 'Out yet', '<option value="">On the shelf and coming</option><option value="published">On the shelf</option><option value="planned">Coming</option>') : '',
    '</div>',
  ].join('');
}

/** The key over the shelf, read before the first spine: a swatch for each of the shelf's tones, the outline a book still to come stands as, and what a spine's thickness says. */
function keyMarkup(data) {
  const tones = shelfWords(data).tones.map(([key, name]) => `<span data-tone="${escaped(key)}" style="${toneStyle(escaped(key))}"><i></i>${escaped(name)}</span>`).join('');
  return `<div class="shelf-key">${tones}<span><i class="is-planned"></i>Coming</span><span>A thicker spine is a longer book.</span></div>`;
}

/**
 * `index.md` as the renderer drew it, laid out as the shelf in its first order with no book picked.
 *
 * Refused — so the host draws the list plain — where the drawn list has no bays, has a different number of books from its data, or names a book its data holds a different title for at that place: a shelf drawn from a list it does not match would send a reader to the wrong book.
 */
export function layoutShelf(html, data) {
  if (!data || !Array.isArray(data.books) || !Array.isArray(data.bays)) throw new Error('the shelf has no data to stand its books by');
  const list = readList(html);
  if (list.bays.length !== data.bays.length) throw new Error(`shelf.md has ${list.bays.length} bays where its data has ${data.bays.length}`);
  const lines = list.bays.flatMap((bay) => bay.lines);
  if (lines.length !== data.books.length) throw new Error(`shelf.md lists ${lines.length} books where its data has ${data.books.length}`);
  lines.forEach((line, at) => {
    const link = /<a\b[^>]*>([\s\S]*?)<\/a>/.exec(line);
    const said = words(link ? link[1] : line);
    const book = data.books[at];
    if (said !== words(escaped(book.title))) throw new Error(`shelf.md's line ${at + 1} names ${said} where its data has ${book.title}`);
  });
  const [line] = list.paragraphs;
  // The credit is its own paragraph so a sort, which rewrites the line as plain text, never reaches its link.
  const credit = SHELF_CREDIT.test(list.paragraphs[1] || '') ? list.paragraphs[1] : '';
  const own = shelfWords(data);
  const order = firstOrder(data);
  return [
    `<article class="document-body ${SHELF_LAYOUT_CLASS}" data-shelf-order="${escaped(order)}">`,
    '<section class="shelf-hero">',
    `<p class="shelf-eyebrow">${escaped(own.name)}</p>`,
    `<h1 class="shelf-title">${list.title}</h1>`,
    line ? line.replace(/^<p\b[^>]*>/, '<p class="shelf-line">') : '',
    credit.replace(/^<p\b[^>]*>/, '<p class="shelf-credit">'),
    '</section>',
    sortMarkup(order, data),
    findMarkup(data),
    keyMarkup(data),
    `<div class="shelf-case">${shelfMarkup(data, { order })}</div>`,
    `<details class="shelf-list"><summary>Every book as a list</summary>${list.paragraphs.slice(credit ? 2 : 1).join('')}${list.list}</details>`,
    list.foot,
    list.pager,
    '</article>',
  ].join('\n');
}
