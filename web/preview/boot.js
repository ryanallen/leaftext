// The last thing the page runs: install the host, then open a document.
//
// Everything above this line is the app's own — its page, its script, its stylesheet. This only answers, and it answers out of files sitting beside the page: there is no server behind any of it.

import { startLeaftext } from './host.js';

const documents = await (await fetch('documents.json')).json();
const leaf = await startLeaftext({
  documents,
  read: async (path) => (await fetch(`source/${path}`)).text(),
});

// The nearest glossary, which the desktop finds by walking folders and a browser cannot. Handing it over is what auto-links its terms.
const glossary = documents.find((entry) => /(^|\/)glossary\.md$/i.test(entry.path));
if (glossary) leaf.core.setGlossary(await (await fetch(`source/${glossary.path}`)).text());

leaf.showFolder('');

const asked = decodeURIComponent(location.hash.slice(1));
await leaf.openDocument(leaf.known.has(asked) ? asked : documents[0]?.path);

addEventListener('hashchange', () => {
  const wanted = decodeURIComponent(location.hash.slice(1));
  if (leaf.known.has(wanted)) leaf.openDocument(wanted);
});
