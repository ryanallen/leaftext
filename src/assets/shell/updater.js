// Running version at the foot of the settings panel: confirms an update landed.
const settingsVersion = document.getElementById('settingsVersion');
if (settingsVersion) settingsVersion.textContent = LEAF_VERSION ? `v${LEAF_VERSION}` : '';
function parseVersion(value) {
  return String(value || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}
function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
const RELEASES_PAGE = 'https://github.com/ryanallen/leaftext/releases/latest';
// Said in two places — the check button and the update button — so it is written once.
const UPDATE_FAILED = 'Update failed — open release page';
const UPDATE_ASSET_SUFFIX = typeof window.__leafUpdateAsset === 'string' ? window.__leafUpdateAsset : '';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// What the update controls are currently reporting.
//
//   idle         nothing asked yet (a throttled launch lands here)
//   checking     a release request is in flight
//   upToDate     GitHub answered and this is the newest version
//   checkFailed  the check itself broke — offline, rate-limited, malformed
//   available    a newer release exists but publishes no installer for this
//                platform, so it cannot be installed for us
//   downloading  bytes are moving; `percent` is live
//   staged       a verified installer is on disk and the app can restart into it
//   failed       the download or its verification broke
//
// The last four raise the dot on the gear; the quiet ones only write the note,
// since a permanent amber dot for a laptop that is merely offline would be noise.
let updateState = {
  status: 'idle',
  version: '',
  url: RELEASES_PAGE,
  percent: 0,
  message: '',
  checkedAt: Number(LEAF_SETTINGS.updateLastChecked || 0) * 1000,
};
// Why the last install did not take, from the applier's record: `{ version,
// message }`, or null. Kept raw so a locale change re-renders it, and sticky for
// the session — a failed install stays true until the next one succeeds.
const updateApplyFailure = (() => {
  const applied = window.__leafUpdateApply;
  if (!applied || typeof applied !== 'object' || applied.ok) return null;
  return {
    version: String(applied.version || '').replace(/^v/i, ''),
    message: String(applied.message || ''),
  };
})();
const UPDATE_NEWS_STATES = ['available', 'downloading', 'staged', 'failed'];

// "Last checked 3 hours ago", from the coarsest unit that fits. Relative rather
// than a timestamp: the only thing worth knowing is whether the answer is stale.
function formatCheckedAgo(when) {
  const seconds = Math.max(0, Math.round((Date.now() - when) / 1000));
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (seconds >= size) {
      const ago = new Intl.RelativeTimeFormat('en-US').format(-Math.floor(seconds / size), unit);
      return `Last checked ${ago}.`;
    }
  }
  return 'Checked just now.';
}

// What the last attempt actually said — this is the check button's label.
function updateNoteText() {
  const { status, message, checkedAt } = updateState;
  // This attempt's own failure first, then the last install's — a fresh error
  // must not be masked by a stale one.
  if (status === 'checkFailed') {
    return `Could not reach GitHub: ${message || ''}`.trim();
  }
  if (status === 'failed') {
    return message ? `Update failed: ${message}` : UPDATE_FAILED;
  }
  if (updateApplyFailure) {
    return `Installing v${updateApplyFailure.version} failed: ${updateApplyFailure.message}`;
  }
  if (status === 'available' && message) return message;
  if (status === 'upToDate') return 'Up to date.';
  if (checkedAt) return formatCheckedAgo(checkedAt);
  return '';
}

