// Generated from src/assets/leaf.svg by scripts/bundle-dotted-leaf.mjs.
const DOTTED_LEAF_POINTS = [[6.5,9],[6.5,11.5],[9,11.5],[6.5,14],[9,14],[11.5,14],[6.5,16.5],[9,16.5],[11.5,16.5],[14,16.5],[6.5,19],[9,19],[11.5,19],[14,19],[16.5,19],[19,19],[6.5,21.5],[9,21.5],[11.5,21.5],[14,21.5],[16.5,21.5],[19,21.5],[21.5,21.5],[24,21.5],[26.5,21.5],[6.5,24],[9,24],[11.5,24],[14,24],[16.5,24],[19,24],[21.5,24],[24,24],[26.5,24],[29,24],[31.5,24],[34,24],[36.5,24],[39,24],[6.5,26.5],[9,26.5],[11.5,26.5],[16.5,26.5],[19,26.5],[21.5,26.5],[24,26.5],[26.5,26.5],[29,26.5],[31.5,26.5],[34,26.5],[36.5,26.5],[39,26.5],[41.5,26.5],[44,26.5],[9,29],[11.5,29],[14,29],[16.5,29],[19,29],[21.5,29],[24,29],[26.5,29],[29,29],[31.5,29],[34,29],[36.5,29],[39,29],[41.5,29],[44,29],[46.5,29],[9,31.5],[11.5,31.5],[14,31.5],[16.5,31.5],[19,31.5],[24,31.5],[26.5,31.5],[29,31.5],[31.5,31.5],[34,31.5],[36.5,31.5],[39,31.5],[41.5,31.5],[44,31.5],[46.5,31.5],[49,31.5],[9,34],[11.5,34],[14,34],[16.5,34],[19,34],[21.5,34],[24,34],[31.5,34],[34,34],[36.5,34],[39,34],[41.5,34],[44,34],[46.5,34],[49,34],[51.5,34],[11.5,36.5],[14,36.5],[16.5,36.5],[19,36.5],[21.5,36.5],[24,36.5],[26.5,36.5],[29,36.5],[44,36.5],[46.5,36.5],[49,36.5],[51.5,36.5],[11.5,39],[14,39],[16.5,39],[19,39],[21.5,39],[24,39],[26.5,39],[29,39],[31.5,39],[34,39],[36.5,39],[49,39],[51.5,39],[54,39],[14,41.5],[16.5,41.5],[19,41.5],[21.5,41.5],[24,41.5],[26.5,41.5],[29,41.5],[31.5,41.5],[34,41.5],[36.5,41.5],[39,41.5],[41.5,41.5],[44,41.5],[51.5,41.5],[54,41.5],[16.5,44],[19,44],[21.5,44],[24,44],[26.5,44],[29,44],[31.5,44],[34,44],[36.5,44],[39,44],[41.5,44],[44,44],[46.5,44],[54,44],[56.5,44],[19,46.5],[21.5,46.5],[24,46.5],[26.5,46.5],[29,46.5],[31.5,46.5],[34,46.5],[36.5,46.5],[39,46.5],[41.5,46.5],[44,46.5],[46.5,46.5],[49,46.5],[56.5,46.5],[19,49],[21.5,49],[24,49],[26.5,49],[29,49],[31.5,49],[34,49],[36.5,49],[39,49],[41.5,49],[44,49],[46.5,49],[49,49],[51.5,49],[24,51.5],[26.5,51.5],[29,51.5],[31.5,51.5],[34,51.5],[36.5,51.5],[39,51.5],[41.5,51.5],[44,51.5],[46.5,51.5],[49,51.5],[51.5,51.5],[54,51.5],[26.5,54],[29,54],[31.5,54],[34,54],[36.5,54],[39,54],[41.5,54],[44,54],[46.5,54],[49,54],[51.5,54],[54,54],[56.5,54],[34,56.5],[36.5,56.5],[39,56.5],[41.5,56.5],[44,56.5],[46.5,56.5],[49,56.5],[51.5,56.5],[54,56.5],[56.5,56.5],[59,59]];
function dottedLeafMarkup(id) {
  const circles = DOTTED_LEAF_POINTS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.82"/>`).join('');
  return `<span class="dotted-leaf" role="img" aria-label="Leaftext leaf" data-dotted-leaf="${String(id).replace(/[^a-z0-9-]/gi, '')}"><svg class="dotted-leaf-still" viewBox="0 0 64 64" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor">${circles}</g></svg><canvas class="dotted-leaf-canvas" aria-hidden="true"></canvas></span>`;
}
function startDottedLeaf(mark) {
  if (!mark || typeof mark.querySelector !== 'function' || typeof requestAnimationFrame !== 'function') return () => {};
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (media?.matches) return () => {};
  const canvas = mark.querySelector('.dotted-leaf-canvas');
  const still = mark.querySelector('.dotted-leaf-still');
  const context = canvas?.getContext?.('2d');
  if (!context || !still) return () => {};
  const view = canvas.ownerDocument;
  let frameId = 0;
  let stopped = false;
  let spinAt = -1;
  let spinAngle = 0;
  let pointerYaw = 0;
  let pointerPitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let drawn = 0;
  let ink = '';
  const size = () => {
    const pixelRatio = Math.min(view.defaultView?.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(mark.clientWidth * pixelRatio));
    if (canvas.width !== width) {
      canvas.width = width;
      canvas.height = width;
      context.setTransform(width / 64, 0, 0, width / 64, 0, 0);
    }
  };
  const draw = (now) => {
    frameId = 0;
    if (stopped || !mark.isConnected || view.hidden) {
      if (!mark.isConnected) stop();
      return;
    }
    size();
    if (!ink || drawn++ % 60 === 0) ink = view.defaultView.getComputedStyle(mark).color;
    context.clearRect(0, 0, 64, 64);
    context.fillStyle = ink;
    if (spinAt >= 0) {
      const progress = Math.min((now - spinAt) / 1400, 1);
      spinAngle = 2 * Math.PI * (progress * progress * (3 - 2 * progress));
      if (progress === 1) { spinAt = -1; spinAngle = 0; }
    }
    pointerYaw += (targetYaw - pointerYaw) * 0.12;
    pointerPitch += (targetPitch - pointerPitch) * 0.12;
    if (targetYaw === 0 && Math.abs(pointerYaw) < 0.0001) pointerYaw = 0;
    if (targetPitch === 0 && Math.abs(pointerPitch) < 0.0001) pointerPitch = 0;
    const yaw = spinAngle + pointerYaw;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const pitchCosine = Math.cos(pointerPitch);
    const pitchSine = Math.sin(pointerPitch);
    const time = now / 1000;
    const points = [];
    for (let i = 0; i < DOTTED_LEAF_POINTS.length; i += 1) {
      const [x, y] = DOTTED_LEAF_POINTS[i];
      const nx = (x - 32) / 32;
      const ny = (y - 32) / 32;
      const depth = 0.5 * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const pulse = 0.5 + 0.5 * Math.sin(time * (2 * Math.PI / 2.4) + i * 2.399963229728653);
      for (const side of [1, -1]) {
        const turnedX = nx * cosine + side * depth * sine;
        const yawZ = side * depth * cosine - nx * sine;
        const turnedY = ny * pitchCosine - yawZ * pitchSine;
        const turnedZ = ny * pitchSine + yawZ * pitchCosine;
        if (turnedZ < 0) continue;
        const perspective = 1 / (1 - turnedZ * 0.32);
        points.push([32 + turnedX * 32 * perspective, 32 + turnedY * 32 * perspective, turnedZ, perspective, pulse]);
      }
    }
    points.sort((a, b) => b[2] - a[2]);
    const cells = new Map();
    const placed = [];
    for (const point of points) {
      const [x, y, , perspective, pulse] = point;
      const cellX = Math.floor(x / 2);
      const cellY = Math.floor(y / 2);
      let touching = false;
      for (let nearY = cellY - 1; nearY <= cellY + 1 && !touching; nearY += 1) {
        for (let nearX = cellX - 1; nearX <= cellX + 1 && !touching; nearX += 1) {
          for (const earlier of cells.get(`${nearX},${nearY}`) || []) {
            const distance = 0.94 * (perspective + earlier[3]) + 0.25;
            if ((x - earlier[0]) ** 2 + (y - earlier[1]) ** 2 < distance ** 2) { touching = true; break; }
          }
        }
      }
      if (touching) continue;
      placed.push(point);
      const key = `${cellX},${cellY}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(point);
    }
    for (const [x, y, depth, perspective, pulse] of placed.reverse()) {
      context.globalAlpha = Math.min(1, 0.35 + depth * 0.2 + pulse * 0.55);
      context.beginPath();
      context.arc(x, y, (0.74 + 0.2 * pulse) * perspective, 0, 2 * Math.PI);
      context.fill();
    }
    context.globalAlpha = 1;
    still.style.visibility = 'hidden';
    canvas.style.visibility = 'visible';
    frameId = requestAnimationFrame(draw);
  };
  const pointer = (event) => {
    const box = mark.getBoundingClientRect();
    if (!box.width || !box.height) return;
    targetYaw = Math.max(-0.22, Math.min(0.22, ((event.clientX - box.left) / box.width * 2 - 1) * 0.22));
    targetPitch = Math.max(-0.16, Math.min(0.16, -((event.clientY - box.top) / box.height * 2 - 1) * 0.16));
  };
  const pointerOut = () => { targetYaw = 0; targetPitch = 0; };
  const spin = () => { spinAt = view.defaultView.performance.now(); if (!frameId && !view.hidden) frameId = requestAnimationFrame(draw); };
  const key = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); spin(); } };
  const visible = () => { if (!view.hidden && !frameId && !stopped) frameId = requestAnimationFrame(draw); };
  const preference = () => { if (media.matches) stop(); };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frameId) cancelAnimationFrame(frameId);
    mark.removeEventListener('click', spin);
    mark.removeEventListener('keydown', key);
    mark.removeEventListener('pointermove', pointer);
    mark.removeEventListener('pointerleave', pointerOut);
    view.removeEventListener('visibilitychange', visible);
    media?.removeEventListener?.('change', preference);
    mark.removeAttribute('tabindex');
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', 'Leaftext leaf');
    still.style.visibility = 'visible';
    canvas.style.visibility = 'hidden';
  };
  mark.setAttribute('role', 'button');
  mark.setAttribute('aria-label', 'Spin Leaftext leaf');
  mark.tabIndex = 0;
  mark.addEventListener('click', spin);
  mark.addEventListener('keydown', key);
  mark.addEventListener('pointermove', pointer);
  mark.addEventListener('pointerleave', pointerOut);
  view.addEventListener('visibilitychange', visible);
  media?.addEventListener?.('change', preference);
  frameId = requestAnimationFrame(draw);
  return stop;
}
export { dottedLeafMarkup, startDottedLeaf };
