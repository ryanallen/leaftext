// The flowchart editor draws on one thread, and the draw is the whole cost — about 6.7 ms a line, so a forty-line chart blocks the page for 387 ms. This file is about the draws that are never made: the wait that outlasts a keystroke, the picture already on the canvas, and the one the store still has. The drawing itself is diagram-canvas.mjs and the sheet around it is diagram-sheet.mjs.

import vm from 'node:vm';
import { check, checkSettled, record, settle } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  const read = (expression) => vm.runInContext(expression, booted);

  // Two boxes and a line: small enough that the draw is beside the point, and real enough to parse.
  const CHART = `flowchart TD
  A["a"] --> B["b"]`;

  // A sheet open on one small chart with mermaid standing in, so a draw is a call that can be counted rather than a round trip. `render` is handed the id mermaid is given, which is what sorts a diagram draw from the forty-seven shape pictures.
  function sheetOpenOnAChart(render) {
    const held = booted.window.mermaid;
    booted.window.mermaid = { initialize: () => {}, render };
    booted.window.__chartUnderTest = CHART;
    read('flowSession = { save: null, text: window.__chartUnderTest, graph: null }; flowSession.graph = parseFlow(flowSession.text);');
    return () => {
      booted.window.mermaid = held;
      read('flowSession = null; flowSelection = null; flowDiagramThemeVersion = 0; flowChipThemeVersion = 0;');
      read('flowChipCache.clear(); flowChipsAsked = false; flowDrawingStore.clear(); flowDrawingStoreHeld = 0;');
      read('flowCanvas.innerHTML = ""; flowPlaced = null; flowNatural = null; flowSize = null; flowDrawError = "";');
      booted.forgetFlowShapeGrid();
      booted.__frames.drain();
    };
  }

  // The one timer the redraw arms, and how long it was armed for.
  const armedWait = () => {
    const id = Number(read('flowDrawTimer'));
    const one = booted.__timers.armed().find((timer) => timer.id === id);
    return one ? one.delay : null;
  };

  // A hand typing `strokes` characters `gap` milliseconds apart, over a page whose timers only fire when a clock says they are due. Each keystroke queues a redraw; between keystrokes the wait either came up or it did not, which is the whole of what the pace decides.
  async function typedAt(gap, strokes, mark) {
    let clock = 0;
    let armed = null;
    const runIfDue = async () => {
      if (!armed || armed.at + armed.delay > clock) return;
      const due = armed;
      armed = null;
      booted.__timers.run(due.id);
      await settle();
    };
    for (let stroke = 0; stroke < strokes; stroke += 1) {
      // A character into the box's name: every stroke is a chart the canvas has genuinely never drawn.
      booted.window.__typedName = mark + 'x'.repeat(stroke + 1);
      read('flowSession.text = window.__chartUnderTest.replace("a", window.__typedName);');
      booted.queueFlowDiagram();
      armed = { id: Number(read('flowDrawTimer')), at: clock, delay: armedWait() };
      clock += gap;
      await runIfDue();
    }
    // The pause after the hand stops, which is where the one useful picture is drawn.
    clock += 10000;
    await runIfDue();
  }

  // Only the diagram's own draws; the shape pictures go through the same runtime and are not what any of this is about.
  const diagramDraws = (calls) => calls.filter((id) => String(id).startsWith('leafFlowDraw')).length;

  checkSettled('a theme change while the sheet is open draws the diagram again', async () => {
    const calls = [];
    let colors = 'light';
    const close = sheetOpenOnAChart((id) => {
      calls.push(id);
      return Promise.resolve({ svg: '<svg data-colors="' + colors + '"></svg>' });
    });
    try {
      booted.drawFlowDiagram();
      await settle();
      if (diagramDraws(calls) !== 1) throw new Error(`the first draw made ${diagramDraws(calls)} pictures`);
      colors = 'dark';
      booted.refreshFlowChipsForTheme();
      await settle();
      if (diagramDraws(calls) !== 2) throw new Error('a theme change refreshed the shape pictures and left the diagram in the old colors');
      if (!String(read('flowCanvas.innerHTML')).includes('data-colors="dark"')) {
        throw new Error('the canvas kept the picture drawn in the theme that was switched away from');
      }
    } finally {
      close();
    }
  });

  checkSettled('a draw that finishes after a theme change is dropped rather than painted', async () => {
    let answer = null;
    const close = sheetOpenOnAChart((id) => {
      if (!String(id).startsWith('leafFlowDraw')) return Promise.resolve({ svg: '<svg></svg>' });
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    try {
      booted.drawFlowDiagram();
      await settle();
      if (!answer) throw new Error('the draw never reached the runtime');
      const late = answer;
      answer = null;
      // The switch happens while that first draw is still out.
      booted.refreshFlowChipsForTheme();
      late({ svg: '<svg data-colors="the theme that was switched away from"></svg>' });
      await settle();
      if (String(read('flowCanvas.innerHTML')).includes('the theme that was switched away from')) {
        throw new Error('a draw begun before the theme change was painted after it');
      }
    } finally {
      if (answer) answer({ svg: '<svg></svg>' });
      await settle();
      close();
    }
  });

  check('the wait in front of a redraw is as long as the last draw took, and never shorter than the floor', () => {
    const close = sheetOpenOnAChart(() => Promise.resolve({ svg: '<svg></svg>' }));
    try {
      // A forty-line chart: the draw is longer than the old fixed wait, so the wait becomes the draw.
      read('flowLastDrawCost = 387;');
      booted.queueFlowDiagram();
      if (armedWait() !== 387) throw new Error(`a 387 ms draw queued the next redraw at ${armedWait()} rather than at 387`);
      // A five-line chart draws quicker than the floor, so nothing about the small-chart feel moves.
      read('flowLastDrawCost = 42;');
      booted.queueFlowDiagram();
      if (armedWait() !== 120) throw new Error(`a 42 ms draw queued the next redraw at ${armedWait()} rather than at the 120 ms floor`);
      // No ceiling: the property is worth most where the chart is biggest.
      read('flowLastDrawCost = 4000;');
      booted.queueFlowDiagram();
      if (armedWait() !== 4000) throw new Error(`a 4,000 ms draw was capped down to ${armedWait()}`);
    } finally {
      booted.__timers.run(Number(read('flowDrawTimer')));
      close();
    }
  });

  check('a wait in front of a picture already made is the floor rather than the last draw’s cost', () => {
    const close = sheetOpenOnAChart(() => Promise.resolve({ svg: '<svg></svg>' }));
    try {
      // An eighty-line chart's draw is what the wait would otherwise be, and it was watched costing an undo 433 ms in front of a 43 ms paint.
      read('flowLastDrawCost = 576;');
      // The undo: the store still holds the drawing of the text the session has just come back to.
      booted.keepFlowDrawing(CHART, 0, '<svg></svg>');
      booted.queueFlowDiagram();
      if (armedWait() !== 120) {
        throw new Error(`an undo onto a drawing the store already holds waited ${armedWait()} rather than the 120 ms floor`);
      }
      // The picture already on the canvas: the same question, answered by what was drawn rather than by the store.
      read('flowDrawingStore.clear(); flowDrawingStoreHeld = 0;');
      read('flowDrawn = { text: flowSession.text, themeVersion: flowDiagramThemeVersion };');
      booted.queueFlowDiagram();
      if (armedWait() !== 120) {
        throw new Error(`a redraw of the picture already on the canvas waited ${armedWait()} rather than the 120 ms floor`);
      }
      // Text neither of them has seen is a real draw, and the wait in front of that is still the last draw's cost.
      read('flowDrawn = null;');
      booted.window.__typedName = 'never drawn';
      read('flowSession.text = window.__chartUnderTest.replace("a", window.__typedName);');
      booted.queueFlowDiagram();
      if (armedWait() !== 576) {
        throw new Error(`a picture the page has never made waited ${armedWait()} rather than the 576 the last draw set`);
      }
    } finally {
      booted.__timers.run(Number(read('flowDrawTimer')));
      read('flowLastDrawCost = 0; flowDrawn = null;');
      close();
    }
  });

  check('a sheet opening forgets what the last one drew, so its first picture waits only the floor', () => {
    const held = booted.window.mermaid;
    booted.window.mermaid = { initialize: () => {}, render: () => Promise.resolve({ svg: '<svg></svg>' }) };
    try {
      // An eighty-line chart has just been closed, and its 576 ms is what the page is still holding.
      read('flowLastDrawCost = 576;');
      // With a drawing of this chart in hand the floor is what the shortcut gives anyway, so the reset would be read as working whether it ran or not.
      if (read('flowDrawingStore.size') !== 0) {
        throw new Error('the store already held a drawing, so the floor below says nothing about the reset the open makes');
      }
      // Through the open rather than through `sheetOpenOnAChart`, which writes the session straight in and would never reach the reset.
      booted.openFlowSheet({ title: 'Flowchart', text: CHART, save: () => true });
      if (armedWait() !== 120) {
        throw new Error(`a five-line chart opened after a 576 ms draw waited ${armedWait()} for its first picture rather than the 120 ms floor`);
      }
    } finally {
      booted.window.mermaid = held;
      booted.closeFlowSheet();
      booted.__frames.drain();
      booted.__timers.drain();
      read('flowLastDrawCost = 0; flowSession = null; flowSelection = null; flowDiagramThemeVersion = 0; flowChipThemeVersion = 0;');
      read('flowChipCache.clear(); flowChipsAsked = false; flowDrawingStore.clear(); flowDrawingStoreHeld = 0;');
      read('flowCanvas.innerHTML = ""; flowPlaced = null; flowNatural = null; flowSize = null; flowDrawError = "";');
      booted.forgetFlowShapeGrid();
    }
  });

  checkSettled('a draw inside one sheet still says how long the next wait in that same sheet is', async () => {
    const clock = booted.performance;
    // The two readings the draw takes either side of mermaid, so the one it records is 576.
    const readings = [0, 576];
    booted.performance = { now: () => (readings.length > 1 ? readings.shift() : readings[0]) };
    const close = sheetOpenOnAChart(() => Promise.resolve({ svg: '<svg></svg>' }));
    try {
      read('flowLastDrawCost = 0;');
      booted.drawFlowDiagram();
      await settle();
      // Queued over text that draw did not make, so what is read is the wait in front of a real draw rather than the floor a picture already in hand gets.
      booted.window.__typedName = 'not what was drawn';
      read('flowSession.text = window.__chartUnderTest.replace("a", window.__typedName);');
      booted.queueFlowDiagram();
      if (armedWait() !== 576) {
        throw new Error(`a 576 ms draw inside an open sheet queued the next redraw at ${armedWait()} rather than at 576, so the reset took the property away`);
      }
    } finally {
      booted.__timers.run(Number(read('flowDrawTimer')));
      booted.performance = clock;
      read('flowLastDrawCost = 0;');
      close();
    }
  });

  checkSettled('typing faster than the last draw took makes one picture rather than one a keystroke', async () => {
    const calls = [];
    const close = sheetOpenOnAChart((id) => {
      calls.push(id);
      return Promise.resolve({ svg: '<svg></svg>' });
    });
    try {
      // The watched run: seven characters 180 ms apart on a chart whose last draw took 387 ms.
      read('flowLastDrawCost = 387;');
      await typedAt(180, 7, 'slow');
      if (diagramDraws(calls) !== 1) throw new Error(`seven characters made ${diagramDraws(calls)} pictures rather than one`);

      // The same hand against the floor alone, which is the pace a fixed wait cannot keep up with.
      calls.length = 0;
      read('flowLastDrawCost = 0;');
      await typedAt(180, 7, 'quick');
      if (diagramDraws(calls) < 7) throw new Error('the floor alone should still let a fast hand outrun the wait, so this check is not watching what it thinks');
    } finally {
      close();
    }
  });

  checkSettled('a redraw on the text already drawn asks for nothing', async () => {
    const calls = [];
    const close = sheetOpenOnAChart((id) => {
      calls.push(id);
      return Promise.resolve({ svg: '<svg></svg>' });
    });
    try {
      booted.drawFlowDiagram();
      await settle();
      if (diagramDraws(calls) !== 1) throw new Error(`the first draw made ${diagramDraws(calls)} pictures`);
      // Leaving a picker field after typing in it: `change` fires a whole redraw on text nothing has touched since the last keystroke drew it.
      booted.drawFlowDiagram();
      await settle();
      if (diagramDraws(calls) !== 1) throw new Error('leaving a field redrew the picture already on the canvas');

      // The same text under a theme the picture was not drawn in is a different picture, so it is asked for.
      booted.refreshFlowChipsForTheme();
      await settle();
      if (diagramDraws(calls) !== 2) throw new Error('the same text after a theme change kept the old theme’s picture');
      booted.drawFlowDiagram();
      await settle();
      if (diagramDraws(calls) !== 2) throw new Error('the text drawn in the current theme was drawn a second time');
    } finally {
      close();
    }
  });

  checkSettled('a sheet reopened on the text the last one closed on still fills its canvas', async () => {
    const held = booted.window.mermaid;
    booted.window.mermaid = { initialize: () => {}, render: () => Promise.resolve({ svg: '<svg data-drawn="yes"></svg>' }) };
    const open = async () => {
      booted.openFlowSheet({ title: 'Flowchart', text: CHART, save: () => true });
      booted.__frames.drain();
      booted.__timers.drain();
      await settle();
    };
    try {
      await open();
      if (!String(read('flowCanvas.innerHTML')).includes('data-drawn="yes"')) throw new Error('the sheet opened on an empty canvas');
      booted.closeFlowSheet();
      booted.__frames.drain();
      booted.__timers.drain();
      // Whatever the canvas was holding is gone by the time the editor is wanted again.
      read('flowCanvas.innerHTML = "";');
      await open();
      if (!String(read('flowCanvas.innerHTML')).includes('data-drawn="yes"')) {
        throw new Error('a reopened sheet took the shut one’s drawing as the picture already on screen and left the canvas empty');
      }
    } finally {
      booted.window.mermaid = held;
      booted.closeFlowSheet();
      booted.__frames.drain();
      booted.__timers.drain();
      read('flowSession = null; flowSelection = null; flowDiagramThemeVersion = 0; flowChipThemeVersion = 0;');
      read('flowChipCache.clear(); flowChipsAsked = false; flowDrawingStore.clear(); flowDrawingStoreHeld = 0; flowCanvas.innerHTML = ""; flowPlaced = null; flowNatural = null; flowSize = null; flowDrawError = "";');
      booted.forgetFlowShapeGrid();
    }
  });

  checkSettled('going back to text drawn a moment ago puts the kept drawing back rather than laying it out again', async () => {
    const calls = [];
    const close = sheetOpenOnAChart((id) => {
      calls.push(id);
      return Promise.resolve({ svg: '<svg data-picture="' + calls.length + '"></svg>' });
    });
    try {
      booted.drawFlowDiagram();
      await settle();
      // A box added on the canvas, then the step undone — which is the text that was on screen a moment ago.
      booted.window.__typedName = 'edited';
      read('flowSession.text = window.__chartUnderTest.replace("a", window.__typedName);');
      booted.drawFlowDiagram();
      await settle();
      if (diagramDraws(calls) !== 2) throw new Error(`the edit made ${diagramDraws(calls)} pictures rather than one`);
      read('flowSession.text = window.__chartUnderTest;');
      booted.drawFlowDiagram();
      await settle();
      if (diagramDraws(calls) !== 2) throw new Error('the undo laid the diagram out again rather than putting the kept drawing back');
      if (!String(read('flowCanvas.innerHTML')).includes('data-picture="1"')) {
        throw new Error('the undo left the canvas showing the picture of the edit it undid');
      }
    } finally {
      close();
    }
  });

  check('the store is bounded by how much drawing it holds, oldest first', () => {
    const close = sheetOpenOnAChart(() => Promise.resolve({ svg: '<svg></svg>' }));
    try {
      const cap = read('FLOW_DRAWING_STORE_CAP');
      const big = '<svg>' + 'y'.repeat(Math.round(cap * 0.4)) + '</svg>';
      for (const name of ['first', 'second', 'third']) booted.keepFlowDrawing(name, 0, big);
      if (read('flowDrawingStoreHeld') > cap) throw new Error('the store grew past its bound');
      if (read('flowDrawingStore.size') !== 2) throw new Error(`the store kept ${read('flowDrawingStore.size')} drawings rather than the two that fit`);
      if (read('flowDrawingStore.has(flowDrawingKey("first", 0))')) throw new Error('the oldest drawing was not the one dropped');
      if (!read('flowDrawingStore.has(flowDrawingKey("third", 0))')) throw new Error('the newest drawing was dropped');

      // One drawing bigger than the whole bound is never kept — keeping it would empty the store to hold nothing else.
      const wasHeld = read('flowDrawingStoreHeld');
      booted.keepFlowDrawing('enormous', 0, '<svg>' + 'y'.repeat(cap + 1) + '</svg>');
      if (read('flowDrawingStore.has(flowDrawingKey("enormous", 0))')) throw new Error('a drawing bigger than the bound was kept');
      if (read('flowDrawingStoreHeld') !== wasHeld) throw new Error('a drawing bigger than the bound emptied the store on its way past');
    } finally {
      close();
    }
  });

  checkSettled('a chart whose one drawing is bigger than the bound is still drawn', async () => {
    const cap = read('FLOW_DRAWING_STORE_CAP');
    const close = sheetOpenOnAChart(() => Promise.resolve({ svg: '<svg data-enormous="yes">' + 'y'.repeat(cap + 1) + '</svg>' }));
    try {
      booted.drawFlowDiagram();
      await settle();
      if (!String(read('flowCanvas.innerHTML')).includes('data-enormous="yes"')) throw new Error('a chart too big to keep was not drawn at all');
      if (read('flowDrawingStore.size')) throw new Error('a drawing bigger than the bound was kept after all');
    } finally {
      close();
    }
  });

  checkSettled('a theme change empties the store', async () => {
    const close = sheetOpenOnAChart(() => Promise.resolve({ svg: '<svg></svg>' }));
    try {
      booted.drawFlowDiagram();
      await settle();
      if (!read('flowDrawingStore.size')) throw new Error('a drawing was never kept, so this check is not watching what it thinks');
      booted.refreshFlowChipsForTheme();
      await settle();
      // The picture drawn for the new theme is kept; what the old one left behind is not.
      if (read('flowDrawingStoreHeld') !== read('[...flowDrawingStore.values()].reduce((all, one) => all + one.length, 0)')) {
        throw new Error('the store’s own count of what it holds does not match what is in it');
      }
      if (read('[...flowDrawingStore.keys()].some((key) => key.startsWith("0\\n"))')) {
        throw new Error('a drawing made under the theme that was switched away from is still in the store');
      }
    } finally {
      close();
    }
  });
}
