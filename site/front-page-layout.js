// front-page-layout.js
// ---------------------------------------------------------------------------

import { dottedLeafMarkup } from './dotted-leaf.js';
// The front page's composition. The README stays the one source of words and stays a plain document on GitHub; this lays its drawn HTML out as a marketing page — a hero with the downloads, the comparison chart, one picture of the app, five feature cards, the first spanning the grid, one install line and the links at the foot — and leaves every other section to the documentation, where each one already has a page.
//
// Two callers, one layout: `bakeSite` in `scripts/site-assets.mjs` bakes it into the first response, and `web/preview/boot.js` hands it to the host, which lays the landing out when the app's page draws it into the reading column. The bake has no DOM, so everything here works on the renderer's HTML as text, the same way `compare-chart.js` does.
// ---------------------------------------------------------------------------

/** The README heading the hero is drawn from. */
export const HERO_ID = 'refine-your-mind';

/** The README heading the comparison is drawn under. */
export const COMPARE_ID = 'how-leaftext-compares';

/** The README heading the three principles under the hero are read from: a list of `**Name.** One line.` items. */
export const PRINCIPLES_ID = 'what-it-stands-for';

/** The README heading the running-in-your-browser panel is read from: one paragraph saying the whole app opens in the tab. */
export const RUNNING_ID = 'running-in-your-browser';

/** The README heading every feature is listed under as an app, Equin's apps grid in Leaftext's words: a line, then `[Name](page) — one line` items. */
export const APPS_ID = 'everything-in-it';

/** A book to open in the app from the panel: Malory, with its glossary beside it. */
export const SAMPLE_BOOK = 'docs/08-examples/le-morte-darthur/le-morte-darthur.epub';

/** The README heading the install line is read from. */
export const INSTALL_ID = 'install-it';

/** Where the recorded clips and their posters are published: `<clip>.webm` and `<clip>.jpg`, written by `scripts/record-site-demo.mjs`. */
export const DEMO_DIR = 'imgs/demos';

/** The six cards, in order — the harness, the bot, then the reader, on the owner's word of 14 November 2026, 4:30pm: the README section each is read from and titled by, the clip that shows it, what that clip shows in words, the documentation page that tells the rest, and whether it is a featured card that spans the grid with its clip beside its words. */
export const FRONT_CARDS = [
  { section: 'run-your-agents-as-a-team', clip: 'agents', featured: true, shows: 'A Claude Code console answering another agent that asked it, over the intercom between consoles, how to make a README easy to scan', more: 'docs/01-features/10-agents.md' },
  { section: 'your-own-bot', clip: 'wisp', shows: 'The wisp asked in its chat what is still open on a plan, and listing the two items left', more: 'docs/01-features/05-settings.md#your-wisp' },
  { section: 'read-your-files', clip: 'read', shows: 'Leaftext opening a Markdown page, a sitemap, a saved email, a JSON file and a TOML file, each drawn as a page to read', more: 'docs/01-features/01-rendering.md' },
  { section: 'write-where-you-read', clip: 'edit', shows: 'A sentence being typed straight into the rendered page of a note', more: 'docs/01-features/07-editing.md' },
  { section: 'keep-a-library', clip: 'library', shows: 'The documentation index opening into the graph of how its pages link', more: 'docs/01-features/03-library.md' },
  { section: 'your-thoughts-stay-yours', clip: 'own', featured: true, shows: 'One page drawn in six themes in turn, the file never leaving the machine', more: 'docs/01-introduction.md' },
];

/** The clip in the hero, beside its words: the product is the picture. It shows the whole window, a page read beside a console whose agent asks another over the intercom. */
export const HERO_CLIP = 'hero-agents';
export const HERO_SHOWS = 'The Leaftext window with the README open beside a Claude Code console that asks the agent in another console, over the intercom, what makes a README easy to scan, and quotes its answer';

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
  const starts = [...body.matchAll(/<h2 id="([^"]*)"[^>]*>/g)];
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

/** The mark the app's page puts on a heading or paragraph it has proved the source of, so the words a visitor can type on are only the ones this layout keeps whole. Taken off the chart, whose words are another document's, and off the Previous and Next strip. */
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

