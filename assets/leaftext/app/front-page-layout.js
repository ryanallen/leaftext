// front-page-layout.js
// ---------------------------------------------------------------------------
// The front page's composition. The README stays the one source of words and stays a plain document on GitHub; this lays its drawn HTML out as a marketing page — a hero with the downloads, the comparison chart, one picture of the app, four feature cards, one install line and the links at the foot — and leaves every other section to the documentation, where each one already has a page.
//
// Two callers, one layout: `bakeSite` in `scripts/site-assets.mjs` bakes it into the first response, and `web/preview/boot.js` hands it to the host, which lays the landing out when the app's page draws it into the reading column. The bake has no DOM, so everything here works on the renderer's HTML as text, the same way `compare-chart.js` does.
// ---------------------------------------------------------------------------

/** The README heading the hero is drawn from. */
export const HERO_ID = 'refine-your-mind';

/** The README heading the comparison is drawn under. */
export const COMPARE_ID = 'how-leaftext-compares';

/** The README heading the install line is read from. */
export const INSTALL_ID = 'install-it';

/** Where the recorded clips and their posters are published: `<clip>.webm` and `<clip>.jpg`, written by `scripts/record-site-demo.mjs`. */
export const DEMO_DIR = 'imgs/demos';

/** The four cards, in order: the README section each is read from, the promise it makes, the clip that shows it, what that clip shows in words, and the documentation page that tells the rest. */
export const FRONT_CARDS = [
  { section: 'read-your-files', title: 'Read almost anything', clip: 'read', shows: 'Leaftext opening a Markdown page, a sitemap, a saved email, a JSON file and a TOML file, each drawn as a page to read', more: 'docs/01-features/01-rendering.md' },
  { section: 'write-where-you-read', title: 'Edit the rendered page', clip: 'edit', shows: 'A sentence being typed straight into the rendered page of a note', more: 'docs/01-features/07-editing.md' },
  { section: 'keep-a-library', title: 'See the whole library', clip: 'library', shows: 'The documentation index opening into the graph of how its pages link', more: 'docs/01-features/03-library.md' },
  { section: 'your-thoughts-stay-yours', title: 'Keep it yours', clip: 'own', shows: 'One page drawn in six themes in turn, the file never leaving the machine', more: 'docs/01-introduction.md' },
];

/** The clip beside the comparison, which shows the whole window reading, and what it shows in words. */
export const HERO_CLIP = 'hero';
export const HERO_SHOWS = 'The Leaftext window scrolling through a long document, its outline in the pane at left and the minimap down the right edge';

/** The class the laid-out page carries, which is how a reader tells it from a README drawn plain. */
export const FRONT_LAYOUT_CLASS = 'front-layout';

/** The Previous and Next strip the renderer leaves waiting at a document's foot, which the page fills once it is drawn. */
const PAGER = /<nav class="docs-pager[\s\S]*?<\/nav>/;

/** A drawn document without the article around it and without its Previous and Next strip, and that strip on its own. */
function inner(html) {
  const pager = PAGER.exec(html);
  const body = html
    .replace(PAGER, '')
    .replace(/^\s*<article\b[^>]*>/, '')
    .replace(/<\/article>\s*$/, '');
  return { body, pager: pager ? pager[0] : '' };
}

/** The drawn README cut at every `h2`: the part above the first one, then each section by its id. */
function sections(body) {
  const found = new Map();
  const starts = [...body.matchAll(/<h2 id="([^"]*)">/g)];
  found.set('', body.slice(0, starts.length ? starts[0].index : body.length));
  starts.forEach((start, at) => found.set(start[1], body.slice(start.index, at + 1 < starts.length ? starts[at + 1].index : body.length)));
  return found;
}

/** The section a heading id names, refused where the README no longer carries it so a renamed heading stops the publish rather than dropping a card in silence. */
function sectionOf(all, id) {
  const found = all.get(id);
  if (!found) throw new Error(`the README has no section with the id "${id}" for the front page to lay out`);
  return found;
}

/** Every top-level paragraph in a stretch of HTML, with whatever attributes the page drawing it put on it. */
const paragraphs = (html) => html.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || [];

/** A paragraph wearing one of the layout's classes, every attribute it came with kept. */
const classed = (p, name) => p.replace(/^<p\b/, `<p class="${name}"`);

/** The mark the app's page puts on a heading or paragraph it has proved the source of, so the words a visitor can type on are only the ones this layout keeps whole. Taken off everything the layout keeps without offering it for typing. */
const unproved = (html) => html.replace(/\sdata-leaf-proof="[^"]*"/g, '');

/** What places a paragraph on the page: a picture keeps a paragraph off a card and out of the promise, the download buttons are the downloads, and a link into the documentation is the foot. */
const holdsPicture = (p) => /<img\b/.test(p);
const isDownloads = (p) => p.includes('leaf-md-button');
const isFoot = (p) => p.includes('href="docs/"');

/** The paragraphs under a section's heading and above its first subheading. */
function leadOf(section) {
  const top = section.replace(/^<h2\b[^>]*>[\s\S]*?<\/h2>/, '');
  const cut = top.search(/<h3\b/);
  return paragraphs(cut < 0 ? top : top.slice(0, cut))
    .filter((p) => !holdsPicture(p))
    .map((p) => classed(p, 'front-card-lead'));
}

