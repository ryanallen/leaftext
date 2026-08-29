// Updates. The check compares the running version against the latest GitHub release; if a newer one publishes this platform's installer, the host is asked to fetch, hash, and stage it, and the bell then offers a restart. Nothing else is shown — the checking, the finding, and the failing are the app's own business.
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
const UPDATE_ASSET_SUFFIX = typeof window.__leafUpdateAsset === 'string' ? window.__leafUpdateAsset : '';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// What the updater is doing.
//
//   idle         nothing asked yet (a throttled launch lands here)
//   checking     a release request is in flight
//   upToDate     GitHub answered and this is the newest version
//   checkFailed  the check itself broke — offline, rate-limited, malformed
//   available    a newer release exists, but carries nothing this platform can
//                install, so the app cannot act on it
//   downloading  bytes are moving; `percent` is live
//   staged       a verified installer is on disk and the app can restart into it
//   failed       the download or its verification broke
//
// Only `downloading` and `staged` reach the screen. There is nothing a reader can do about the rest, so saying them is noise: the updater fetches on its own and speaks once it can install.
let updateState = {
  status: 'idle',
  version: '',
  percent: 0,
  checkedAt: Number(LEAF_SETTINGS.updateLastChecked || 0) * 1000,
};

function renderUpdateButton() {
  if (!updateButton) return;
  const { status, version, percent } = updateState;
  const downloading = status === 'downloading';
  const news = downloading || status === 'staged';

  // The bell is in the bar only while there is news, so the bar has to be refit: an action that appears mid-session changes what fits beside the tabs.
  if (updateMenu) {
    const wasHidden = updateMenu.hidden;
    updateMenu.hidden = !news;
    if (!news) updateMenu.open = false;
    if (wasHidden !== updateMenu.hidden) refitAppBar();
  }

  // The mark on the bell, all a user sees with the panel shut: a spinning ring while the new version downloads, a dot once a restart would install it.
  if (updateAlertDot) {
    updateAlertDot.hidden = !news;
    updateAlertDot.className = 'update-alert-dot' + (downloading ? ' is-downloading' : '');
  }

  updateButton.hidden = !news;
  if (news) {
    (updateButtonLabel || updateButton).textContent = downloading
      ? `Downloading v${version}… ${percent}%`
      : 'Restart to update';
    updateButton.title = downloading
      ? 'Downloading the new version'
      : 'Restart to install the new version';
    if (updateButtonSpinner) updateButtonSpinner.hidden = !downloading;
    if (updateButtonFill) updateButtonFill.style.width = downloading ? `${percent}%` : '0';
    // Only a staged, verified installer is clickable — a download in flight has nothing to offer yet.
    updateButton.disabled = downloading;
    updateButton.onclick = downloading ? null : () => send({ command: 'applyUpdate' });
  }
}
// Shut like every other floating thing in the app: the shared Escape helper and an outside click.
if (updateMenu) {
  leafOnEscape(() => {
    if (!updateMenu.open) return;
    updateMenu.open = false;
    updateMenu.querySelector('summary').focus();
  });
  document.addEventListener('click', (event) => {
    if (updateMenu.open && !updateMenu.contains(event.target)) updateMenu.open = false;
  });
}

function setUpdateState(next) {
  updateState = Object.assign({}, updateState, next);
  renderUpdateButton();
}

// Progress and terminal states, pushed by the host: it does the fetching, then writes and verifies (or rejects) what it got.
window.leafUpdateState = (state) => {
  if (!state || typeof state !== 'object') return;
  setUpdateState({
    status: state.status || 'failed',
    version: state.version || updateState.version,
    percent: typeof state.percent === 'number' ? state.percent : 0,
  });
};

// Hand the installer to the host, which fetches, hashes, and stages it. The page cannot: GitHub serves release assets from a host that sends no Access-Control-Allow-Origin, so fetch() fails before the first byte.
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

// Guards two overlapping checks: the periodic tick firing while the launch check (or its download) is still running.
let updateCheckInFlight = false;

async function checkForUpdate(force) {
  if (!LEAF_VERSION || updateCheckInFlight) return;
  // The host owns the download and it outlives this call, so the guard above does not cover it; re-checking mid-download would reset the progress bar.
  if (updateState.status === 'downloading') return;

  // An installer verified in an earlier session is still good; offer it before going anywhere near the network.
  const staged = LEAF_SETTINGS.updateStagedVersion;
  if (staged && isNewerVersion(staged, LEAF_VERSION)) {
    setUpdateState({ status: 'staged', version: String(staged) });
    return;
  }

  // Only the periodic tick is throttled; launch asks GitHub outright. One request per launch is nothing against a 60-per-hour limit, and an update the app sat on until the interval elapsed reads as a broken updater.
  if (!force && updateState.checkedAt && Date.now() - updateState.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
    return;
  }

  updateCheckInFlight = true;
  setUpdateState({ status: 'checking', percent: 0 });
  try {
    // no-store: a cached 200 from the last check would make a forced one answer with yesterday's release.
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
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const installer = UPDATE_ASSET_SUFFIX
      ? assets.find((asset) => asset && typeof asset.name === 'string' && asset.name.endsWith(UPDATE_ASSET_SUFFIX))
      : null;

    // Nothing this platform can install, so nothing is said — sending someone off to install it by hand is work, not news.
    if (!installer) {
      setUpdateState({ status: 'available', version, checkedAt: Date.now() });
      return;
    }
    setUpdateState({ status: 'available', version, checkedAt: Date.now() });
    downloadUpdate(version, installer);
  } catch {
    // Offline, rate-limited, or malformed — all silent. `checkedAt` is left alone so the next tick retries instead of waiting out the interval.
    setUpdateState({ status: 'checkFailed' });
  } finally {
    updateCheckInFlight = false;
  }
}
// Paint before anything asks the network, so the bell never flashes into the bar on a build with no version to compare.
renderUpdateButton();
// Every launch, unthrottled: opening the app is the moment a user expects it to know whether it is current.
checkForUpdate(true);
// So a window left open for days notices a release. The tick is short; the throttle above decides whether it actually reaches the network.
window.setInterval(() => checkForUpdate(), 30 * 60 * 1000);
initializeMinimapState();
const READER_SCROLL_SETTLE_MS = 120;
// Where the reader parks the first block, from the shell's top edge (the app bar overlays part of that). Keep equal to --reader-content-top-gap, which is how the code view — no scroll origin — pays the same gap as padding.
const READER_CONTENT_TOP_GAP = 88;
const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';