/** Where Try the app takes a visitor: a page of the app's own documentation, drawn with the whole app around it, on the owner's word of 18 November 2026, 5:26pm that the front page be a marketing page and the app a demo you are taken to. */
export const APP_DEMO = 'docs/03-quickstart.md';

/** The front page's own bar, standing where the app's bar stands on every other page: the leaf and the name, the page's own parts, the documentation, the app and the downloads. */
function navOf() {
  return `<nav class="front-nav" aria-label="Leaftext"><a class="front-nav-brand" href="#download"><span class="lt-icon lt-icon-leaf" aria-hidden="true"></span>leaftext</a><span class="front-nav-links"><a href="#features">Apps</a><a href="#${COMPARE_ID}">Compare</a><a href="docs/">Docs</a></span><a class="front-nav-try" href="${APP_DEMO}">Try the app →</a><a class="front-nav-get" href="#download">Download</a></nav>`;
}

/** The hero: one band holding the title, the one line under it, the downloads and the small print beside them, and the app recorded beside those words. */
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
  // The title's last word is lit with the theme's gradient, the way Equin lights the end of its headline; the words are the README's, only wrapped.
  const heading = title[0].replace(/^<h1\b/, '<h1 class="front-hero-title"').replace(/([^\s<>]+)(\s*<\/h1>)$/, '<span class="front-hero-accent">$1</span>$2');
  // The clip sits between the line and the downloads in the source order, so a narrow page keeps the downloads directly over the chart; a wide one moves it beside the words.
  return `<section class="front-hero" id="download"><div class="front-hero-words">${dottedLeafMarkup('front')}${heading}${classed(line, 'front-hero-line')}</div>${clipBox(HERO_CLIP, HERO_SHOWS, 'front-hero-clip')}<div class="front-hero-get">${classed(said[downloads], 'front-downloads')}${classed(small, 'front-small')}</div></section>`;
}

/** The principles under the hero, Equin's three cards in Leaftext's words: the README section's list, each item a card whose bold opening is its name. Refused where the section has no list of named items. */
function principlesOf(section) {
  const list = /<ul\b[^>]*>([\s\S]*?)<\/ul>/.exec(section);
  const items = list ? list[1].match(/<li\b[^>]*>[\s\S]*?<\/li>/g) || [] : [];
  if (!items.length || items.some((item) => !/<strong>/.test(item))) throw new Error(`the README's "${PRINCIPLES_ID}" section has no list of named principles for the front page`);
  const cards = items.map((item) => item.replace(/^<li\b/, '<li class="front-principle"').replace('<strong>', '<strong class="front-principle-name">')).join('');
  return `<ul class="front-principles" aria-label="What Leaftext stands for">${cards}</ul>`;
}

/** The running-in-your-browser panel, Equin's demo panel in Leaftext's words: the section's heading and its first paragraph, then Try the app, a book and the docs as buttons. The app it opens is already loaded, so it starts at once. */
function runningOf(section) {
  const heading = /^<h2\b[^>]*>[\s\S]*?<\/h2>/.exec(section);
  const said = paragraphs(section)[0];
  if (!heading || !said) throw new Error(`the README's "${RUNNING_ID}" section has no line for the running-in-your-browser panel`);
  // The line loses its own Try the app link to the buttons, so it is no longer the README's paragraph byte for byte and is not offered for typing.
  const line = unproved(classed(said.replace(/\s*<strong><a\b[^>]*>[^<]*<\/a><\/strong>\s*/, ' ').replace(/\s+<\/p>$/, '</p>'), 'front-running-line'));
  const buttons = `<p class="front-running-go"><a class="front-running-try" href="${APP_DEMO}">Try the app →</a><a href="${SAMPLE_BOOK}">Open a book</a><a href="docs/">Read the docs</a></p>`;
  return `<section class="front-running" id="${RUNNING_ID}">${heading[0].replace(/^<h2\b/, '<h2 class="front-running-title"')}${line}${buttons}</section>`;
}

