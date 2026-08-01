// The reader's place as a document-intrinsic anchor (heading + block + offset),
// so it survives a full re-render. Falls back to the top with no document.
function currentScrollAnchor() {
  return captureReaderScrollAnchor() || { section: null, block: 0, offsetY: 0 };
}
function sendNavigationCommand(command) {
  send({ command, scroll_anchor: currentScrollAnchor() });
}
backButton.addEventListener('click', () => sendNavigationCommand('goBack'));
forwardButton.addEventListener('click', () => sendNavigationCommand('goForward'));
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
window.addEventListener('mousedown', (event) => {
  const command = navigationCommandForMouseButton(event);
  if (!command) {
    return;
  }
  event.preventDefault();
  sendNavigationCommand(command);
});
settingsMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    settingsMenu.open = false;
    settingsMenu.querySelector('summary').focus();
  }
});
document.addEventListener('click', (event) => {
  if (settingsMenu.open && !settingsMenu.contains(event.target)) {
    settingsMenu.open = false;
  }
});
