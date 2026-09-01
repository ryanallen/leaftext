// The last thing the page runs: install the host, then open a document.
//
// Everything above this line is the app's own — its page, its script, its stylesheet. This only answers, and it answers out of files sitting beside the page: there is no server behind any of it.

import { landingPath, sayMissing, startLeaftext } from './host.js';

/** One file from beside the page, or an error naming it.
 *
 * Every fetch here goes through this. A static host answers 404 for a file that was not published, and a browser refuses the request outright for a folder opened off a disk; both are the same fact, and neither may kill this module quietly — a boot that throws leaves the reader at the empty start screen, reading it as a site with nothing in it.
 */
async function fetched(path) {
  let response;
  try {
    response = await fetch(path);
  } catch (error) {
    throw Object.assign(new Error(String((error && error.message) || error)), { file: path });
  }
  if (!response.ok) throw Object.assign(new Error(`the server answered ${response.status}`), { file: path });
  return response;
}

try {
  // The listing carries the site's own name beside its documents: the pane draws it as the trail's first word, where the desktop draws the vault it is standing in.
  const listing = await (await fetched('documents.json')).json();
  const documents = listing.documents || [];
  const leaf = await startLeaftext({
    documents,
    name: listing.name || '',
    // The file's own bytes, not a decode of them: a Word, Excel, PowerPoint or OpenDocument file is a zip, and a page reading one as text draws it as a parse error rather than as the document it is. The glossary read below stays text, because that is a file the host reads for its words rather than one it draws.
    read: async (path) => new Uint8Array(await (await fetched(`source/${path}`)).arrayBuffer()),
  });

  // Where the documents are served from, which is where their pictures are too. This page sits at the top of the site and every document sits under `source/`, so a picture beside a document is only reachable through that folder joined with the document's own — without this the page asks the top of the site for it and gets the broken-picture mark.
  leaf.core.setImageBase('source');

  // The nearest glossary, which the desktop finds by walking folders and a browser cannot. Handing it over is what auto-links its terms.
  const glossary = documents.find((entry) => /(^|\/)glossary\.md$/i.test(entry.path));
  if (glossary) leaf.core.setGlossary(await (await fetched(`source/${glossary.path}`)).text());

  leaf.showFolder('');

  // The document the address names, or the site's own front page. The host owns the address from here — it writes an entry per document opened and reads one back when the reader walks, so watching it here as well would be two things answering one Back.
  await leaf.openAddress(landingPath(documents));
} catch (error) {
  sayMissing(error && error.file, error && error.message);
}