/** The box a clip plays in, holding its poster: the first frame, which is what the first response and a crawler carry, and all a reader who asked for less motion is ever shown. `site/front-page.js` puts the clip in its place as the box nears the window. */
function clipBox(clip, shows, className) {
  return `<figure class="${className} front-clip" data-clip="${clip}"><img class="front-clip-media" src="${DEMO_DIR}/${clip}.jpg" alt="${shows.replace(/"/g, '&quot;')}" loading="lazy" decoding="async"></figure>`;
}

/** The installation guide, which the hero's small print links. */
export const INSTALL_GUIDE = 'docs/02-installation.md';

/** The hero: the title, the one line under it, the downloads and the small print beside them. */
function heroOf(intro) {
  const title = /<h1\b[^>]*>[\s\S]*?<\/h1>/.exec(intro);
  if (!title) throw new Error('the README has no title for the front page to open on');
  const said = paragraphs(intro);
  const line = said[0];
  const downloads = said.findIndex(isDownloads);
  if (!line || holdsPicture(line) || downloads < 0) throw new Error('the README opens on no one-line promise and no download buttons for the hero');
  const small = said[downloads + 1] || '';
  // The one link beside the buttons is the install guide, which the Mac's first launch needs.
  if (!small.includes(`href="${INSTALL_GUIDE}`)) throw new Error('the small print under the download buttons in the README no longer links the installation guide');
  const heading = title[0].replace(/^<h1\b/, '<h1 class="front-hero-title"');
  return `<section class="front-hero" id="download">${heading}${classed(line, 'front-hero-line')}${unproved(classed(said[downloads], 'front-downloads'))}${unproved(classed(small, 'front-small'))}</section>`;
}

/** The links at the foot: the paragraph above the first section that points into the documentation. */
function footOf(intro) {
  const links = paragraphs(intro).find(isFoot);
  if (!links) throw new Error('the README carries no line of links into the documentation for the front page to end on');
  return `<footer class="front-foot">${unproved(links)}</footer>`;
}

/** The comparison: its heading, its one line and the chart drawn under it, without the prose the README carries after. */
function compareOf(section) {
  const chart = /<section class="compare-chart">[\s\S]*?<\/section>/.exec(section);
  if (!chart) throw new Error('the README was handed over without its comparison chart, so the front page would open on no comparison');
  return `<section class="front-compare">${unproved(section.slice(0, chart.index + chart[0].length))}</section>`;
}

/** One card: the promise, the section's own lead, its picture and where to read the rest. */
function cardOf(card, section) {
  const lead = leadOf(section);
  if (!lead.length) throw new Error(`the README's "${card.section}" section has no lead paragraph for its card`);
  return `<article class="front-card" data-clip-card="${card.clip}"><h3 class="front-card-title" id="${card.section}">${card.title}</h3>${lead.join('')}${clipBox(card.clip, card.shows, 'front-card-clip')}<p class="front-more"><a href="${card.more}">More →</a></p></article>`;
}

/**
 * Where a paragraph a visitor typed on would be laid out now, by the same rules the layout places it by: the one layout class of `classes` it wears, which a paragraph drawn again alone has to wear too — the empty string for the install line, which wears none — or `null` where `html`, its new words, would stand somewhere else, so the whole page has to be laid out again. A promise gaining a picture, the download buttons or a link into the documentation, and a card lead gaining a picture, each move.
 */
export function paragraphPlace(classes, html) {
  const worn = Array.from(classes || []);
  if (worn.includes('front-hero-line')) return holdsPicture(html) || isDownloads(html) || isFoot(html) ? null : 'front-hero-line';
  if (worn.includes('front-card-lead')) return holdsPicture(html) ? null : 'front-card-lead';
  return '';
}

/**
 * The README drawn as the front page: hero and downloads, the comparison, the app, the four cards, the install line and the foot, then the Previous and Next strip so Next walks on into the documentation.
 *
 * `html` is the README as the renderer drew it with the comparison chart already under its heading. What this leaves out — the outline's headings, the Mac warning and the long account of every feature — is each on its own documentation page, which the cards and the foot link to.
 */
export function layoutFrontPage(html) {
  const { body, pager } = inner(html);
  const all = sections(body);
  const intro = all.get('');
  const install = sectionOf(all, INSTALL_ID);
  const installLine = paragraphs(install)[0];
  if (!installLine) throw new Error('the README says nothing under its install heading');
  const cards = FRONT_CARDS.map((card) => cardOf(card, sectionOf(all, card.section))).join('');
  return [
    `<article class="document-body ${FRONT_LAYOUT_CLASS}">`,
    heroOf(intro),
    compareOf(sectionOf(all, COMPARE_ID)),
    `<section class="front-demo">${clipBox(HERO_CLIP, HERO_SHOWS, 'front-demo-clip')}</section>`,
    `<section class="front-cards" id="features">${cards}</section>`,
    `<section class="front-install" id="${INSTALL_ID}">${installLine}</section>`,
    footOf(intro),
    unproved(pager),
    '</article>',
  ].join('\n');
}
