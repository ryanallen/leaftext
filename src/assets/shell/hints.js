// The first-run bubble: one floating box with a chevron aimed at one control, retired for good the moment the reader's pointer reaches that control or presses it. A control that does not say what it does is a bet the reader finds it, and this pays the bet once. No close button: a bubble that can be waved away unread is a bubble that gets waved away unread.
//
// A hint is three things: a name, a way to find the element it points at, and one line of words. Fragments register their own as they load, in the order they should be met; the boot pass at the end of the script shows at most one.

// How close the bubble may come to a window edge, and how far it stands off its target. A side with no room for the first is not used; the next one is tried.
const HINT_EDGE = 14;
const HINT_GAP = 10;
// Sides in the order they are tried. The first that fits the window whole wins, so a target near an edge flips rather than being squeezed or clipped.
const HINT_SIDES = ['right', 'left', 'above', 'below'];
// Keeps the chevron inside the box's rounded corners when the bubble had to be clamped away from its target's center.
const HINT_TAIL_INSET = 18;
// Read straight off the injected global rather than settings.js's copy: that fragment loads after this one, so its const is still in its dead zone here.
const HINT_SETTINGS = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};
// A published site draws none of these. A hint is a once-per-install promise — drawn to be met and then never again, counted in launches of an app somebody installed — and a reader landing on one page of a site has installed nothing. So nothing registers, no pass runs, and no launch is ever spent.
const HINTS_OFF = !!window.__leafSite;
const hintRegistry = new Map();
// Launches that had a hint to draw, the names already met, and the launch the last bubble showed at. The host owns all three across restarts; they are read once here and reported back together whenever one changes.
let hintLaunches = Number(HINT_SETTINGS.hintLaunches) || 0;
const hintsSeen = new Set(Array.isArray(HINT_SETTINGS.hintsSeen) ? HINT_SETTINGS.hintsSeen.filter((name) => typeof name === 'string') : []);
let hintLastLaunch = Number(HINT_SETTINGS.hintLastLaunch) || 0;
// The bubble on screen and the name it belongs to. Only ever one of each: a queue of these is the fatigue the whole thing is shaped around avoiding.
let hintBubble = null;
let hintShowing = null;
// The control the bubble on screen points at, and the pointer watch put on it. Held so the watch comes off with the bubble rather than outliving it.
let hintWatched = null;
// The sheets standing over the app, and the name of the bubble one of them took down. A sheet is not a gesture that ends the way a menu is: it stands until it is dismissed, and everything it covers is out of reach while it does — including the control a bubble is pointing at, and both of the gestures that meet a hint. So the promise is held rather than lost.
const hintSheets = new Set();
let hintSuspended = null;

// All three travel together — none of them means anything without the others.
function saveHintState() {
  send({ command: 'setHintState', launches: hintLaunches, seen: [...hintsSeen], lastLaunch: hintLastLaunch });
}

// `target` is a function, so a control that comes and goes is looked up at the moment of showing rather than at the moment of registering.
function registerHint(name, target, text) {
  if (HINTS_OFF) return;
  hintRegistry.set(name, { name, target, text });
}

