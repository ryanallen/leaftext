// The document's headings: the walk that turns them into rows, and the pane that draws them.

import vm from 'node:vm';
import { bootReading, check, record } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // A document body of the shape the renderer hands over, built out of markup so the walk is asked the same questions a real page asks it.
  const bodyOf = (markup) => {
    const body = booted.document.createElement('div');
    body.className = 'document-body';
    body.innerHTML = markup;
    return body;
  };

  // ---- 1. the headings, as data ---------------------------------------------
  //
  // The rows are what more than one thing draws from, so the walk is proved on its own: the levels it reports, the order, the ids it stamps, and the three kinds of heading that are not sections at all.

  check('the heading walk reports every level under the title, in order, and stamps the ids', () => {
    const rows = booted.collectDocumentOutlineRows(
      bodyOf(
        '<h1>Title</h1>' +
          '<h2 id="named">Named</h2>' +
          '<h3>Three</h3>' +
          '<h4>Four</h4>' +
          '<h5>Five</h5>' +
          '<h6>Six</h6>' +
          '<h2>Back up</h2>' +
          '<div class="tei-front"><h2>Front matter</h2></div>' +
          '<section class="footnotes"><h2>Footnotes</h2></section>'
      )
    );

    const said = rows.map((row) => `${row.level}:${row.text}`).join(' ');
    if (said !== '2:Named 3:Three 4:Four 5:Five 6:Six 2:Back up') throw new Error(`the walk read the document as: ${said}`);
    // The title is what the outline hangs under, so it is never a row of its own.
    if (rows.some((row) => row.text === 'Title')) throw new Error('the title came back as a section');
    // A heading that already has an id keeps it; the rest are stamped by their place under the title.
    const ids = rows.map((row) => row.id).join(' ');
    if (ids !== 'named section-2 section-3 section-4 section-5 section-6') throw new Error(`the ids the walk stamped: ${ids}`);
  });

  check('the heading walk leaves the footnote markers out of what a row says', () => {
    const rows = booted.collectDocumentOutlineRows(
      bodyOf('<h1>Title</h1><h2>A section<sup class="footnote-ref"><a href="#fn1">1</a></sup></h2>')
    );
    if (rows.length !== 1 || rows[0].text !== 'A section') throw new Error(`the row says: ${JSON.stringify(rows.map((row) => row.text))}`);
  });

  check('a document that is a title and no more has no outline at all', () => {
    if (booted.collectDocumentOutlineRows(bodyOf('<h1>Title</h1><p>One paragraph.</p>')).length !== 0) throw new Error('a lone title was read as an outline');
    if (booted.collectDocumentOutlineRows(bodyOf('<p>No headings at all.</p>')).length !== 0) throw new Error('a document with no headings was read as an outline');
  });

  // ---- 2. the section you are reading ---------------------------------------
  //
  // The reader's own anchor already names the heading above the top edge on every scroll settle. This is that answer being said out loud, and the entry for it being marked.

  // The blocks a reader anchors to, laid out one under the other and following the scroll the way a browser's boxes do. Every one of them, because the binary search over them takes their document order for the order of their boxes.
  const layOutAnchorBlocks = (page, tall) => {
    const blocks = page.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr');
    blocks.forEach((block, at) => {
      block.getBoundingClientRect = () => ({ left: 0, top: at * tall - page.app.scrollTop, right: 800, bottom: at * tall - page.app.scrollTop + tall, width: 800, height: tall });
    });
  };

  // A document of three sections, each a heading and a paragraph, under an opening paragraph that belongs to none of them.
  const threeSections = () => {
    const page = bootReading({ blocks: [] });
    page.app.innerHTML =
      '<div class="document-body"><p>An opening line.</p>' +
      '<h2 id="one">One</h2><p>First.</p>' +
      '<h2 id="two">Two</h2><p>Second.</p>' +
      '<h2 id="three">Three</h2><p>Third.</p>' +
      '</div>';
    page.body = page.app.querySelector('.document-body');
    return page;
  };

  const sectionAfterScrollingTo = (page, top) => {
    page.app.scrollTop = top;
    page.context.refreshReaderScrollAnchor();
    return page.context.readerSectionAboveTopEdge();
  };

  check('the reader says which section its top edge is under, and says none above the first', () => {
    const page = threeSections();
    layOutAnchorBlocks(page, 400);

    if (sectionAfterScrollingTo(page, 0) !== null) throw new Error(`above the first heading the reader named a section: ${sectionAfterScrollingTo(page, 0)}`);
    for (const [top, want] of [[400, 'one'], [1200, 'two'], [2000, 'three'], [400, 'one']]) {
      const said = sectionAfterScrollingTo(page, top);
      if (said !== want) throw new Error(`scrolled to ${top} the reader named "${said}" rather than "${want}"`);
    }
  });

  check('a scroll that stays inside one section says nothing a second time', () => {
    const page = threeSections();
    layOutAnchorBlocks(page, 400);
    let said = 0;
    const wasLight = page.context.lightLibraryOutlineSection;
    vm.runInContext('lightLibraryOutlineSection = () => { __saidCount += 1; };', Object.assign(page.context, { __saidCount: 0 }));
    try {
      page.app.scrollTop = 1200;
      page.context.refreshReaderScrollAnchor();
      page.app.scrollTop = 1400;
      page.context.refreshReaderScrollAnchor();
      said = page.context.__saidCount;
    } finally {
      page.context.lightLibraryOutlineSection = wasLight;
    }
    if (said !== 1) throw new Error(`two scrolls inside one section said the section ${said} times`);
  });

  // ---- 3. the pane draws it -------------------------------------------------
  //
  // The pane's one box already swaps the file list for the search results. The outline is the third list in it, and only one of the three shows.

  const OUTLINE_ROWS = [
    { level: 2, text: 'One', id: 'one' },
    { level: 3, text: 'Two', id: 'two' },
    { level: 2, text: 'Three', id: 'three' },
  ];

  // A page with a document open, its headings handed to the pane, and the reader standing in the second section.
  const paneShowingAnOutline = (rows = OUTLINE_ROWS) => {
    const page = threeSections();
    layOutAnchorBlocks(page, 400);
    page.outline = page.context.document.getElementById('libraryOutline');
    page.tree = page.context.document.getElementById('libraryTree');
    page.results = page.context.document.getElementById('librarySearchResults');
    page.context.setDocumentOutlineRows(rows);
    page.context.followFileInLibrary('C:\\Notes\\one.md');
    page.app.scrollTop = 1200;
    page.context.refreshReaderScrollAnchor();
    page.context.renderLibraryOutline();
    return page;
  };

  const outlineRowsOf = (page) =>
    page.outline.querySelectorAll('.library-outline-row').map((row) => {
      const depth = [0, 1, 2, 3, 4, 5].find((at) => row.classList.contains(`library-outline-depth-${at}`));
      return `${depth}:${row.textContent}${row.classList.contains('is-selected') ? ' *' : ''}`;
    });

  check('the pane draws the headings, one line naming them, and the way back to the files', () => {
    const page = paneShowingAnOutline();

    const back = page.outline.querySelector('.library-nav-up');
    if (!back) throw new Error('the outline has no way back to the file list');
    if (!String(back.getAttribute('aria-label')).startsWith('Back to ')) throw new Error(`the back row says: ${back.getAttribute('aria-label')}`);

    const note = page.outline.querySelector('.library-outline-note');
    if (!note || !note.textContent.includes('On this page')) throw new Error(`the line above the headings says: ${note && note.textContent}`);
    // Three headings over seven body blocks, so a count read off the document rather than off the rows says seven and is caught here.
    if (!note.textContent.includes('3 headings')) throw new Error(`the line above the headings counts: ${note.textContent}`);

    const said = outlineRowsOf(page).join(' | ');
    if (said !== '0:One | 1:Two * | 0:Three') throw new Error(`the pane drew: ${said}`);
  });

  check('the line above the headings counts the headings and not the document', () => {
    // The body is the same seven blocks either way, so a number that moves with the rows is reading the rows.
    const three = paneShowingAnOutline();
    if (!three.outline.querySelector('.library-outline-count').textContent.includes('3 headings')) throw new Error(`three headings drew: ${three.outline.querySelector('.library-outline-count').textContent}`);

    const five = paneShowingAnOutline([
      { level: 2, text: 'One', id: 'one' },
      { level: 3, text: 'Two', id: 'two' },
      { level: 4, text: 'Three', id: 'three' },
      { level: 3, text: 'Four', id: 'four' },
      { level: 2, text: 'Five', id: 'five' },
    ]);
    if (!five.outline.querySelector('.library-outline-count').textContent.includes('5 headings')) throw new Error(`five headings drew: ${five.outline.querySelector('.library-outline-count').textContent}`);
  });

  check('the pane shows one list at a time, and a live query outranks the outline', () => {
    const page = paneShowingAnOutline();
    const showing = () => [page.results.hidden ? '' : 'results', page.outline.hidden ? '' : 'outline', page.tree.hidden ? '' : 'files'].filter(Boolean).join(' and ');

    if (showing() !== 'outline') throw new Error(`with a document open the pane is showing: ${showing()}`);

    vm.runInContext("librarySearchQuery = 'draft';", page.context);
    page.context.renderLibrarySearch();
    if (showing() !== 'results') throw new Error(`with a query live the pane is showing: ${showing()}`);

    vm.runInContext("librarySearchQuery = '';", page.context);
    page.context.renderLibrarySearch();
    if (showing() !== 'outline') throw new Error(`with the query cleared the pane is showing: ${showing()}`);
  });

  check('the back row puts the file list back, and a document with no headings never took it', () => {
    const page = paneShowingAnOutline();
    const back = page.outline.querySelector('.library-nav-up');
    for (const handler of back.listeners.get('click') || []) handler({});
    if (!page.outline.hidden || page.tree.hidden) throw new Error('the back row left the outline standing over the files');

    const bare = paneShowingAnOutline([]);
    if (!bare.outline.hidden || bare.tree.hidden) throw new Error('a document with no headings took the pane away from the files');
  });

  check('the back row follows the folder the file list is showing, however late it arrives', () => {
    const page = paneShowingAnOutline();
    // The rows are drawn on the frame after the document paints; the folder holding it lands afterwards, from the host.
    page.context.leafSetLibraryFolder({ path: 'C:\Notes\deep', chain: [{ path: 'C:\Notes', name: 'Notes' }, { path: 'C:\Notes\deep', name: 'Field notes' }], entries: [] });
    const back = page.outline.querySelector('.library-nav-up');
    if (back.textContent !== 'Field notes') throw new Error(`the back row names: ${back.textContent}`);
    if (back.getAttribute('aria-label') !== 'Back to Field notes') throw new Error(`a reader who cannot see it is told: ${back.getAttribute('aria-label')}`);
  });

  check('reading on moves the mark in the pane without the list being drawn again', () => {
    const page = paneShowingAnOutline();
    const rowsBefore = page.outline.querySelectorAll('.library-outline-row');
    page.app.scrollTop = 2000;
    page.context.refreshReaderScrollAnchor();
    const rowsAfter = page.outline.querySelectorAll('.library-outline-row');
    if (rowsBefore.some((row, at) => row !== rowsAfter[at])) throw new Error('a scroll rebuilt the rows rather than moving the mark');
    const lit = rowsAfter.filter((row) => row.classList.contains('is-selected')).map((row) => row.textContent);
    if (lit.join(' ') !== 'Three') throw new Error(`reading on marked: ${JSON.stringify(lit)}`);
  });

  // ---- 4. the box comes out of the page -------------------------------------
  //
  // The document keeps its headings, and nothing is drawn between its title and its first sentence.

  check('a rendered document holds no outline, and its blocks still slice back out of the source', () => {
    const src = '# Title\n\nAn opening line.\n\n## One\n\nFirst.\n';
    const path = 'C:\\Notes\\one.md';
    const page = bootReading({ blocks: [] });
    page.context.window.leafSetState({
      recent: [],
      favorites: [],
      tabs: [{ title: 'one', path }],
      active: 0,
      document: {
        title: 'one',
        path,
        html: '<div class="document-body"><h1>Title</h1><p>An opening line.</p><h2 id="one">One</h2><p>First.</p></div>',
        minimap: { lines: [], headings: [] },
        format: 'Markdown',
        blocks: [],
        tasks: [],
        source: src,
      },
    });
    const body = page.app.querySelector('.document-body');
    if (body.querySelectorAll('.document-outline').length) throw new Error('the render put an outline back between the title and the first sentence');
    // The headings themselves survive the box going: they are what the pane draws.
    const rows = page.context.readDocumentOutlineRows().map((row) => row.text);
    if (rows.join(' ') !== 'One') throw new Error(`the render published: ${JSON.stringify(rows)}`);

    const blocks = [
      { id: 0, kind: 'heading', start: 0, end: 7, editable: true },
      { id: 1, kind: 'paragraph', start: 9, end: 25, editable: true },
      { id: 2, kind: 'heading', start: 27, end: 33, editable: true },
      { id: 3, kind: 'paragraph', start: 35, end: 41, editable: true },
    ];
    page.context.attachMarkdownBlockRanges(body, blocks, src);
    const sliced = body.children.map((child) => src.slice(Number(child.dataset.srcStart), Number(child.dataset.srcEnd)));
    if (sliced.join(' | ') !== '# Title | An opening line. | ## One | First.') throw new Error(`the ranges slice back to: ${JSON.stringify(sliced)}`);
  });
}
