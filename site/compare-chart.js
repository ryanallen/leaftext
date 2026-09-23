// compare-chart.js
// ---------------------------------------------------------------------------
// The comparison chart on the front page. The chart's words live once, in the documentation — `docs/05-compare.md` says how to read it and lists its subject pages under `## The chart` — and this draws those same pages into the README at the heading that asks for them, so the front page and the docs route can never disagree.
//
// Three callers, one drawing: the publish bakes the chart into the first response (`scripts/site-assets.mjs`), `reader.js` draws it on a page nobody baked, and `docs/docs.js` draws it on the compare page in place of that page's list of subject pages. The bake has no DOM, so everything here works on the renderer's HTML as text; that HTML is the app's own and regular, which is what makes a text pass safe.
//
// What it draws, in order: the legend, a short open matrix of every row whose name the pages write in bold, then one folded `<details>` per subject page holding every row. A group is a table with its name as the caption rather than a heading, so the page's outline stays the README's own and does not grow a line per group.
// ---------------------------------------------------------------------------

/** The page that explains the chart and lists its subject pages. */
export const COMPARE_INDEX = 'docs/05-compare.md';

/** The id the renderer gives the README heading the chart is drawn under. */
export const COMPARE_SEAM_ID = 'how-leaftext-compares';

/** A path spelled from the top of the site, with `.` and `..` resolved against the file it was written in. */
function resolvePath(href, fromPath) {
  const base = new URL(fromPath, 'https://leaftext.invalid/');
  const url = new URL(href, base);
  return decodeURI(url.pathname.slice(1)) + url.search + url.hash;
}

/** The subject pages `## The chart` lists, in order, spelled from the top of the site. */
export function chartPagePaths(indexMarkdown, indexPath = COMPARE_INDEX) {
  const text = indexMarkdown.replace(/\r\n/g, '\n');
  const section = /^## The chart\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
  if (!section) return [];
  return [...section[1].matchAll(/^\d+\.\s+\[[^\]]+\]\(([^)\s]+\.md)\)/gm)].map((m) => resolvePath(m[1], indexPath));
}

/** Every relative link in a drawn page made to work from the top of the site, the way the README spells its own. */
function relink(html, fromPath) {
  return html.replace(/href="([^"]*)"/g, (whole, href) => {
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return whole;
    return `href="${resolvePath(href, fromPath)}"`;
  });
}

/** A drawn document without the article around it and without the Previous and Next strip the renderer leaves waiting at its foot. */
function inner(html) {
  return html
    .replace(/<nav class="docs-pager[\s\S]*?<\/nav>/, '')
    .replace(/^\s*<article\b[^>]*>/, '')
    .replace(/<\/article>\s*$/, '');
}

const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** One subject page read into what the chart draws of it. */
function readPage({ path, html }) {
  const body = relink(inner(html), path);
  const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(body);
  const subtitle = /<blockquote>\s*<p>([\s\S]*?)<\/p>\s*<\/blockquote>/.exec(body);
  if (!title || !subtitle) throw new Error(`${path} has no title and one-line subtitle to name its group by`);
  const rest = body.slice(subtitle.index + subtitle[0].length);
  // Each group's heading becomes its table's caption, and its id moves onto the table with a prefix, so no group can take an address the README already uses.
  const tables = rest.replace(/<h2 id="([^"]*)">([\s\S]*?)<\/h2>\s*<table>/g, (_, id, name) => `<table id="compare-${id}"><caption>${name}</caption>`);
  const rows = (tables.match(/<tr><td/g) || []).length;
  const glance = tables.match(/<tr><td[^>]*><strong>[\s\S]*?<\/tr>/g) || [];
  const head = /<thead>[\s\S]*?<\/thead>/.exec(tables);
  return { title: plain(title[1]), subtitle: plain(subtitle[1]), tables, rows, glance, head: head ? head[0] : '' };
}

/** The legend the docs page gives the chart: its paragraphs between `## The chart` and the list of pages. */
function legendOf(indexHtml) {
  const found = /<h2 id="the-chart">[\s\S]*?<\/h2>([\s\S]*?)<ol>/.exec(indexHtml);
  if (!found) throw new Error(`${COMPARE_INDEX} has no legend under its chart heading`);
  return relink(found[1].trim(), COMPARE_INDEX);
}