// The control and where it is, or nothing at all: a hint never points at something that is not there — a shut library pane, a hidden control — and a launch like that is not spent.
function hintTarget(hint) {
  const element = typeof hint.target === 'function' ? hint.target() : hint.target;
  if (!element || !element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (rect.right <= 0 || rect.bottom <= 0) return null;
  const app = leafAppRect();
  if (rect.left >= app.right || rect.top >= app.bottom) return null;
  return { element, rect };
}

// The first side that fits the app whole. Every number here is in the app's own coordinates, target included — see hintTargetInApp — so what comes back can go straight on a fixed child of the app surface. The cross axis centers on the target and is then clamped inside the margin, and the chevron follows the target rather than the box, so a clamped bubble still points at the control.
function hintPlacement(target, size, view) {
  const room = {
    right: view.width - HINT_EDGE - (target.right + HINT_GAP) >= size.width,
    left: target.left - HINT_GAP - size.width >= HINT_EDGE,
    above: target.top - HINT_GAP - size.height >= HINT_EDGE,
    below: view.height - HINT_EDGE - (target.bottom + HINT_GAP) >= size.height,
  };
  // Nothing fits in an app this small, so take the last side and let the clamp below hold the box on screen: covering the target beats drawing off it.
  const side = HINT_SIDES.find((name) => room[name]) || HINT_SIDES[HINT_SIDES.length - 1];
  const clamp = (value, extent, span) => Math.max(HINT_EDGE, Math.min(value, extent - HINT_EDGE - span));
  const sideways = side === 'right' || side === 'left';
  let left;
  let top;
  if (sideways) {
    left = side === 'right' ? target.right + HINT_GAP : target.left - HINT_GAP - size.width;
    top = clamp(target.top + target.height / 2 - size.height / 2, view.height, size.height);
  } else {
    left = clamp(target.left + target.width / 2 - size.width / 2, view.width, size.width);
    top = side === 'above' ? target.top - HINT_GAP - size.height : target.bottom + HINT_GAP;
  }
  const span = sideways ? size.height : size.width;
  const center = sideways ? target.top + target.height / 2 : target.left + target.width / 2;
  const origin = sideways ? top : left;
  const inset = Math.min(HINT_TAIL_INSET, span / 2);
  const tail = Math.max(inset, Math.min(center - origin, span - inset));
  return { side, left: Math.round(left), top: Math.round(top), tail: Math.round(tail) };
}

// The control's rectangle, moved out of the window's coordinates and into the app's, which is the space the placement above and the bubble's own `left` are both written in.
function hintTargetInApp(rect, app) {
  return {
    left: rect.left - app.left,
    right: rect.right - app.left,
    top: rect.top - app.top,
    bottom: rect.bottom - app.top,
    width: rect.width,
    height: rect.height,
  };
}

function hideHintBubble() {
  if (hintWatched) {
    hintWatched.element.removeEventListener('pointerenter', hintWatched.onEnter);
    hintWatched = null;
  }
  if (!hintBubble) return;
  const bubble = hintBubble;
  hintBubble = null;
  hintShowing = null;
  bubble.classList.remove('is-shown');
  // Long enough for the fade to finish; the box is inert either way, and under Reduce Motion the stylesheet has already zeroed the transition.
  window.setTimeout(() => bubble.remove(), 400);
}

// Met, and permanently: the pointer reached the control, or the control was used.
function retireHint(name) {
  if (!hintsSeen.has(name)) {
    hintsSeen.add(name);
    saveHintState();
  }
  if (hintShowing === name) hideHintBubble();
}

// Whether a name has been met. Not every once-per-install promise is a bubble — the pane's vault introduction is a box that has to outlive a pointer — so the met list is readable by whatever draws one, while the pacing above stays the bubble's alone.
function hintIsMet(name) {
  return hintsSeen.has(name);
}

// A sheet is coming up, so the bubble goes and its name stays unmet. Nothing is spent: the launch was counted when it drew, and the reader still has this one to meet it in once the sheet is gone.
function suspendHintForSheet(sheet) {
  if (HINTS_OFF || !sheet) return;
  hintSheets.add(sheet);
  if (!hintShowing) return;
  hintSuspended = hintShowing;
  hideHintBubble();
}

// Whether any of them is still on the window, asked of the sheets themselves rather than of a tally of closes: the flowchart editor hides its own shape picker instead of closing it, so a count would wait for ever on a close nobody is going to make.
function hintSheetsStanding() {
  for (const sheet of [...hintSheets]) {
    if (sheet.hidden) hintSheets.delete(sheet);
  }
  return hintSheets.size > 0;
}

// A sheet has finished leaving. The held bubble comes back only once the last one has gone and only while its name is still unmet, and it is measured again rather than put back where it was, because a sheet can leave the pane behind it a different shape.
function restoreHintAfterSheet(sheet) {
  if (HINTS_OFF) return;
  if (sheet) hintSheets.delete(sheet);
  const name = hintSuspended;
  if (!name || hintSheetsStanding()) return;
  hintSuspended = null;
  if (hintsSeen.has(name)) return;
  const hint = hintRegistry.get(name);
  if (!hint) return;
  const target = hintTarget(hint);
  if (!target) return;
  drawHintBubble(hint, target);
}

function drawHintBubble(hint, target) {
  hideHintBubble();
  const { element, rect: targetRect } = target;
  const bubble = document.createElement('div');
  bubble.className = 'hint-bubble';
  // `status` rather than `alert`: worth saying, not worth interrupting.
  bubble.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'hint-bubble-text';
  text.textContent = hint.text;
  const tail = document.createElement('span');
  tail.className = 'hint-bubble-tail';
  bubble.appendChild(text);
  bubble.appendChild(tail);
  appSurface.appendChild(bubble);
  const rect = bubble.getBoundingClientRect();
  const app = leafAppRect();
  const placement = hintPlacement(hintTargetInApp(targetRect, app), { width: rect.width, height: rect.height }, { width: app.width, height: app.height });
  bubble.classList.add('is-' + placement.side);
  bubble.style.left = placement.left + 'px';
  bubble.style.top = placement.top + 'px';
  bubble.style.setProperty('--hint-tail', placement.tail + 'px');
  hintBubble = bubble;
  hintShowing = hint.name;
  // The pointer reaching the control is the reader noticing, so the hint is met right then. Watched on the control and not on the box: a pointer crossing the box on its way somewhere else would lose the words mid-sentence.
  const onEnter = () => retireHint(hint.name);
  hintWatched = { element, onEnter };
  element.addEventListener('pointerenter', onEnter);
  // A frame later, so the rise has a start state to move away from.
  window.requestAnimationFrame(() => bubble.classList.add('is-shown'));
}

// The one hint this launch could show: the first registered that has not been met. Never the next one down — the order they are registered in is the order they are meant to be met, so skipping ahead shows the second hint first.
function nextHint() {
  for (const hint of hintRegistry.values()) {
    if (!hintsSeen.has(hint.name)) return hint;
  }
  return null;
}

// A launch of rest between bubbles: back to back is the fatigue this is shaped around avoiding, and the same hint twice running is the same fatigue. A mark of zero means nothing has shown, so a first launch is never held back.
function hintLaunchIsQuiet(launch) {
  return hintLastLaunch !== 0 && launch < hintLastLaunch + 2;
}

// The whole pass, run once at boot: pick the hint, and spend the launch only if there was something to point at. A quiet launch still spends one — it is the rest, not a launch that did not happen.
function runHintPass() {
  if (HINTS_OFF) return;
  const hint = nextHint();
  if (!hint) return;
  const target = hintTarget(hint);
  if (!target) return;
  hintLaunches += 1;
  const quiet = hintLaunchIsQuiet(hintLaunches);
  if (!quiet) hintLastLaunch = hintLaunches;
  saveHintState();
  if (!quiet) drawHintBubble(hint, target);
}

// Draw one on demand, whatever the flags say, so a bubble can be looked at without a fresh install. Reachable through `eval` with no window focus.
window.leafShowHint = (name) => {
  const hint = hintRegistry.get(name);
  if (!hint) return false;
  const target = hintTarget(hint);
  if (!target) return false;
  drawHintBubble(hint, target);
  return true;
};

// Back to a first launch, through the same command that saves the real thing.
window.leafResetHints = () => {
  hintsSeen.clear();
  hintLaunches = 0;
  hintLastLaunch = 0;
  hintSheets.clear();
  hintSuspended = null;
  saveHintState();
  hideHintBubble();
  return true;
};
