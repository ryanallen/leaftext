// What the canvas measures out of mermaid's drawing, and what a pointer can reach in it. The sheet around it is diagram-sheet.mjs; this file is the drawing itself — a corner probed off a shape, a wheel notch that must not go back to the page for it, the wide invisible copy a line is actually hit on, what the sentence above the canvas says about whatever is under the pointer, and the line a box draws back to itself.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { check, fakeElement, record, root, SHEET_FRAGMENTS } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // The ring around a selected box stands 8px off the shape and follows its corners — nested corners in reverse, so the outer radius is the inner plus the gap. Mermaid builds its shapes with rough.js, so there is no `rx` to read and the inner radius is measured: walk in along the corner's diagonal until the fill starts. Turning that distance back into a radius is the part that is easy to get wrong and invisible when it is.
  check('a corner radius is recovered from how far in the fill starts', () => {
    const { flowCornerRadiusFrom } = booted;
    // A circular corner of radius r has its center at (r, r), so along the diagonal the fill begins at t = r(1 − 1/√2). Feed that t back in.
    const insetFor = (radius) => radius * (1 - Math.SQRT1_2);
    for (const radius of [0, 5, 20, 28, 30, 64]) {
      const got = flowCornerRadiusFrom(insetFor(radius));
      if (Math.abs(got - radius) > 0.001) {
        throw new Error(`a corner of ${radius} came back as ${got.toFixed(2)}`);
      }
    }
    // The wrong constant — the Euclidean gap r(√2 − 1) — is out by exactly √2, which reads as "the ring did nothing" rather than as a broken number.
    const wrong = insetFor(28) / (Math.SQRT2 - 1);
    if (Math.abs(wrong - 28) < 0.001) throw new Error('the two constants are indistinguishable');

    // And a pill: its inner radius is half its height, so the ring around it — half its height plus the gap — is exactly half the ring's own height.
    const gap = 8;
    const height = 56;
    const ring = flowCornerRadiusFrom(insetFor(height / 2)) + gap;
    if (Math.abs(ring - (height + gap * 2) / 2) > 0.001) throw new Error('a pill does not stay a pill');
  });

  // The radius belongs to a drawing; zoom stays outside the cache.
  check('a corner is probed once per drawing, and the held radius still follows the zoom', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const canvas = read('flowCanvas');
    if (!canvas) throw new Error('the page has no flow canvas');
    const names = ['A', 'B', 'C', 'D'];
    const radii = [0, 5, 12, 28];
    let probes = 0;
    // Match Mermaid's node group, outline, and label plate.
    const drawing = () => {
      const stage = fakeElement('');
      stage.classList.add('flow-stage');
      const svg = fakeElement('');
      svg.tagName = 'svg';
      svg.createSVGPoint = () => ({ x: 0, y: 0 });
      stage.appendChild(svg);
      radii.forEach((radius, at) => {
        const group = fakeElement('flowchart-' + names[at] + '-0');
        group.tagName = 'g';
        group.classList.add('node');
        group.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 56, width: 120, height: 56 });
        const plate = fakeElement('');
        plate.tagName = 'rect';
        plate.getBBox = () => ({ x: 20, y: 16, width: 80, height: 24 });
        const outline = fakeElement('');
        outline.tagName = 'path';
        outline.getBBox = () => ({ x: 0, y: 0, width: 120, height: 56 });
        outline.ownerSVGElement = svg;
        // A circular corner begins on the diagonal at the searched inset.
        const inset = radius * (1 - Math.SQRT1_2);
        outline.isPointInFill = (point) => {
          probes += 1;
          return point.x >= inset;
        };
        group.appendChild(plate);
        group.appendChild(outline);
        svg.appendChild(group);
      });
      return stage;
    };
    const graph = { nodes: names.map((id) => ({ id })), edges: [], groups: [] };
    const first = drawing();
    try {
      read(`flowSession = { save: null, text: '', graph: ${JSON.stringify(graph)} };`);
      read('flowZoom = 1;');
      canvas.appendChild(first);
      booted.measureFlowDiagram();
      const cost = probes;
      if (!cost) throw new Error('the first measurement asked the drawing nothing');
      const drawn = read('flowPlaced').nodes.map((node) => node.radius);
      radii.forEach((radius, at) => {
        if (Math.abs(drawn[at] - radius) > 0.05) throw new Error(`a corner of ${radius} was measured as ${drawn[at].toFixed(3)}`);
      });

      // A drawing's cached radii answer again without probing.
      probes = 0;
      booted.measureFlowDiagram();
      if (probes) throw new Error(`measuring the same drawing again went back for ${probes} fill tests`);
      const again = read('flowPlaced').nodes.map((node) => node.radius);
      if (again.join() !== drawn.join()) throw new Error(`the held radii came back as ${again.join(', ')} rather than ${drawn.join(', ')}`);

      // Zoom and the pill clamp apply after the cached reading.
      for (const zoom of [0.5, 1.5, 2.5]) {
        probes = 0;
        read(`flowZoom = ${zoom};`);
        booted.measureFlowDiagram();
        if (probes) throw new Error(`a zoom to ${zoom} went back for ${probes} fill tests`);
        const scaled = read('flowPlaced').nodes.map((node) => node.radius);
        radii.forEach((radius, at) => {
          const want = Math.min(radius * zoom, 28);
          if (Math.abs(scaled[at] - want) > 0.05) throw new Error(`at ${zoom} a corner of ${radius} read ${scaled[at].toFixed(3)} rather than ${want}`);
        });
      }

      // Fresh groups need fresh probes.
      read('flowZoom = 1;');
      first.remove();
      canvas.appendChild(drawing());
      probes = 0;
      booted.measureFlowDiagram();
      if (probes !== cost) throw new Error(`a new drawing took ${probes} fill tests where the first took ${cost}`);
    } finally {
      read('flowSession = null;');
      read('flowPlaced = null;');
      read('flowZoom = 1;');
      for (const stage of [...canvas.querySelectorAll('.flow-stage')]) stage.remove();
    }
  });

  // A zoom step shows the same drawing bigger. Mermaid has not laid anything out again, so reading every box, group and line off the SVG a second time buys nothing and costs a layout pass per notch — and the notches arrive faster than the screen draws. The measurements are kept in mermaid's own coordinates and multiplied by the zoom, so a notch is arithmetic.
  check('a wheel notch scales the measured drawing rather than reading it again', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const canvas = read('flowCanvas');
    if (!canvas) throw new Error('the page has no flow canvas');
    let rectReads = 0;
    // One box, one group around it and one line: everything the measurement records.
    const drawing = () => {
      const stage = fakeElement('');
      stage.classList.add('flow-stage');
      const counted = (rect) => () => {
        rectReads += 1;
        return rect;
      };
      stage.getBoundingClientRect = counted({ top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200 });
      const svg = fakeElement('');
      svg.tagName = 'svg';
      svg.setAttribute('viewBox', '0 0 300 200');
      svg.createSVGPoint = () => ({ x: 0, y: 0 });
      stage.appendChild(svg);

      const group = fakeElement('flowchart-A-0');
      group.tagName = 'g';
      group.classList.add('node');
      group.getBoundingClientRect = counted({ top: 40, left: 60, right: 180, bottom: 96, width: 120, height: 56 });
      const outline = fakeElement('');
      outline.tagName = 'path';
      outline.getBBox = () => ({ x: 0, y: 0, width: 120, height: 56 });
      outline.ownerSVGElement = svg;
      const inset = 12 * (1 - Math.SQRT1_2);
      outline.isPointInFill = (point) => point.x >= inset;
      group.appendChild(outline);
      svg.appendChild(group);

      const cluster = fakeElement('box');
      cluster.tagName = 'g';
      cluster.classList.add('cluster');
      cluster.getBoundingClientRect = counted({ top: 20, left: 40, right: 220, bottom: 130, width: 180, height: 110 });
      svg.appendChild(cluster);

      const line = fakeElement('');
      line.tagName = 'path';
      line.setAttribute('data-id', 'L_A_B_0');
      line.getTotalLength = () => 100;
      line.getScreenCTM = () => ({});
      line.getPointAtLength = (length) => {
        const at = { x: 10 + length, y: 70, matrixTransform: () => at };
        return at;
      };
      svg.appendChild(line);

      const overlay = fakeElement('');
      overlay.classList.add('flow-overlay');
      stage.appendChild(overlay);
      return stage;
    };
    const graph = {
      direction: 'LR',
      nodes: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
      edges: [{ id: 'e1', from: 'A', to: 'B' }],
      groups: [{ id: 'box', text: 'box' }],
    };
    const spin = (deltaY) => {
      for (const handler of [...(canvas.listeners.get('wheel') || [])]) {
        handler({ ctrlKey: true, deltaY, preventDefault() {} });
      }
    };
    // Every number the overlay and the pointer read, flattened so two placements can be compared whole.
    const placement = () => {
      const placed = read('flowPlaced');
      if (!placed) throw new Error('nothing was placed');
      const node = placed.nodes[0];
      const group = placed.groups[0];
      const edge = placed.edges[0];
      if (!node || !group || !edge) throw new Error('a box, a group or a line went missing');
      return [
        node.x, node.y, node.width, node.height, node.radius,
        group.x, group.y, group.width, group.height,
        edge.from.x, edge.from.y, edge.at.x, edge.at.y, edge.to.x, edge.to.y,
      ];
    };
    const first = drawing();
    try {
      read(`flowSession = { save: null, text: '', graph: ${JSON.stringify(graph)} };`);
      read('flowZoom = 1;');
      canvas.appendChild(first);
      booted.measureFlowDiagram();
      if (!rectReads) throw new Error('the first measurement read nothing off the drawing');
      read("flowSelection = { kind: 'edge', id: 'e1' };");
      booted.drawFlowOverlay();
      const overlay = first.querySelector('.flow-overlay');
      if (!overlay) throw new Error('the drawing has no overlay');
      const furniture = () => {
        const all = [];
        const visit = (element) => {
          all.push(element);
          for (const child of element.children) visit(child);
        };
        for (const child of overlay.children) visit(child);
        return all;
      };
      const standing = furniture();
      if (!standing.length) throw new Error('the first overlay built no furniture');
      const life = placement();
      // The box sits 60 across and 40 down from the stage, is 120 by 56, and its corners were probed at 12.
      const want = [60, 40, 120, 56, 12, 40, 20, 180, 110, 10, 70, 60, 70, 110, 70];
      want.forEach((number, at) => {
        if (Math.abs(life[at] - number) > 0.05) throw new Error(`at life size the drawing measured ${life[at].toFixed(2)} where ${number} was drawn`);
      });

      // Two notches in, two back out — the path a hand on the wheel takes.
      let zoom = 1;
      for (const step of [1.1, 1.1, 1 / 1.1, 1 / 1.1, 1.1]) {
        zoom *= step;
        rectReads = 0;
        spin(step > 1 ? -120 : 120);
        if (rectReads) throw new Error(`a wheel notch went back to the drawing for ${rectReads} measurements`);
        const at = read('flowZoom');
        if (Math.abs(at - zoom) > 0.001) throw new Error(`the wheel reached ${at} rather than ${zoom}`);
        const after = furniture();
        if (after.length !== standing.length || after.some((element, spot) => element !== standing[spot])) {
          throw new Error('a wheel notch rebuilt the overlay furniture');
        }
        const scaled = placement();
        life.forEach((number, spot) => {
          if (Math.abs(scaled[spot] - number * at) > 0.05) {
            throw new Error(`at ${at.toFixed(3)} a measurement of ${number} was placed at ${scaled[spot].toFixed(2)} rather than ${(number * at).toFixed(2)}`);
          }
        });
      }

      // The line the overlay colors and the pointer matches on is the element mermaid drew, not a copy of it.
      if (read('flowPlaced').edges[0].path !== read('flowNatural').edges[0].path) {
        throw new Error('the placed line lost the path it was measured off');
      }

      // A fresh drawing is the one thing that does measure again.
      first.remove();
      canvas.appendChild(drawing());
      rectReads = 0;
      booted.measureFlowDiagram();
      if (!rectReads) throw new Error('a fresh render measured nothing');
      booted.drawFlowOverlay();
      const redrawn = [...canvas.querySelectorAll('.flow-overlay')][0];
      if (!redrawn || !redrawn.children.length || redrawn.children[0] === standing[0]) {
        throw new Error('a redraw kept overlay furniture from the old drawing');
      }

      // And a canvas with no drawing on it drops the coordinates as well as the placement, or the next notch would put handles back over a diagram that has gone.
      for (const stage of [...canvas.querySelectorAll('.flow-stage')]) stage.remove();
      booted.measureFlowDiagram();
      spin(-120);
      if (read('flowPlaced') || read('flowNatural')) throw new Error('an empty canvas kept its measurements');
    } finally {
      read('flowSession = null;');
      read('flowPlaced = null;');
      read('flowNatural = null;');
      read('flowSize = null;');
      read('flowZoom = 1;');
      read('flowSelection = null;');
      for (const stage of [...canvas.querySelectorAll('.flow-stage')]) stage.remove();
    }
  });

  // A line's drawn ink is one pixel across, so a click a pixel to either side of it landed on empty canvas and choosing a line was aim rather than intent. The measurement lays a wide copy of each line beside it, painted with nothing, purely to be hit. The copy must never carry `data-id`: the measuring pass looks a line up by that name, so a copy wearing one could be measured in place of the line and the overlay would then color something nobody can see.
  check('every line gets a wide invisible copy to be hit on, and no copy outlives its line', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const canvas = read('flowCanvas');
    const drawing = (names) => {
      const stage = fakeElement('');
      stage.classList.add('flow-stage');
      stage.getBoundingClientRect = () => ({ top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200 });
      const svg = fakeElement('');
      svg.tagName = 'svg';
      stage.appendChild(svg);
      // The one group mermaid draws every line into. The copies go in here beside the lines, which is why they need no coordinates of their own.
      const holder = fakeElement('');
      holder.tagName = 'g';
      holder.classList.add('edgePaths');
      svg.appendChild(holder);
      for (const name of names) {
        const line = fakeElement('');
        line.tagName = 'path';
        line.setAttribute('data-id', name);
        line.setAttribute('style', 'stroke: #333');
        line.setAttribute('marker-end', 'url(#arrow)');
        line.getTotalLength = () => 100;
        line.getScreenCTM = () => ({});
        line.getPointAtLength = (length) => {
          const at = { x: 10 + length, y: 70, matrixTransform: () => at };
          return at;
        };
        holder.appendChild(line);
      }
      const overlay = fakeElement('');
      overlay.classList.add('flow-overlay');
      stage.appendChild(overlay);
      return stage;
    };
    const graph = {
      direction: 'TD',
      nodes: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }],
      edges: [{ id: 'e1', from: 'A', to: 'B' }, { id: 'e2', from: 'B', to: 'C' }],
      groups: [],
    };
    const copies = () => [...canvas.querySelectorAll('path[data-flow-hit]')];
    try {
      read(`flowSession = { save: null, text: '', graph: ${JSON.stringify(graph)} };`);
      read('flowZoom = 1;');
      const first = drawing(['L_A_B_0', 'L_B_C_0']);
      canvas.appendChild(first);
      booted.measureFlowDiagram();

      const made = copies();
      if (made.length !== 2) throw new Error(`${made.length} copies were laid for two lines`);
      const named = made.map((copy) => copy.getAttribute('data-flow-hit')).sort().join(',');
      if (named !== 'e1,e2') throw new Error(`the copies answer to ${named} rather than to the two lines`);
      for (const copy of made) {
        if (copy.getAttribute('data-id')) throw new Error('a copy carries `data-id`, so the measurement could take it for a line');
        if (copy.id) throw new Error('a copy kept the line’s id');
        if (copy.getAttribute('marker-end')) throw new Error('a copy kept the arrowhead it is meant to be invisible behind');
        if (copy.getAttribute('style')) throw new Error('a copy kept mermaid’s own paint, which its own rule cannot then beat');
        if (!copy.classList.contains('flow-edge-hit')) throw new Error('a copy is not wearing the rule that paints it with nothing');
      }

      // The pointer reads the copy and answers the line, which is the whole point of laying one.
      const answered = read('flowEdgeUnder')(made[0]);
      if (answered !== made[0].getAttribute('data-flow-hit')) {
        throw new Error(`the pointer read the copy as ${answered} rather than as the line it stands for`);
      }
      // And the line itself still answers, so a hit on the ink is the same hit.
      const line = read('flowPlaced').edges[0];
      if (read('flowEdgeUnder')(line.path) !== line.id) throw new Error('the line stopped answering once a copy stood beside it');
      // The measurement kept mermaid's own path rather than the copy.
      if (line.path.getAttribute('data-flow-hit')) throw new Error('the measurement measured a copy instead of a line');

      // A diagram drawn again lays fresh copies and leaves none of the old ones behind, or a target sits where a line used to be.
      const before = copies();
      booted.measureFlowDiagram();
      const after = copies();
      if (after.length !== 2) throw new Error(`a second measurement left ${after.length} copies for two lines`);
      if (after.some((copy) => before.includes(copy))) throw new Error('a copy survived a redraw');

      // One line fewer: the copy for the line that has gone goes with it.
      first.remove();
      canvas.appendChild(drawing(['L_A_B_0']));
      read('flowSession.graph.edges = [{ id: "e1", from: "A", to: "B" }];');
      booted.measureFlowDiagram();
      const left = copies();
      if (left.length !== 1) throw new Error(`${left.length} copies are left for one line`);
      if (left[0].getAttribute('data-flow-hit') !== 'e1') throw new Error('the copy that was left over is the wrong one');
    } finally {
      read('flowSession = null;');
      read('flowPlaced = null;');
      read('flowNatural = null;');
      read('flowSize = null;');
      read('flowZoom = 1;');
      read('flowSelection = null;');
      for (const stage of [...canvas.querySelectorAll('.flow-stage')]) stage.remove();
    }
  });

  // Until this, the line above the canvas only ever answered a selection, so the one gesture that actually builds a chart — the + handles a box grows when you point at it — was the one the canvas never mentioned. Pointing now says what the thing under the pointer is and what can be done to it, and says it without choosing anything: a hover that selected would move the picker's sheet under the hand.
  check('pointing at a box or a line says what it is, and every sentence the canvas can show is reachable', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const canvas = read('flowCanvas');
    const hint = read('flowHint');
    const drawn = read("document.createElement('div')");
    canvas.appendChild(drawn);
    try {
      read("flowSession = { save: null, text: '', graph: null };");
      read('flowSession.graph = parseFlow(`flowchart TD\n  A["a"] --> B{"b"}`);');
      read('flowSelection = null;');
      read('flowHovered = null;');
      const boxes = read('flowSession.graph.nodes').map((one) => one.id);
      const line = read('flowSession.graph.edges')[0].id;
      read('flowPlaced = { nodes: [], groups: [], edges: [{ id: ' + JSON.stringify(line) + ', path: flowCanvas.children[flowCanvas.children.length - 1] }] };');

      booted.restoreFlowHint();
      const idle = hint.textContent;
      if (!idle) throw new Error('the canvas says nothing with the pointer on nothing');

      booted.markFlowHover({ kind: 'edge', id: line });
      const aboutTheLine = hint.textContent;
      if (aboutTheLine === idle) throw new Error('pointing at a line said nothing the idle sentence does not');
      if (!drawn.classList.contains('is-hover')) throw new Error('the line under the pointer is not lit');
      if (read('flowSelection')) throw new Error('pointing at a line selected it');

      booted.markFlowHover({ kind: 'node', id: boxes[0] });
      const aboutTheBox = hint.textContent;
      if (aboutTheBox === aboutTheLine || aboutTheBox === idle) throw new Error('pointing at a box says what pointing at a line says');
      if (read('flowSelection')) throw new Error('pointing at a box selected it');
      if (drawn.classList.contains('is-hover')) throw new Error('the line stayed lit once the pointer moved onto a box');

      booted.markFlowHover(null);
      if (hint.textContent !== idle) throw new Error('leaving everything did not put the idle sentence back');
      if (canvas.querySelectorAll('.is-hover').length) throw new Error('something stayed lit after the pointer left the canvas');

      // A sentence written and never shown is one somebody wrote for a state that no longer happens.
      const sheet = SHEET_FRAGMENTS.map((path) => readFileSync(join(root, path), 'utf8')).join('\n');
      const names = [...sheet.matchAll(/const (FLOW_TIP_[A-Z_]+)\s*=/g)].map((found) => found[1]);
      if (names.length < 6) throw new Error(`only ${names.length} sentences were found to check`);
      for (const name of names) {
        if (sheet.split(name).length - 1 < 2) throw new Error(`${name} is written and never shown`);
      }
    } finally {
      drawn.remove();
      read('flowSession = null;');
      read('flowPlaced = null;');
      read('flowSelection = null;');
      read('flowHovered = null;');
    }
  });

  // A step that loops back on itself — a retry, a poll, a check that runs again — was refused on the drop by one condition. Allowing it alone would have shipped a line the canvas is blind to: mermaid draws a self-loop as three paths spelled `<box>-cyclic-special-*` rather than the `L_<from>_<to>_<n>` every other line takes, so the measurement never found it, the pointer answered the bare canvas over the drawn arc, and the only way to remove it was the text pane.
  check('a box takes a line back to itself, and the canvas can see the one it drew', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const canvas = read('flowCanvas');
    try {
      read('flowSession = { save: null, text: "", graph: null };');
      read('flowSession.graph = parseFlow(`flowchart TD\n  A["a"]`);');

      // The model takes the line and writes it back the way somebody would type it.
      const made = read('flowConnect(flowSession.graph, "A", "A")');
      if (!made) throw new Error('the model refused a line from a box to itself');
      const text = read('renderFlow(flowSession.graph)');
      if (!text.includes('A --> A')) throw new Error(`a self-loop was written as ${JSON.stringify(text)}`);
      const again = read('parseFlow(' + JSON.stringify(text) + ')');
      if (again.edges.length !== 1 || again.edges[0].from !== 'A' || again.edges[0].to !== 'A') {
        throw new Error('a self-loop did not read back as one line from the box to itself');
      }

      // And the measurement finds it, which is the half the drop alone would have left out. Mermaid names the arc over the box `<box>-cyclic-special-mid`; nothing in the diagram is called `L_A_A_0`.
      const stage = fakeElement('');
      stage.classList.add('flow-stage');
      stage.getBoundingClientRect = () => ({ top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200 });
      const svg = fakeElement('');
      svg.tagName = 'svg';
      stage.appendChild(svg);
      const holder = fakeElement('');
      holder.tagName = 'g';
      holder.classList.add('edgePaths');
      svg.appendChild(holder);
      for (const name of ['A-cyclic-special-1', 'A-cyclic-special-mid', 'A-cyclic-special-2']) {
        const arc = fakeElement('');
        arc.tagName = 'path';
        arc.setAttribute('data-id', name);
        arc.getTotalLength = () => 60;
        arc.getScreenCTM = () => ({});
        arc.getPointAtLength = (length) => {
          const at = { x: 20 + length, y: 30, matrixTransform: () => at };
          return at;
        };
        holder.appendChild(arc);
      }
      const box = fakeElement('flowchart-A-0');
      box.tagName = 'g';
      box.classList.add('node');
      box.getBoundingClientRect = () => ({ top: 40, left: 60, right: 180, bottom: 96, width: 120, height: 56 });
      svg.appendChild(box);
      const overlay = fakeElement('');
      overlay.classList.add('flow-overlay');
      stage.appendChild(overlay);
      canvas.appendChild(stage);

      read('flowZoom = 1;');
      booted.measureFlowDiagram();
      const placed = read('flowPlaced');
      if (!placed || placed.edges.length !== 1) throw new Error('the measurement cannot see the line the box drew back to itself');
      const arc = placed.edges[0];
      if (arc.path.getAttribute('data-id') !== 'A-cyclic-special-mid') {
        throw new Error(`the loop was measured off ${arc.path.getAttribute('data-id')} rather than the arc over the box`);
      }
      // So the pointer answers it rather than answering the bare canvas, and it wears a hit copy like every other line.
      if (read('flowEdgeUnder')(arc.path) !== arc.id) throw new Error('the pointer does not read the loop as a line');
      const copies = [...canvas.querySelectorAll('path[data-flow-hit]')];
      if (copies.length !== 1 || copies[0].getAttribute('data-flow-hit') !== arc.id) {
        throw new Error('the loop was left without the wide copy every other line is hit on');
      }
    } finally {
      read('flowSession = null;');
      read('flowPlaced = null;');
      read('flowNatural = null;');
      read('flowSize = null;');
      read('flowZoom = 1;');
      read('flowSelection = null;');
      for (const stage of [...canvas.querySelectorAll('.flow-stage')]) stage.remove();
    }
  });
}
