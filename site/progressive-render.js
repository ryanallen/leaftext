// progressive-render.js
// ---------------------------------------------------------------------------
// Put a rendered document's HTML on the page. Small documents go in one shot.
// Large ones stream their top-level blocks a batch per animation frame behind a
// determinate progress bar, so a big file lays out in full (the web always renders
// in full) without freezing or looking stalled — the user sees how much is done and
// how much is left, updating live. Mirrors applyDocumentMarkup in the desktop
// app-shell.js so web and desktop behave the same.
// ---------------------------------------------------------------------------

// Below this many top-level blocks a document is inserted in one shot (instant, no
// bar). Above it, blocks stream in so the one-time layout cost is visible.
const PROGRESSIVE_BLOCK_THRESHOLD = 900;
const PROGRESSIVE_BATCH = 120;
// Bumped on every call so an in-flight stream abandons itself when a newer render
// (route change, live reload) supersedes it.
let renderToken = 0;

/**
 * Replace `container`'s contents with `html`, streaming large documents behind a
 * progress bar. Runs `onDone` once the document is fully on the page.
 */
export function applyDocumentHtml(container, html, onDone) {
  renderToken += 1;
  const token = renderToken;
  const template = document.createElement('template');
  template.innerHTML = html;
  const blockCount = template.content.childElementCount;
  if (blockCount <= PROGRESSIVE_BLOCK_THRESHOLD) {
    container.innerHTML = html;
    if (onDone) onDone();
    return;
  }
  const nodes = Array.from(template.content.childNodes);
  container.replaceChildren();
  const loading = buildLoadingBar();
  document.body.appendChild(loading);
  const total = nodes.length;
  let inserted = 0;
  const pump = () => {
    if (token !== renderToken) {
      loading.remove();
      return;
    }
    const fragment = document.createDocumentFragment();
    const end = Math.min(total, inserted + PROGRESSIVE_BATCH);
    for (; inserted < end; inserted++) {
      fragment.appendChild(nodes[inserted]);
    }
    container.appendChild(fragment);
    setProgress(loading, total === 0 ? 1 : inserted / total);
    if (inserted < total) {
      requestAnimationFrame(pump);
    } else {
      loading.remove();
      if (onDone) onDone();
    }
  };
  requestAnimationFrame(pump);
}

function buildLoadingBar() {
  const el = document.createElement('div');
  el.className = 'reader-loading';
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.setAttribute('aria-valuenow', '0');
  const labelRow = document.createElement('div');
  labelRow.className = 'reader-loading-label';
  const text = document.createElement('span');
  text.textContent = 'Loading document…';
  const percent = document.createElement('span');
  percent.className = 'reader-loading-percent';
  percent.textContent = '0%';
  labelRow.append(text, percent);
  const track = document.createElement('div');
  track.className = 'reader-loading-track';
  const fill = document.createElement('div');
  fill.className = 'reader-loading-fill';
  track.appendChild(fill);
  el.append(labelRow, track);
  return el;
}

function setProgress(el, ratio) {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  el.setAttribute('aria-valuenow', String(pct));
  const fill = el.querySelector('.reader-loading-fill');
  if (fill) {
    fill.style.width = pct + '%';
  }
  const percent = el.querySelector('.reader-loading-percent');
  if (percent) {
    percent.textContent = pct + '%';
  }
}
