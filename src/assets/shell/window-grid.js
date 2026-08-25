// The wide dot grid on the chrome holds its place on the desktop while the window slides over it. Every frame of a move the page reads where it is and writes one offset; the chrome's overlays each translate by it, so the whole lattice moves on the compositor with nothing repainted. Moved by `background-position` instead, the same lattice took a real drag from 144 frames a second to 7.
//
// The pitch is the stylesheet's and is read rather than written here, so there is one number. Unreadable, the offset is never written and the grid stands still and correctly placed, which is what a browser gets and what the app gets before its first move.
let windowGridPitch = 0;
let windowGridFrame = 0;
function readWindowGridPitch() {
  const written = getComputedStyle(document.documentElement).getPropertyValue('--lt-grid-pitch');
  const pitch = Number.parseFloat(written);
  windowGridPitch = Number.isFinite(pitch) && pitch > 0 ? pitch : 0;
}
function windowGridSlide(place) {
  return -(((place % windowGridPitch) + windowGridPitch) % windowGridPitch) + 'px';
}
// Negated, and never larger than one pitch: the lattice repeats every pitch, so sliding the layer back by where the window sits leaves every dot on the spot of desktop it was already on.
//
// Straight off the window's own place, never a guess at where it is going next. Leaning on the last frame's speed was built and measured through a throw of 39 pixels a frame and left the worst frame exactly as far out as reading it straight, because a thrown window does not travel at one speed — so the guess costs a direction change and buys nothing.
function writeWindowGridOffset() {
  if (!windowGridPitch) return;
  const x = window.screenX;
  const y = window.screenY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const root = document.documentElement.style;
  root.setProperty('--lt-grid-offset-x', windowGridSlide(x));
  root.setProperty('--lt-grid-offset-y', windowGridSlide(y));
}
// Every chrome surface carrying a grid layer. Each layer's lattice would otherwise start at its own box's corner, so five of them would show five phases and a seam wherever two meet — the same fault the fine grain's window-anchored tiling was written to avoid, which a transform takes away from it.
const WINDOW_GRID_SURFACES = '.app-bar, .library-shell, .library-pane, .reader-corner, .library-crumbs, .library-header';
// On layout and never per frame: a box's offset within the window changes when the rail is dragged, the bar folds or the window is resized, and at no other time.
function lockWindowGridPhase() {
  if (!windowGridPitch) return;
  for (const surface of document.querySelectorAll(WINDOW_GRID_SURFACES)) {
    const box = surface.getBoundingClientRect();
    surface.style.setProperty('--lt-grid-phase-x', windowGridSlide(box.left));
    surface.style.setProperty('--lt-grid-phase-y', windowGridSlide(box.top));
  }
}
// Watched rather than hung off the window's own resize: the rail is dragged, the bar folds and the pane becomes a sheet without the window changing size at all, and each of those moves a box the grid is drawn on. Writing a custom property on an element does not change its box, so this cannot chase itself.
const windowGridWatcher = typeof ResizeObserver === 'function' ? new ResizeObserver(lockWindowGridPhase) : null;
function watchWindowGridSurfaces() {
  if (!windowGridWatcher) return;
  for (const surface of document.querySelectorAll(WINDOW_GRID_SURFACES)) windowGridWatcher.observe(surface);
}

// Only between the host's two notes. A frame callback left running forever is a reader that never goes idle on an app somebody keeps open all day, and the window is still for all but seconds of it.
function leafWindowMoveStarted() {
  // Re-read per gesture rather than once at boot: a theme swaps the stylesheet under the page, and once a gesture is a cost nothing can measure.
  readWindowGridPitch();
  if (windowGridFrame) return;
  const step = () => {
    writeWindowGridOffset();
    windowGridFrame = requestAnimationFrame(step);
  };
  windowGridFrame = requestAnimationFrame(step);
}
function leafWindowMoveStopped() {
  readWindowGridPitch();
  if (windowGridFrame) cancelAnimationFrame(windowGridFrame);
  windowGridFrame = 0;
  // One last read: the frame the gesture ended on is the place the window actually came to rest at.
  writeWindowGridOffset();
}
window.leafWindowMoveStarted = leafWindowMoveStarted;
window.leafWindowMoveStopped = leafWindowMoveStopped;
readWindowGridPitch();
writeWindowGridOffset();
lockWindowGridPhase();
watchWindowGridSurfaces();
