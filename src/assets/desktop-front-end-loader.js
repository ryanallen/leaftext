// What the desktop carries where every other host carries the front-end tag itself: the same joined `app.js`, appended one painted frame later.
//
// A deferred script still runs before the browser draws anything, so a launch reached a laid-out page with the startup card already in it and then sat blank for the whole of the front end's own execution — an interactive page at 15ms, the script's bytes in at 41ms, and no pixel until it finished at 157ms. Nothing in that wait is work the reader is waiting on: the card is literal markup above this line and needs no script to exist.
//
// So the URL is preloaded as parsing ends, which keeps the local asset's fetch alongside the first frame rather than behind it, and the tag is appended from the second animation-frame callback — one frame is painted between the two, which is the frame the card is drawn in. Anonymous cross-origin mode on both, so the preload is the response the script reuses and a throw inside the front end still reaches `window.onerror` with its place instead of the masked `Script error.`
//
// The URL is whichever front-end asset this launch is served: the ordinary join for every reader, and the timed one for a copy started to measure itself. The waiting here is the same either way, which is what makes a measured launch worth reading. See `front_end_asset` in `main.rs`.
//
// A browser host keeps the direct deferred tag: a published site and an embedded document both start their own module boot underneath it, and that order is theirs rather than ours to move. See `app_shell_html` and `app_shell_html_for_host` in `lib.rs`.
(() => {
  const url = '{{APP_SCRIPT_URL}}';
  const preload = document.createElement('link');
  preload.rel = 'preload';
  preload.as = 'script';
  preload.crossOrigin = 'anonymous';
  preload.href = url;
  document.head.appendChild(preload);
  const runFrontEnd = () => {
    const script = document.createElement('script');
    script.src = url;
    script.crossOrigin = 'anonymous';
    document.body.appendChild(script);
  };
  // Two callbacks rather than one: the first runs before the frame it was queued for is drawn, so only the second is past a painted card.
  requestAnimationFrame(() => requestAnimationFrame(runFrontEnd));
})();