function renderUpdateButton() {
  if (!settingsUpdate) return;
  const { status, version, percent } = updateState;
  const news = UPDATE_NEWS_STATES.indexOf(status) !== -1;
  const busy = status === 'checking' || status === 'downloading';

  // The dot on the gear, all a user sees with the panel shut: green for something
  // to install, a spinning ring while it downloads, amber when the attempt broke.
  if (settingsAlertDot) {
    settingsAlertDot.hidden = !news;
    settingsAlertDot.className = 'settings-alert-dot'
      + (status === 'downloading' ? ' is-downloading' : '')
      + (status === 'failed' ? ' is-failed' : '');
  }

  settingsUpdate.hidden = !news;
  settingsUpdate.classList.toggle('is-failed', status === 'failed');
  if (news) {
    const labels = {
      available: () => `Update to v${version}`,
      downloading: () => `Downloading v${version}… ${percent}%`,
      staged: () => 'Restart to update',
      failed: () => UPDATE_FAILED,
    };
    (settingsUpdateLabel || settingsUpdate).textContent = (labels[status] || labels.available)();
    settingsUpdate.title = updateState.message || 'A new version is available';
    if (settingsUpdateSpinner) settingsUpdateSpinner.hidden = status !== 'downloading';
    if (settingsUpdateFill) {
      settingsUpdateFill.style.width = status === 'downloading' ? `${percent}%` : '0';
    }
    // Only a staged, verified installer offers to install. Everything else falls
    // back to the release page, which is what the app did before it could update
    // itself, and is always a safe thing for the button to do.
    settingsUpdate.disabled = status === 'downloading';
    settingsUpdate.onclick = status === 'staged'
      ? () => send({ command: 'applyUpdate' })
      : () => send({ command: 'openExternal', url: updateState.url || RELEASES_PAGE });
  }

  // The status is the button's own label, so one control reports and re-checks.
  // Before the first answer it names what clicking does instead.
  if (settingsCheck) {
    settingsCheck.disabled = busy;
    settingsCheck.title = 'Ask GitHub for the latest release now';
    settingsCheck.classList.toggle(
      'is-error',
      Boolean(updateApplyFailure) || status === 'failed' || status === 'checkFailed',
    );
  }
  if (settingsCheckLabel) {
    settingsCheckLabel.textContent = busy
      ? 'Checking…'
      : updateNoteText() || 'Check for updates';
  }
  if (settingsCheckSpinner) settingsCheckSpinner.hidden = !busy;
}

function setUpdateState(next) {
  updateState = Object.assign({}, updateState, next);
  renderUpdateButton();
}

// Terminal states pushed by the host once it has written and verified (or
// rejected) the download. Progress is tracked here, since this side is the one
// doing the fetching.
window.leafUpdateState = (state) => {
  if (!state || typeof state !== 'object') return;
  setUpdateState({
    status: state.status || 'failed',
    version: state.version || updateState.version,
    message: state.message || '',
    percent: typeof state.percent === 'number' ? state.percent : 0,
  });
};

// Hand the installer to the host, which fetches, hashes, and stages it. The page
// cannot: GitHub serves release assets from a host that sends no
// Access-Control-Allow-Origin, so fetch() fails before the first byte.
function downloadUpdate(version, installer) {
  setUpdateState({ status: 'downloading', version, percent: 0 });
  send({
    command: 'updateDownload',
    version,
    asset: installer.name,
    size: installer.size,
    url: installer.browser_download_url,
  });
}

// Guards two overlapping checks: the periodic tick firing while a manual check
// (or its download) is still running.
let updateCheckInFlight = false;

