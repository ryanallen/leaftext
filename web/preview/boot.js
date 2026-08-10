// The last thing the page runs: install the host, then open a document.
//
// Everything above this line is the app's own — its page, its script, its stylesheet. This only answers, and it answers out of files sitting beside the page: there is no server behind any of it.

import { startLeaftext } from './host.js';

// The listing carries the site's own name beside its documents: the pane draws it as the trail's first word, where the desktop draws the vault it is standing in.
const listing = await (await fetch('documents.json')).json();
const documents = listing.documents || [];
const leaf = await startLeaftext({
  documents,
  name: listing.name || '',
  read: async (path) => (await fetch(`source/${path}`)).text(),
});

// The nearest glossary, which the desktop finds by walking folders and a browser cannot. Handing it over is what auto-links its terms.
const glossary = documents.find((entry) => /(^|\/)glossary\.md$/i.test(entry.path));
if (glossary) leaf.core.setGlossary(await (await fetch(`source/${glossary.path}`)).text());

leaf.showFolder('');

// The document the address names, or the first one. The host owns the address from here — it writes an entry per document opened and reads one back when the reader walks, so watching it here as well would be two things answering one Back.
await leaf.openAddress(documents[0]?.path);