/** Every feature as an app, Equin's grid: the section's heading and its line over the six recorded apps as tiles (`cards`, already drawn), then every app the README lists as a chip with its mark, each opening its page in the app. Refused where the list names no app with a page. */
function appsOf(section, cards) {
  const heading = /^<h2\b[^>]*>[\s\S]*?<\/h2>/.exec(section);
  const said = paragraphs(section)[0];
  const list = /<ul\b[^>]*>([\s\S]*?)<\/ul>/.exec(section);
  const items = list ? list[1].match(/<li\b[^>]*>[\s\S]*?<\/li>/g) || [] : [];
  const apps = items.map((item) => /<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*(?:—|&mdash;)?\s*([\s\S]*?)<\/li>$/.exec(item)).filter(Boolean);
  if (!heading || !apps.length || apps.length !== items.length) throw new Error(`the README's "${APPS_ID}" section lists no apps, each a link to its page, for the front page`);
  const chips = apps.map(([, href, name, line]) => `<li class="front-app"><a href="${href}" title="${line.replace(/<[^>]*>/g, '').replace(/"/g, '&quot;').trim()}"><span class="front-app-mark" aria-hidden="true"></span>${name}</a></li>`).join('');
  const lead = said ? unproved(classed(said, 'front-apps-line')) : '';
  return `<section class="front-apps-section" id="features">${unproved(heading[0].replace(/^<h2\b/, '<h2 class="front-apps-title"'))}${lead}<section class="front-cards">${cards}</section><ul class="front-apps" aria-label="Every app in Leaftext">${chips}</ul></section>`;
}

/** The two closing cards, Equin's support and feedback cards in Leaftext's words: Get Leaftext — the README's install line over both downloads again — and Tell us what to build, which opens an issue on the repository the README's foot links. */
function closingOf(intro, installLine) {
  const said = paragraphs(intro);
  const downloads = said.find(isDownloads);
  const repository = /href="(https:\/\/github\.com\/[^/"]+\/[^/"#?]+)\/?"/.exec(said.join(''));
  if (!downloads || !repository) throw new Error('the README carries no downloads or no repository link for the closing cards');
  const get = `<section class="front-install" id="${INSTALL_ID}"><h3 class="front-closing-title">Get Leaftext</h3>${installLine}${unproved(classed(downloads, 'front-downloads'))}</section>`;
  const tell = `<section class="front-feedback"><h3 class="front-closing-title">Tell us what to build</h3><p>Send a bug or a wish on GitHub, or read how every part of it works.</p><p class="front-closing-go"><a href="${repository[1]}/issues/new">Open an issue</a><a href="docs/">Read the docs</a></p></section>`;
  return `<section class="front-closing">${get}${tell}</section>`;
}

/** The links at the foot: the paragraph above the first section that points into the documentation. */
function footOf(intro) {
  const links = paragraphs(intro).find(isFoot);
  if (!links) throw new Error('the README carries no line of links into the documentation for the front page to end on');
  return `<footer class="front-foot">${classed(links, 'front-foot-line')}</footer>`;
}

/** The comparison: its heading, its one line and the chart drawn under it, without the prose the README carries after. */
function compareOf(section) {
  const chart = /<section class="compare-chart">[\s\S]*?<\/section>/.exec(section);
  if (!chart) throw new Error('the README was handed over without its comparison chart, so the front page would open on no comparison');
  return `<section class="front-compare">${section.slice(0, chart.index)}${unproved(chart[0])}</section>`;
}

/** One card: the section's own heading and lead, its picture and where to read the rest. The heading stays an h2 with its id and its mark, so a visitor types on the README's words and a typed title is written back at its own level. */
function cardOf(card, section) {
  const heading = /^<h2\b[^>]*>[\s\S]*?<\/h2>/.exec(section);
  const lead = leadOf(section);
  if (!lead.length) throw new Error(`the README's "${card.section}" section has no lead paragraph for its card`);
  const featured = card.featured ? ' is-featured' : '';
  // Each card is an app tile, its clip carrying Equin's "Try it live" into the app's page for it.
  const clip = clipBox(card.clip, card.shows, card.featured ? 'front-card-clip is-beside' : 'front-card-clip').replace(/<\/figure>$/, `<a class="front-card-try" href="${card.more}">&#9654;&#xFE0E; Try it live</a></figure>`);
  return `<article class="front-card${featured}" data-clip-card="${card.clip}">${heading[0].replace(/^<h2\b/, '<h2 class="front-card-title"')}${lead.join('')}${clip}<p class="front-more"><a href="${card.more}">More →</a></p></article>`;
}

