// A picture on the whole window. A reader and nothing else: it shows the element the page already holds, so there is no read, no write and no host command behind it — which is also why a published site gets it for free. Built inside `app`, like the full-window table and diagram, because everything in `app` is replaced on a render and that is what closes it when the document changes.
function imageSheetOverlayElement() {
  return app ? app.querySelector('.image-sheet-overlay') : null;
}

function closeImageSheet() {
  const overlay = imageSheetOverlayElement();
  if (!overlay) return;
  const opener = overlay.__imageSheetOpener;
  const scrim = overlay.__imageSheetScrim;
  overlay.remove();
  if (scrim) scrim.remove();
  leafFocusForKeyboard(opener);
}

// Opening is reading, so the padlock is not asked. A marked missing picture has nothing behind the mark to show, so it never gets here.
function openImageSheet(picture, opener) {
  if (!app || !picture || picture.dataset.imageMissing === 'true') return;
  closeImageSheet();
  const scrim = document.createElement('div');
  scrim.className = 'lt-backdrop';
  scrim.addEventListener('click', closeImageSheet);
  const overlay = document.createElement('section');
  overlay.className = 'image-sheet-overlay';
  overlay.setAttribute('role', 'dialog');
  // No header and no words on the glass, so the label is the only thing a screen reader has to go on.
  overlay.setAttribute('aria-label', picture.alt ? `${picture.alt} — full window` : 'Picture, full window');
  overlay.__imageSheetOpener = opener || null;
  overlay.__imageSheetScrim = scrim;
  const shown = document.createElement('img');
  shown.className = 'image-sheet-picture';
  shown.alt = picture.alt || '';
  // The element's live source, never a copy taken earlier: a local picture's address carries a per-render token that beats the web view's decoded-picture cache, so a stale one would still show the file as it was.
  shown.src = picture.currentSrc || picture.src;
  // The close mark is drawn only while the pointer is in this corner, so nothing sits over a picture somebody is looking at.
  const corner = document.createElement('div');
  corner.className = 'image-sheet-corner';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'leaf-sheet-close image-sheet-close';
  close.title = 'Close — or press Escape';
  close.setAttribute('aria-label', 'Close the full-window picture');
  close.innerHTML = `<span class="lt-icon lt-icon-close"></span>`;
  close.addEventListener('click', closeImageSheet);
  corner.appendChild(close);
  // The overlay is the ground, not a panel: the scrim shows through it, so a press anywhere but the picture closes it the way a press on the scrim does.
  overlay.addEventListener('click', (event) => {
    if (event.target !== shown) closeImageSheet();
  });
  overlay.append(shown, corner);
  app.append(scrim, overlay);
  window.requestAnimationFrame(() => {
    scrim.classList.add('open');
    overlay.classList.add('open');
  });
}

// One opener per widened picture, at its top right, appearing on hover and on keyboard focus. It rides inside the paragraph and only ever there: a paragraph holding a picture is refused WYSIWYG, so every edit takes it whole by its source range and its DOM is never turned back into Markdown.
function bindImageSheet(root = app) {
  if (!root) return;
  // The reader's own body, not the minimap's: the rail draws a scaled copy of the page carrying the same marks, and a control in it is one nobody can press.
  root.querySelectorAll('.reader-layout > .document-body > p.image-lane').forEach((block) => {
    if (block.querySelector(':scope > .image-sheet-open')) return;
    const picture = block.querySelector(':scope > img');
    if (!picture || picture.dataset.imageMissing === 'true') return;
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.className = 'image-sheet-open';
    opener.title = 'Open picture on the whole window';
    opener.setAttribute('aria-label', 'Open picture on the whole window');
    opener.innerHTML = `<span class="lt-icon lt-icon-expand"></span>`;
    opener.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImageSheet(picture, opener);
    });
    block.appendChild(opener);
  });
}

function onImageSheetKey(event) {
  if (event.key !== 'Escape' || !imageSheetOverlayElement()) return;
  event.preventDefault();
  event.stopPropagation();
  closeImageSheet();
}
document.addEventListener('keydown', onImageSheetKey, true);
