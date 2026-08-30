// The library pane opens no narrower than the app bar's left zone, and the drag keeps its own range.

import { join } from 'node:path';
import {
  VIEW_HEIGHT,
  VIEW_WIDTH,
  check,
  record,
  runShell,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 3a2. the pane opens no narrower than the bar's left zone ---------------
  //
  // That zone is sized to the pane so the tab strip begins at the pane's edge, and floored at the buttons standing in it — so a pane that opens inside the floor leaves the tabs over the page with nothing pressed. That is where a Mac starts: the window's own three dots stand in the zone and take it past the 240px a pane opens at. Opening only, which is the whole shape of the fix: flooring the drag as well takes the narrow pane away from Windows, where nothing was ever wrong, so the drag's own range is checked here beside it.

  /** The bar's left zone on each platform, read off the running app: the leaf, the library toggle and the two history arrows, plus a Mac's three window dots and the gap before them. */
  const WINDOWS_LEAD = 187.33;
  const MAC_LEAD = 247.33;

  /** A booted page with the bar's left zone at `leadWidth` and a window with room for both a pane and a reader. */
  function bootWithLead(leadWidth, settings = {}) {
    const context = runShell(source, { __leafLeadWidth: leadWidth, __leafSettings: settings });
    context.document.getElementById('libraryShell').clientWidth = VIEW_WIDTH;
    return context;
  }

  /** What the page last wrote as the pane's width: one var moves the pane, the tabs and the divider together. */
  const railWidth = (context) => context.document.documentElement.style.getPropertyValue('--library-rail-width');

  check('a pane opens on the edge of the bar left zone wherever that zone is the wider', () => {
    const mac = bootWithLead(MAC_LEAD);
    // Shut, then open: the width a toggle opens at is the one a reader meets after using the button.
    mac.toggleLibrary();
    mac.toggleLibrary();
    if (railWidth(mac) !== `${MAC_LEAD}px`) throw new Error(`a Mac opened its pane at ${railWidth(mac)}, inside its own window dots`);
    const windows = bootWithLead(WINDOWS_LEAD);
    windows.toggleLibrary();
    windows.toggleLibrary();
    if (railWidth(windows) !== '240px') throw new Error(`Windows opened its pane at ${railWidth(windows)} rather than the 240px it has always opened at`);
  });

  check('a pane left at the width it opens at is raised on the way back in, and a dragged one is not', () => {
    // A Mac that has been run before has 240 written down, so a rule that only moved the default would leave every existing Mac exactly where it was, with nothing to migrate it.
    const mac = bootWithLead(MAC_LEAD, { libraryWidth: 240 });
    mac.applyPaneLayout();
    if (railWidth(mac) !== `${MAC_LEAD}px`) throw new Error(`a saved width came back at ${railWidth(mac)}`);
    // A width a reader dragged to is theirs at any size, on either platform: raising it takes the narrow pane away one restart later.
    for (const [lead, platform] of [[WINDOWS_LEAD, 'Windows'], [MAC_LEAD, 'a Mac']]) {
      const context = bootWithLead(lead, { libraryWidth: 96 });
      context.applyPaneLayout();
      if (railWidth(context) !== '96px') throw new Error(`a 96px pane came back at ${railWidth(context)} on ${platform}`);
    }
  });

  check('a drag still reaches every width it reached before, and still snaps shut, and never takes the zone under its own buttons', () => {
    // Flooring the pane at the zone instead slams it shut while it is still a fifth of the window wide, so the drag's own range is held here. The zone underneath it is the other half: dragged inside the zone's own width, the zone holds at its buttons rather than following the pane down — which a Mac does not do on its own, drawing the tab strip over the leaf, the library button and both arrows instead.
    for (const [leadWidth, platform] of [[WINDOWS_LEAD, 'Windows'], [MAC_LEAD, 'a Mac']]) {
      const context = bootWithLead(leadWidth);
      const lead = context.document.querySelector('.app-bar-lead');
      const divider = context.document.getElementById('libraryDivider');
      const shell = context.document.getElementById('libraryShell');
      shell.getBoundingClientRect = () => ({ left: 0, top: 0, right: VIEW_WIDTH, bottom: VIEW_HEIGHT, width: VIEW_WIDTH, height: VIEW_HEIGHT });
      const pointer = (extra) => ({ pointerId: 7, button: 0, buttons: 1, clientY: 300, target: divider, preventDefault() {}, stopPropagation() {}, ...extra });
      // Every handler the page registered, in the order it registered them — the same walk the real page makes, so a drag here is a drag there.
      const raise = (type, event) => {
        for (const handler of [...(context.document.listeners.get(type) || [])]) handler(event);
      };
      for (const handler of [...(divider.listeners.get('pointerdown') || [])]) handler(pointer({ clientX: 247 }));
      raise('pointermove', pointer({ clientX: 96 }));
      context.__frames.drain();
      if (railWidth(context) !== '96px') throw new Error(`on ${platform} a pane dragged to 96px came to rest at ${railWidth(context)}`);
      // A number, never `fit-content`: the keyword is the one thing in the rule the two web views do not answer alike, and it is why a Mac gives the zone up.
      if (lead.style.minWidth !== `${leadWidth}px`) {
        throw new Error(`on ${platform} a pane dragged to 96px left the zone floored at ${lead.style.minWidth || 'nothing'} rather than its own ${leadWidth}px`);
      }
      // Past the snap: the pane closes, exactly as a drag to 40px always did.
      raise('pointermove', pointer({ clientX: 20 }));
      context.__frames.drain();
      if (railWidth(context) !== '0px') throw new Error(`on ${platform} a drag past the snap left the pane at ${railWidth(context)}`);
    }
  });

  // ---- 3a3. a release applies the width the drag was left at -----------------
  //
  // Width writes are thrown onto an animation frame so the pane's grid does not relay out on every pointer event, which is right. The release was not: it canceled the frame that was still pending and the last stretch of the drag went with it, so a hand that lets go the moment it stops leaves the pane short of the pointer — and the same short number is what `persistLibraryLayout` then saves, so it comes back that way. These two leave the frame queue alone on purpose: draining it after every move is what kept the drag check above from ever seeing this.

  /** A booted page with a divider that can be dragged and every command it sends recorded. */
  function dragStand(settings = {}) {
    const context = bootWithLead(WINDOWS_LEAD, settings);
    const divider = context.document.getElementById('libraryDivider');
    const shell = context.document.getElementById('libraryShell');
    shell.getBoundingClientRect = () => ({ left: 0, top: 0, right: VIEW_WIDTH, bottom: VIEW_HEIGHT, width: VIEW_WIDTH, height: VIEW_HEIGHT });
    const sent = [];
    context.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    const pointer = (clientX) => ({ pointerId: 7, button: 0, buttons: 1, clientX, clientY: 300, target: divider, preventDefault() {}, stopPropagation() {} });
    const raise = (type, clientX) => {
      for (const handler of [...(context.document.listeners.get(type) || [])]) handler(pointer(clientX));
    };
    const grab = (clientX) => {
      for (const handler of [...(divider.listeners.get('pointerdown') || [])]) handler(pointer(clientX));
    };
    /** The last layout the page saved, which is what reaches the settings file. */
    const saved = () => [...sent].reverse().find((one) => one.command === 'setLibraryLayout');
    return { context, grab, raise, saved };
  }

  check('a pane released between frames rests under the pointer, and saves that width', () => {
    const { context, grab, raise, saved } = dragStand();
    grab(247);
    // One move that got its frame, so the pane is somewhere real before the stretch that must not be lost.
    raise('pointermove', 320);
    context.__frames.drain();
    if (railWidth(context) !== '320px') throw new Error(`a drag to 320px with a frame behind it rested at ${railWidth(context)}`);
    // And the ordinary ending of a drag: a last move, then the release, with no frame in between.
    raise('pointermove', 430);
    const armed = [...context.__frames.queue.keys()];
    raise('pointerup', 430);
    if (railWidth(context) !== '430px') throw new Error(`a pointer released at 430px left the pane at ${railWidth(context)}`);
    const layout = saved();
    if (!layout || layout.width !== 430) throw new Error(`the release saved ${JSON.stringify(layout)} rather than a 430px pane`);
    // And the frame that move armed is gone rather than left waiting on a drag that is over. Named by its own id, not counted: the flush refits the breadcrumb, which arms a frame of its own, so a count answers the same either way. The flush also zeroes the drag's record of its frame, so the id has to be taken before the flush or there is nothing left to cancel.
    const stale = armed.filter((id) => context.__frames.queue.has(id));
    if (stale.length) throw new Error(`the release left the frame it armed waiting on a drag that had ended`);
  });

  check('a pointer canceled between frames rests under it too', () => {
    // A canceled pointer is a drag that ended without a release — the pane still belongs where the last move put it, not one frame behind.
    const { context, grab, raise, saved } = dragStand();
    grab(247);
    raise('pointermove', 320);
    context.__frames.drain();
    raise('pointermove', 505);
    raise('pointercancel', 505);
    if (railWidth(context) !== '505px') throw new Error(`a canceled pointer at 505px left the pane at ${railWidth(context)}`);
    const layout = saved();
    if (!layout || layout.width !== 505) throw new Error(`the cancel saved ${JSON.stringify(layout)} rather than a 505px pane`);
  });

  check('a drag past the snap closes the pane rather than resting on the sliver it was dragged away from', () => {
    // The snap is the one ending that must not take the pending width: what it holds is the last move still above the threshold, so a flush here saves a sliver the reader was dragging past, and the pane comes back as one.
    const { context, grab, raise, saved } = dragStand();
    grab(430);
    raise('pointermove', 430);
    context.__frames.drain();
    // Above the threshold, and never drawn — this is the value a flush would wrongly write.
    raise('pointermove', 120);
    raise('pointermove', 10);
    if (railWidth(context) !== '0px') throw new Error(`a drag past the snap left the pane at ${railWidth(context)}`);
    const layout = saved();
    if (!layout || layout.closed !== true) throw new Error(`a drag past the snap saved ${JSON.stringify(layout)} rather than a closed pane`);
    if (layout.width === 120) throw new Error('a drag past the snap saved the 120px sliver it was dragged away from');
  });

  check('the zone floor follows the buttons out of the bar and back in', () => {
    // One write is only enough because the floor is rewritten wherever the measurement behind it is thrown away. A fold takes two arrows out of the zone and the floor has to come down with them, or a narrow window keeps holding space for buttons that are in the chevron menu.
    const context = bootWithLead(MAC_LEAD, { libraryClosed: true });
    const lead = context.document.querySelector('.app-bar-lead');
    const bar = context.document.getElementById('appBar');
    const tabBar = context.document.getElementById('tabBar');
    const panel = context.document.getElementById('appOverflowPanel');
    // The fold leaves an open pane's zone whole, since folding out of a zone pinned to the rail frees nothing — so this is the closed bar, which is the only one that folds out of it.
    context.applyPaneLayout();
    const whole = lead.style.minWidth;
    if (whole !== `${MAC_LEAD}px`) throw new Error(`the zone booted floored at ${whole || 'nothing'} rather than its own ${MAC_LEAD}px`);
    // A bar that cannot fit, so the fold reaches past the trailing actions and into the zone's own arrows.
    tabBar.scrollWidth = 900;
    tabBar.clientWidth = 100;
    bar.scrollWidth = 900;
    bar.clientWidth = 100;
    context.refitAppBar();
    const folded = panel.children.map((el) => el.id);
    if (!folded.includes('backButton')) throw new Error(`the fold never reached the zone: it folded ${folded.join(',') || 'nothing'}`);
    if (!lead.style.minWidth || parseFloat(lead.style.minWidth) >= MAC_LEAD) {
      throw new Error(`two arrows folded out and the zone stayed floored at ${lead.style.minWidth || 'nothing'}`);
    }
    // And back: a widening window puts them where they were standing, and the floor with them.
    tabBar.scrollWidth = 0;
    tabBar.clientWidth = 900;
    bar.scrollWidth = 0;
    bar.clientWidth = 900;
    context.refitAppBar();
    if (lead.style.minWidth !== whole) throw new Error(`the arrows came back and the zone stayed floored at ${lead.style.minWidth || 'nothing'}`);
  });

  check('the open leaves the zone unmeasured, so the tab strip travels with the pane', () => {
    // The zone's own width is read by putting `width: auto` on it for one layout pass, and a width transition cannot start from `auto`. So the strip landed on its resting place on the very first frame while the page eased out and overshot past it, and the open tab's lower-left curve hung over the pane with daylight under it — the one motion a reader triggers by hand breaking at its most visible moment.
    const context = bootWithLead(MAC_LEAD, { libraryClosed: true });
    const lead = context.document.querySelector('.app-bar-lead');
    // Every width the zone is written, with whether the pane was moving when it was written — the claim is what the page did, not which branch it took.
    const written = [];
    let held = lead.style.width;
    Object.defineProperty(lead.style, 'width', {
      get: () => held,
      set: (value) => {
        held = value;
        written.push({ value, moving: context.libraryPaneIsMoving() });
      },
      configurable: true,
    });
    const measuredWhileMoving = () => written.filter((one) => one.value === 'auto' && one.moving).length;
    const measured = () => written.filter((one) => one.value === 'auto').length;
    context.applyPaneLayout();
    written.length = 0;
    context.toggleLibrary();
    if (!context.libraryPaneIsMoving()) throw new Error('the open never armed its motion');
    // Exactly one read arms the open — the layout pass before the classes land. A second one settling the motion lands between the flush and the class going up, which snapped the strip left on the first frame and left the page easing out on its own.
    if (measured() !== 1) throw new Error(`the open armed its motion on ${measured()} measurements of the zone rather than one`);
    // The read the open takes before it arms the motion must stay: it runs with no class up, so it starts no transition, and it is what leaves the floor fresh for the frames where the rail is still inside it.
    if (!written.some((one) => one.value === 'auto' && !one.moving)) {
      throw new Error('the open armed its motion on a floor nobody had measured');
    }
    if (measuredWhileMoving()) throw new Error('the zone was measured mid-open, so its width transition never started');
    // Held on the motion rather than on the toggle: a document finishing its render, the code view and the update bell all refit too, and any of them landing inside the open would kill the travel the same way.
    context.refitAppBar();
    if (measuredWhileMoving()) throw new Error('a refit inside the open measured the zone');
    // The close arms the same way, and it traveled correctly before any of this — a read settling it kills its travel outright.
    written.length = 0;
    context.toggleLibrary();
    if (measured() !== 0) throw new Error(`the close armed its motion on ${measured()} measurements of the zone rather than none`);
    if (measuredWhileMoving()) throw new Error('the zone was measured mid-close');
    // Deferred, never dropped: the motion ending is the one place the read is taken, and the floor comes back at the zone's own number.
    written.length = 0;
    context.endLibraryMotion();
    if (!written.some((one) => one.value === 'auto' && !one.moving)) {
      throw new Error('the motion ended and the held-back measurement was never taken');
    }
    if (lead.style.minWidth !== `${MAC_LEAD}px`) {
      throw new Error(`the pane stopped and the zone was left floored at ${lead.style.minWidth || 'nothing'} rather than its own ${MAC_LEAD}px`);
    }
  });

  check('a shut pane leaves the zone sized by its own buttons', () => {
    // The claim the change must not break: with no pane to match, the zone takes its width from what is standing in it and the stylesheet's own `width: auto` is the whole of that. So the floor is the same number and nothing pins a width over it.
    const context = bootWithLead(WINDOWS_LEAD, { libraryClosed: true });
    const lead = context.document.querySelector('.app-bar-lead');
    context.applyPaneLayout();
    context.refitAppBar();
    if (lead.style.width) throw new Error(`a shut pane left the zone pinned to ${lead.style.width}`);
    if (lead.style.minWidth !== `${WINDOWS_LEAD}px`) {
      throw new Error(`a shut pane left the zone floored at ${lead.style.minWidth || 'nothing'} rather than its own ${WINDOWS_LEAD}px`);
    }
  });
}
