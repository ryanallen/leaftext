// front-page.js
// ---------------------------------------------------------------------------
// The front page's motion: each card rises into place once as it first comes into view, and each clip box swaps its poster for the recorded clip as it nears the window, plays while it is near and pauses once it has gone.
//
// A reader who asked for less motion gets neither: every card starts in place and every box keeps its poster, and no clip is ever fetched. The page is whole without this file — the layout already put a poster with words in every box.
// ---------------------------------------------------------------------------

import { DEMO_DIR } from './front-page-layout.js';

/** How far ahead of the window a clip starts arriving, so it is playing by the time it is seen. */
const CLIP_AHEAD = '400px 0px';

/** Put the clip in its box, or carry on playing the one already there. */
function playIn(box) {
  let clip = box.querySelector('video');
  if (!clip) {
    const poster = box.querySelector('img');
    clip = document.createElement('video');
    clip.muted = true;
    clip.defaultMuted = true;
    clip.loop = true;
    clip.playsInline = true;
    clip.setAttribute('muted', '');
    clip.setAttribute('playsinline', '');
    clip.preload = 'auto';
    if (poster) {
      clip.poster = poster.getAttribute('src');
      clip.setAttribute('aria-label', poster.getAttribute('alt') || '');
      clip.textContent = poster.getAttribute('alt') || '';
    }
    clip.src = `${DEMO_DIR}/${box.dataset.clip}.webm`;
    if (poster) poster.replaceWith(clip);
    else box.appendChild(clip);
  }
  const playing = clip.play();
  if (playing && typeof playing.catch === 'function') playing.catch(() => {});
}

/** Pause the clip in a box that has left, where one was ever put there. */
function pauseIn(box) {
  const clip = box.querySelector('video');
  if (clip) clip.pause();
}

/** Start the front page's motion over the laid-out page inside `root`. */
export function installFrontMotion(root) {
  const cards = [...root.querySelectorAll('.front-card')];
  const boxes = [...root.querySelectorAll('.front-clip[data-clip]')];
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || typeof IntersectionObserver !== 'function') return { cards: cards.length, clips: 0 };

  // Held down only once this script is running, so a page it never reaches shows every card where it belongs.
  for (const card of cards) card.classList.add('front-rise');
  const rising = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        rising.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px' }
  );
  for (const card of cards) rising.observe(card);

  const near = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) (entry.isIntersecting ? playIn : pauseIn)(entry.target);
    },
    { rootMargin: CLIP_AHEAD }
  );
  for (const box of boxes) near.observe(box);
  return { cards: cards.length, clips: boxes.length };
}
