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
    clip.className = 'front-clip-media';
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

/** What a page's motion has reached: the cards that have risen, by `data-clip-card`, and the clip made in each box, by `data-clip`. */
function heldOn(cards, boxes) {
  const risen = cards.filter((card) => card.classList.contains('is-in')).map((card) => card.dataset.clipCard);
  const clips = new Map();
  for (const box of boxes) {
    const clip = box.querySelector('video');
    if (clip) clips.set(box.dataset.clip, clip);
  }
  return { risen: new Set(risen), clips };
}

/**
 * Start the front page's motion over the laid-out page inside `root`, which is the reading column's own article, and answer how to stop it and what it has reached.
 *
 * `held` is what the page this one replaces had reached, so a redraw of the standing page carries its motion across rather than starting it over: a risen card is put straight in place, and a clip already made moves into the fresh box in place of the poster and plays on from where it was, with nothing fetched again.
 */
export function installFrontMotion(root, held = null) {
  const cards = [...root.querySelectorAll('.front-card')];
  // Only the reading column's boxes: the rail's copy of the page keeps its posters, since a clip there would fetch and decode the same file again for a picture too small to watch.
  const boxes = [...root.querySelectorAll('.front-clip[data-clip]')].filter((box) => !box.closest('.document-minimap, .document-minimap-preview'));
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || typeof IntersectionObserver !== 'function') return { root, cards: cards.length, clips: 0, stop: () => {}, hold: () => null };

  if (held) {
    for (const box of boxes) {
      const clip = held.clips.get(box.dataset.clip);
      if (!clip || box.contains(clip)) continue;
      const poster = box.querySelector('img');
      if (poster) poster.replaceWith(clip);
      else box.appendChild(clip);
    }
  }
  // Held down only once this script is running, so a page it never reaches shows every card where it belongs. A card that had risen gets both at once, which starts no transition on a card already in place.
  const waiting = [];
  for (const card of cards) {
    if (held && held.risen.has(card.dataset.clipCard)) card.classList.add('front-rise', 'is-in');
    else {
      card.classList.add('front-rise');
      waiting.push(card);
    }
  }
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
  for (const card of waiting) rising.observe(card);

  const near = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) (entry.isIntersecting ? playIn : pauseIn)(entry.target);
    },
    { rootMargin: CLIP_AHEAD }
  );
  for (const box of boxes) near.observe(box);
  // A redraw puts a fresh page in, so the page it replaced is let go of rather than watched for ever.
  const stop = () => {
    rising.disconnect();
    near.disconnect();
  };
  return { root, cards: cards.length, clips: boxes.length, stop, hold: () => heldOn(cards, boxes) };
}