async function checkForUpdate(force) {
  if (!LEAF_VERSION || updateCheckInFlight) return;
  // The host owns the download and it outlives this call, so the guard above no
  // longer covers it; re-checking mid-download would reset the progress bar.
  if (updateState.status === 'downloading') return;

  // An installer verified in an earlier session is still good; offer it before
  // going anywhere near the network.
  const staged = LEAF_SETTINGS.updateStagedVersion;
  if (staged && isNewerVersion(staged, LEAF_VERSION)) {
    setUpdateState({ status: 'staged', version: String(staged) });
    return;
  }

  // Only the periodic tick is throttled; launching and clicking both ask GitHub
  // at once. One request per launch is nothing against a 60-per-hour limit, and an
  // update the app sat on until the interval elapsed reads as a broken updater.
  if (!force && updateState.checkedAt && Date.now() - updateState.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
    renderUpdateButton();
    return;
  }

  updateCheckInFlight = true;
  setUpdateState({ status: 'checking', message: '', percent: 0 });
  try {
    // no-store: a cached 200 from the last check would make a forced one answer
    // with yesterday's release.
    const res = await fetch('https://api.github.com/repos/ryanallen/leaftext/releases/latest', {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const data = await res.json();
    const tag = data && data.tag_name;
    const newer = Boolean(tag) && isNewerVersion(tag, LEAF_VERSION);
    send({ command: 'updateChecked', version: newer ? String(tag) : '' });
    if (!newer) {
      setUpdateState({ status: 'upToDate', version: '', checkedAt: Date.now() });
      return;
    }

    const version = String(tag).replace(/^v/i, '');
    const url = data.html_url || RELEASES_PAGE;
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const installer = UPDATE_ASSET_SUFFIX
      ? assets.find((asset) => asset && typeof asset.name === 'string' && asset.name.endsWith(UPDATE_ASSET_SUFFIX))
      : null;

    // No installer for this platform: notify only, and say so, or a release that
    // failed to publish one reads as a broken updater.
    if (!installer) {
      setUpdateState({
        status: 'available',
        version,
        url,
        checkedAt: Date.now(),
        message: 'This release publishes no installer for this platform — the button opens the release page.',
      });
      return;
    }
    setUpdateState({ status: 'available', version, url, checkedAt: Date.now(), message: '' });
    downloadUpdate(version, installer);
  } catch (error) {
    // Offline, rate-limited, or a malformed answer. `checkedAt` is deliberately
    // left alone so the next tick retries instead of waiting out the interval.
    setUpdateState({ status: 'checkFailed', message: String((error && error.message) || error) });
  } finally {
    updateCheckInFlight = false;
  }
}
if (settingsCheck) {
  settingsCheck.addEventListener('click', () => checkForUpdate(true));
}
// Opening the panel re-renders, so "last checked 3 hours ago" is current rather
// than however stale it was when the page loaded.
if (settingsMenu) {
  settingsMenu.addEventListener('toggle', () => {
    if (settingsMenu.open) renderUpdateButton();
  });
}
// Paint the row before anything asks the network, so the panel is never blank on
// a build with no version to compare.
renderUpdateButton();
// Every launch, unthrottled: opening the app is the moment a user expects it to
// know whether it is current.
checkForUpdate(true);
// So a window left open for days notices a release. The tick is short; the
// throttle above decides whether it actually reaches the network.
window.setInterval(() => checkForUpdate(), 30 * 60 * 1000);
let minimapViewportFrame = 0;
let minimapPreviewFrame = 0;
// Rebuilding the thumbnail clones the whole document, so only rebuild when the
// content, wrap width, or rail width changed. minimapContentVersion bumps on
// mutation; the minimapBuilt* values record the last clone's inputs, so a
// height-only resize reuses the existing clone.
let minimapContentVersion = 0;
let minimapBuiltVersion = -1;
let minimapBuiltSourceWidth = -1;
let minimapBuiltPreviewWidth = -1;
let minimapDragging = false;
let minimapPointerId = null;
let minimapPointerOffsetY = null;
// Document geometry captured once at the start of a minimap drag (it doesn't
// change while dragging, and re-measuring forces a synchronous layout). Then map
// pointer -> scrollTop with pure math.
let minimapDragMetrics = null;
let minimapResizeObserver = null;
let minimapBodyObserver = null;
// The document range the built clone holds, or null when it holds all of it — the
// clone is a window on long documents, so scrolling out of range is a third reason
// to rebuild (see updateDocumentMinimapPreview).
let minimapBuiltRange = null;
// Rail geometry, cached for the scroll path: scrolling changes none of it, and
// re-measuring per wheel click forced a fresh layout of the whole document.
let minimapScrollMetrics = null;
let readerLayoutFrame = 0;
let readerScrollAnchor = null;
// Between the first wheel click and the settle after it. The clamp and the anchor
// capture each force a layout, so they wait for the gesture to stop — and the reflow
// re-pin stands aside while it runs, the anchor being stale by design until then.
let readerScrollSettleTimer = 0;
let readerScrolling = false;
const READER_SCROLL_SETTLE_MS = 120;
let readerReflowObserver = null;
let resetReaderScrollOnNextRender = false;
// Cached list of the document's anchor blocks, rebuilt when the document changes,
// so the per-scroll probe never re-runs querySelectorAll over huge documents.
let readerAnchorBlocks = null;
let readerAnchorBlocksCount = -1;
// The `.document-body` the cache was built against. A re-render swaps in a fresh
// body node, so comparing identity catches that immediately instead of relying
// on the child-count heuristic alone.
let readerAnchorBlocksSource = null;
// Where the reader parks the first block, from the shell's top edge (the app bar
// overlays part of that). Keep equal to --reader-content-top-gap, which is how the
// code view — no scroll origin — pays the same gap as padding.
const READER_CONTENT_TOP_GAP = 88;
const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';
