// pictures.js
// ---------------------------------------------------------------------------
// The published pictures are WebP, written beside each PNG master at publish. A browser older than Safari 14 cannot decode one and draws its own broken mark instead — 25 of them on the front page alone — so the page puts a failed picture back to the PNG already deployed beside it.
//
// Never a capability probe. The only cheap way to ask a browser whether it reads WebP is `canvas.toDataURL('image/webp')`, which reports whether it can *write* the format; Safari 14 through 16.3 decode WebP and cannot encode one, so a probe takes the pictures away from years of Safari readers to give them to Safari 13. Reacting to the picture that actually failed cannot be wrong about it.
//
// A browser that reads WebP never fires the listener and pays nothing. One that cannot pays a wasted fetch per picture, and it is the rare reader who pays it.
// ---------------------------------------------------------------------------

/** A WebP address and the PNG sitting beside it, keeping any ?query or #fragment. Null for anything else, which is how a picture that was never WebP and a PNG that failed on its own are both left alone. */
function pngBeside(address) {
  const found = /^(.*)\.webp(\?[^#]*)?(#.*)?$/i.exec(address || '');
  return found ? `${found[1]}.png${found[2] || ''}${found[3] || ''}` : null;
}

/** Put one failed picture back to the PNG beside it, once. The mark is what stops a PNG that also fails being asked for again, since its own error arrives through the same listener. */
function fallBackToPng(picture) {
  if (!picture || picture.tagName !== 'IMG' || picture.dataset.pictureFallback) return;
  const png = pngBeside(picture.getAttribute('src'));
  if (!png) return;
  picture.dataset.pictureFallback = 'png';
  picture.setAttribute('src', png);
}

/**
 * Give the pictures in a drawn document a fallback for a browser that cannot read WebP.
 *
 * Two halves, because the two drawing paths arrive at different moments. The listener catches a picture that fails after this runs, and it captures because an image's `error` does not bubble. The sweep catches the ones that failed before it: the front page's 25 are baked into the first response and start loading before any module does.
 *
 * Safe to call again on the same element — the docs reader draws every route into one article — so the listener goes on once and the sweep runs each time.
 */
export function installPictureFallback(root) {
  if (!root) return;
  if (!root.dataset.pictureFallbackWatched) {
    root.dataset.pictureFallbackWatched = 'yes';
    root.addEventListener('error', (event) => fallBackToPng(event.target), true);
  }
  // A picture the browser could not decode ends `complete` with no width, and that is the whole of what it does — there is nothing else on a bare <img> to read.
  root.querySelectorAll('img').forEach((picture) => {
    if (picture.complete && !picture.naturalWidth) fallBackToPng(picture);
  });
}
