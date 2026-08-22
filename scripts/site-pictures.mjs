// Which pictures a document asks for, read off the render rather than off its source.
//
// The export holds the same module the page renders through, so the addresses here are the addresses the browser will fetch — not a second guess at them. That is also why there is no list of picture extensions anywhere in this file: `src/format.rs` is the one table of formats and a picture is not one of them, so what travels is whatever file sits behind an address a render asked for, whatever it is called.
//
// The base is where the site serves its documents from — `source/` — which the page was told and the render joined in. An address under it names both ends at once: where the file goes in the exported site, and where it is read from inside the folder the export was pointed at.

/** The `src` of every `<img>` the render drew, in the order they appear. */
function imageSources(html) {
  const found = [];
  for (const [, value] of html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/gi)) found.push(value);
  return found;
}

/** An attribute value back to the text it stands for. Only the five the sanitizer writes — nothing here parses HTML, it reads what this renderer emits. */
function decodeAttribute(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Every picture a rendered document asks the site for, deduplicated and in the order the document names them.
 *
 * Each answer says where the file goes under the exported site and which file inside the source folder it comes from. An address the browser fetches for itself is left out — `http`, `https`, a protocol-relative one, and one carrying its own bytes need nothing copied. So is anything that did not land under the base: with the base handed over there is nothing left that should, and copying a file for an address the page will not ask for is worse than skipping it.
 */
export function picturesInRenderedHtml(html, base = 'source') {
  const prefix = `${base.replace(/\/+$/, '')}/`;
  const seen = new Set();
  const pictures = [];
  for (const raw of imageSources(String(html || ''))) {
    const address = decodeAttribute(raw);
    if (!address.startsWith(prefix)) continue;
    if (seen.has(address)) continue;
    seen.add(address);
    pictures.push({ address, file: address.slice(prefix.length) });
  }
  return pictures;
}
