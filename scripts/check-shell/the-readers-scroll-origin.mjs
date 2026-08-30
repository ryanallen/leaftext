// The correction that places a document's first line, and which of its measurements it pays for.
//
// The correction measures the document from the top, may write `--reader-scroll-origin`, and answers a measurement. Only the write earns a second read of the layout, and on a real page that read is the expensive one — so the checks below count the reads as well as the answer: a call that writes nothing must measure once, and a call that writes must answer the layout it moved rather than the one it found. The gap the first line is placed at is the same 88px the reading view lays out to.

import { bootReading, check, record, VIEW_WIDTH } from './shared.mjs';

export function run() {
  if (!record.booted) return;

  const GAP = 88;
  const DEEP = 10000;
  const VIEWPORT = 1000;

  /** A document open on a page of its own, with the geometry the correction reads wired to the origin it writes. `--reader-scroll-origin` is a negative top margin on the document body, so raising it by a pixel lifts the first line by a pixel — which is the coupling that makes the correction converge, and the one thing a fixed rectangle cannot stand in for. `natural` is where the first line would sit with no origin at all. Hands back the page, a count of the layout reads the correction has taken, and the origin as the page holds it. */
  function standTheCorrectionUp(natural) {
    const { context, app, body } = bootReading({ path: 'C:\\Notes\\long.md', blocks: [{ srcStart: 0, top: 0 }], height: DEEP, viewport: VIEWPORT });
    context.__frames.drain();
    const line = body.firstElementChild;
    const originOn = () => Number.parseFloat(body.style.getPropertyValue('--reader-scroll-origin')) || 0;
    let reads = 0;
    let top = natural;
    // Every measurement takes the shell's rect exactly once, so counting that rect counts the measurements.
    app.getBoundingClientRect = () => {
      reads += 1;
      return { left: 0, top: 0, right: VIEW_WIDTH, bottom: VIEWPORT, width: VIEW_WIDTH, height: VIEWPORT };
    };
    const boxAt = (deep) => () => {
      const at = top - originOn() - app.scrollTop;
      return { left: 0, top: at, right: VIEW_WIDTH, bottom: at + deep, width: VIEW_WIDTH, height: deep };
    };
    body.getBoundingClientRect = boxAt(DEEP);
    line.getBoundingClientRect = boxAt(400);
    return {
      context,
      body,
      origin: originOn,
      firstLineAt: () => top - originOn(),
      reflowTo: (next) => { top = next; },
      settle: (value) => body.style.setProperty('--reader-scroll-origin', `${value}px`),
      clear: () => body.style.setProperty('--reader-scroll-origin', ''),
      correct: () => {
        reads = 0;
        const answer = context.correctReaderScrollOrigin(body);
        return { answer, reads };
      },
    };
  }

  check('a correction that writes nothing measures the page once and answers that measurement', () => {
    const stand = standTheCorrectionUp(300);
    // Already settled: the first line sits at the gap, so the origin the correction computes is the one already there.
    stand.settle(300 - GAP);
    const { answer, reads } = stand.correct();
    if (reads !== 1) throw new Error(`a correction with nothing to write measured the page ${reads} times`);
    if (stand.origin() !== 300 - GAP) throw new Error(`the settled origin was rewritten to ${stand.origin()}`);
    if (answer.rawTopOffset !== GAP) throw new Error(`the correction answered a first line at ${answer.rawTopOffset} rather than the reading gap`);
    if (answer.topOffset !== 0) throw new Error(`the correction answered a top offset of ${answer.topOffset} rather than 0`);
  });

  check('a correction that writes answers the layout it moved rather than the one it found', () => {
    const stand = standTheCorrectionUp(300);
    // The state a first render is in: nothing carried over, so the first line sits 300 down and the correction has to lift it.
    stand.clear();
    const { answer, reads } = stand.correct();
    if (reads !== 2) throw new Error(`a correction that wrote measured the page ${reads} times, so it is answering the layout it found rather than the one it moved`);
    if (stand.origin() !== 300 - GAP) throw new Error(`the correction wrote an origin of ${stand.origin()} rather than the ${300 - GAP} that puts the first line at the gap`);
    if (answer.rawTopOffset !== GAP) throw new Error(`the correction answered ${answer.rawTopOffset}, which is the layout from before its own write`);
  });

  check('the document first line still sits at the reading gap after a re-layout', () => {
    const stand = standTheCorrectionUp(300);
    stand.clear();
    stand.correct();
    if (stand.firstLineAt() !== GAP) throw new Error(`the first line was left at ${stand.firstLineAt()} rather than the reading gap`);

    // Something above the document grows — a picture arriving, the bar unfolding — and the first line is pushed down again.
    stand.reflowTo(500);
    const reflowed = stand.correct();
    if (reflowed.reads !== 2) throw new Error(`the correction after a re-layout measured the page ${reflowed.reads} times, so it did not read back what it wrote`);
    if (stand.firstLineAt() !== GAP) throw new Error(`the re-layout left the first line at ${stand.firstLineAt()} rather than the reading gap`);
    if (reflowed.answer.rawTopOffset !== GAP) throw new Error(`the correction answered ${reflowed.answer.rawTopOffset} after the re-layout`);

    // And the pass after that has nothing to do: one measurement, the same answer, and the first line where the re-layout put it.
    const again = stand.correct();
    if (again.reads !== 1) throw new Error(`a settled page was measured ${again.reads} times`);
    if (again.answer.rawTopOffset !== GAP) throw new Error(`the settled answer moved to ${again.answer.rawTopOffset}`);
    if (stand.firstLineAt() !== GAP) throw new Error(`the settled pass moved the first line to ${stand.firstLineAt()}`);
  });
}