/**
 * Where a paragraph a visitor typed on would be laid out now, by the same rules the layout places it by: the one layout class of `classes` it wears, which a paragraph drawn again alone has to wear too — the empty string for the install line, which wears none — or `null` where `html`, its new words, would stand somewhere else, so the whole page has to be laid out again. A promise gaining a picture, the download buttons or a link into the documentation, a card lead gaining a picture, downloads losing their buttons, small print losing the installation guide and a foot losing its link into the documentation each move, and so does any of those three gaining the foot's link, since the first line carrying it is the foot.
 */
export function paragraphPlace(classes, html) {
  const worn = Array.from(classes || []);
  if (worn.includes('front-hero-line')) return holdsPicture(html) || isDownloads(html) || isFoot(html) ? null : 'front-hero-line';
  if (worn.includes('front-card-lead')) return holdsPicture(html) ? null : 'front-card-lead';
  if (worn.includes('front-downloads')) return isDownloads(html) && !isFoot(html) ? 'front-downloads' : null;
  if (worn.includes('front-small')) return html.includes(`href="${INSTALL_GUIDE}`) && !isFoot(html) ? 'front-small' : null;
  if (worn.includes('front-foot-line')) return isFoot(html) ? 'front-foot-line' : null;
  return '';
}

/**
 * The README's section headings with the ids the layout finds its parts by held where they were, so a visitor typing a word into the comparison heading or a card title does not rename the section out from under the layout. `held` is the list this answered last time, or nothing; a README with a different number of sections starts the list again. Only the ids the layout reads are held, and each stays on the heading at its own place in the README.
 */
export function holdLaidOutIds(html, held) {
  const laidOut = new Set([COMPARE_ID, INSTALL_ID, PRINCIPLES_ID, RUNNING_ID, APPS_ID, ...FRONT_CARDS.map((card) => card.section)]);
  const ids = [...html.matchAll(/<h2 id="([^"]*)"/g)].map((found) => found[1]);
  if (!held || held.length !== ids.length) return { html, ids };
  let at = 0;
  const steady = html.replace(/<h2 id="([^"]*)"/g, (tag, id) => {
    const was = held[at++];
    return id !== was && laidOut.has(was) && !ids.includes(was) ? `<h2 id="${was}"` : tag;
  });
  return { html: steady, ids: held };
}

/**
 * The README drawn as the front page: the hero with the app recorded beside its words and the downloads, the comparison, the six cards, the install line and the foot, then the Previous and Next strip so Next walks on into the documentation.
 *
 * `html` is the README as the renderer drew it with the comparison chart already under its heading. What this leaves out — the outline's headings, the Mac warning and the long account of every feature — is each on its own documentation page, which the cards and the foot link to.
 */
export function layoutFrontPage(html) {
  const { body, pager } = inner(html);
  const all = sections(body);
  const intro = all.get('');
  // Read in the order the page stands in, so a README missing a part is told about the first one a visitor would miss.
  const principles = principlesOf(sectionOf(all, PRINCIPLES_ID));
  const running = runningOf(sectionOf(all, RUNNING_ID));
  const appsSection = sectionOf(all, APPS_ID);
  const install = sectionOf(all, INSTALL_ID);
  const installLine = paragraphs(install)[0];
  if (!installLine) throw new Error('the README says nothing under its install heading');
  const cards = FRONT_CARDS.map((card) => cardOf(card, sectionOf(all, card.section))).join('');
  const apps = appsOf(appsSection, cards);
  return [
    `<article class="document-body ${FRONT_LAYOUT_CLASS}">`,
    navOf(),
    heroOf(intro),
    principles,
    running,
    apps,
    compareOf(sectionOf(all, COMPARE_ID)),
    closingOf(intro, installLine),
    footOf(intro),
    unproved(pager),
    '</article>',
  ].join('\n');
}
