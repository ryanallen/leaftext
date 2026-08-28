// The reader's place as a document-intrinsic anchor (heading + block + offset), so it survives a full re-render. The place the page is already holding stands in when nothing can be measured — under the map there is no box to read and the top would be sent to the host as though the reader were there. Falls back to the top with no document at all.
function currentScrollAnchor() {
  return captureReaderScrollAnchor() || readerScrollAnchor || { section: null, block: 0, offsetY: 0 };
}
function sendNavigationCommand(command) {
  // Which way the reader is going is the whole of what these two buttons mean, and it is the render drawing the answer that says it on screen.
  setNavigationDirection(command === 'goBack' ? 'back' : 'forward');
  send({ command, scroll_anchor: currentScrollAnchor() });
}
// A native close cannot ask the page where it was, so a quiet reader scroll tells the host before it matters.
if (app) {
  app.addEventListener('scroll', () => {
    if (codeViewActive) return;
    scheduleSessionPlace();
  }, { passive: true });
}
function isEditableMouseTarget(target) {
  const element = target instanceof Element ? target : target?.parentElement;
  return Boolean(element?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
}
function navigationCommandForMouseButton(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditableMouseTarget(event.target)) {
    return null;
  }
  if (event.button === 3) {
    return 'goBack';
  }
  if (event.button === 4) {
    return 'goForward';
  }
  return null;
}
// Nothing to wire on a published site: dom.js has taken the strip out, and the browser's own pair one row up is what a reader presses. Canceling the mouse's own back gesture is what this watch does before it sends, so on a site not watching at all is the whole point of removing the buttons rather than hiding them.
if (backButton && forwardButton) {
  backButton.addEventListener('click', () => sendNavigationCommand('goBack'));
  forwardButton.addEventListener('click', () => sendNavigationCommand('goForward'));
  window.addEventListener('mousedown', (event) => {
    const command = navigationCommandForMouseButton(event);
    if (!command) {
      return;
    }
    event.preventDefault();
    sendNavigationCommand(command);
  });
}