const count = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'feature' : 'features'}`;

/**
 * The whole chart as one section of HTML: the legend, the short matrix open, and a folded group per subject page.
 *
 * `indexHtml` is `COMPARE_INDEX` drawn by the renderer, and `pages` the subject pages it lists, in its order, each `{ path, html }`.
 */
export function drawCompareChart(indexHtml, pages) {
  return `<section class="compare-chart">${legendOf(indexHtml)}\n${drawMatrix(pages)}\n</section>`;
}

/** The short matrix open and a folded group per subject page, without the legend. */
function drawMatrix(pages) {
  if (!pages.length) throw new Error(`${COMPARE_INDEX} lists no chart pages to draw`);
  const read = pages.map(readPage);
  const glance = read.flatMap((page) => page.glance);
  if (!glance.length) throw new Error('no chart row is bold, so there is no short matrix to open on');
  const head = read[0].head.replace(/<th>[\s\S]*?<\/th>/, '<th>At a glance</th>');
  const groups = read
    .map(
      (page) =>
        `<details class="compare-group"><summary><strong class="compare-group-title">${page.title}</strong> — <span class="compare-group-subtitle">${page.subtitle}</span> · <span class="compare-group-count">${count(page.rows)}</span></summary>${page.tables}</details>`
    )
    .join('\n');
  return `<table class="compare-glance">${head}<tbody>\n${glance.join('\n')}\n</tbody></table>\n${groups}`;
}

/** The compare page drawn with the chart in place of its list of subject pages, under the legend it already carries. `pages` are spelled from the docs folder, so every link in them stays a docs route. */
export function compareIndexWithChart(indexHtml, pages) {
  const list = /(<h2 id="the-chart">[\s\S]*?)<ol>[\s\S]*?<\/ol>/.exec(indexHtml);
  if (!list) throw new Error(`${COMPARE_INDEX} has no list of chart pages under its chart heading`);
  const at = list.index + list[1].length;
  return indexHtml.slice(0, at) + `<section class="compare-chart">${drawMatrix(pages)}</section>` + indexHtml.slice(list.index + list[0].length);
}

/** The README drawn with the chart after the paragraph under its compare heading. Refuses a README that no longer asks for it, so a renamed heading stops the publish rather than dropping the chart in silence. */
export function fillCompareSeam(frontHtml, chartHtml) {
  const heading = frontHtml.indexOf(`<h2 id="${COMPARE_SEAM_ID}">`);
  if (heading < 0) throw new Error(`the README has no "How Leaftext compares" heading to draw the chart under`);
  const paragraph = frontHtml.indexOf('</p>', heading);
  const next = frontHtml.indexOf('<h2', heading + 1);
  if (paragraph < 0 || (next >= 0 && paragraph > next)) throw new Error('the README says nothing under its "How Leaftext compares" heading, where the chart follows one line');
  const at = paragraph + '</p>'.length;
  return frontHtml.slice(0, at) + '\n' + chartHtml + frontHtml.slice(at);
}

/** How many chart rows a drawn page carries in its groups, the short matrix aside. */
export function chartRowCount(html) {
  let total = 0;
  for (const match of html.matchAll(/<details class="compare-group">([\s\S]*?)<\/details>/g)) total += (match[1].match(/<tr><td/g) || []).length;
  return total;
}

/**
 * The README drawn with its chart. `index` is `COMPARE_INDEX`'s text, `bodies` maps each page it lists to that page's text, and `render(body, path)` answers the renderer's `{ html }`.
 *
 * The files arrive already read because the two callers read differently — the bake off the disk, the page over the network — and the drawing is the same for both.
 */
export function frontWithChart(frontHtml, index, bodies, render) {
  const pages = chartPagePaths(index).map((path) => {
    if (!bodies.has(path)) throw new Error(`${COMPARE_INDEX} lists ${path}, which was not read`);
    return { path, html: render(bodies.get(path), path).html };
  });
  return fillCompareSeam(frontHtml, drawCompareChart(render(index, COMPARE_INDEX).html, pages));
}
