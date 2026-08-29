// Whether a theme can replace a drawing at all: every icon is a value the page root declares and the class reads, so a family-scoped block redeclaring the ones its pack covers reaches every control without touching a class, and a family that redeclares nothing keeps the drawing it has today.
//
// This is the one thing the Rust side cannot resolve. A test there reads the stylesheet as text and can say a class names a value; what it cannot say is which declaration wins for a given root, which is the whole mechanism. So the cascade for one element — the page root, which is the only element any of these declarations sit on — is resolved here, over the sheet the browser is actually handed.
//
// Only custom properties on `:root`, and only the last winner: a custom property takes the most specific declaration that matches, and every family selector is `:root` plus an attribute, so it outranks the bare `:root` on specificity alone and order never has to be weighed. A pack block is not in the sheet yet, so the family half is proved by declaring one over the real sheet — which is exactly what phase 3's generator will write.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, root } from './shared.mjs';

// The drawings are their own part of the sheet, joined ahead of the rules that spend them by `reading_mode_css`, and `readingCss()` hands back only `READING_CSS_PARTS` — which that part is not one of. So it is read here by name.
const iconsCss = () => readFileSync(join(root, 'src/assets/icons.css'), 'utf8');

/** Every `--lt-icon-*` a block declares, as a map. `block` is the text between one rule's braces. */
function declared(block) {
  return new Map([...block.matchAll(/(--lt-icon-[a-z0-9-]+):\s*(url\("[^"]*"\))/g)].map((hit) => [hit[1], hit[2]]));
}

/** The body of every rule in `css` whose selector matches `selector` exactly, joined in the order the sheet holds them. */
function bodiesOf(css, selector) {
  const bodies = [];
  for (const hit of css.matchAll(/(^|\n)([^\n{}]+)\{([^{}]*)\}/g)) {
    if (hit[2].trim() === selector) bodies.push(hit[3]);
  }
  return bodies;
}

/** What one icon value resolves to on a page root wearing `family`, over `css`. A family block wins where it declares the name, and where it does not the bare `:root` declaration stands — which is the fallback the whole ticket rests on. */
function resolve(css, name, family) {
  const root = new Map();
  for (const body of bodiesOf(css, ':root')) for (const [key, value] of declared(body)) root.set(key, value);
  if (family) {
    for (const body of bodiesOf(css, `:root[data-leaf-theme="${family}"]`)) {
      for (const [key, value] of declared(body)) root.set(key, value);
    }
  }
  return root.get(name);
}

/** What the class actually paints, once the `var()` it names is resolved for a root wearing `family`. Null where the class carries no mask at all, which is a control drawing nothing. */
function painted(css, icon, family) {
  const body = bodiesOf(css, `.lt-icon-${icon}`).join('');
  const named = /\n\s*mask-image:\s*var\((--lt-icon-[a-z0-9-]+)\)/.exec(body);
  if (!named) return null;
  return resolve(css, named[1], family) ?? null;
}

export function run() {
  const shipped = iconsCss();
  // A pack block the shape `bundle-icons` writes: one family, one drawing, everything else left to the root.
  const swapped = `${shipped}\n:root[data-leaf-theme="nightshade"] {\n  --lt-icon-back: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24'%3E%3Cpath d='M0 0'/%3E%3C/svg%3E");\n}\n`;

  check('every drawing is a value the root declares and the class reads', () => {
    const classes = [...shipped.matchAll(/\n\.lt-icon-([a-z0-9-]+) \{/g)].map((hit) => hit[1]);
    if (classes.length < 30) throw new Error(`only ${classes.length} icon classes in the sheet, so the reader below is looking at the wrong thing`);
    const baked = classes.filter((icon) => painted(shipped, icon, null) === null);
    if (baked.length) throw new Error(`${baked.length} icon classes paint no value a theme can replace: ${baked.slice(0, 5).join(', ')}`);
  });

  check('a family that redeclares a drawing wears it', () => {
    const was = painted(shipped, 'back', 'nightshade');
    const now = painted(swapped, 'back', 'nightshade');
    if (!was) throw new Error('the back arrow paints nothing at all, so there is no drawing to swap');
    if (now === was) throw new Error('a family block redeclaring the back arrow did not reach the class, so a pack would compile and change nothing on screen');
    if (!now.includes("d='M0 0'")) throw new Error(`the class painted ${now} rather than the family's own drawing`);
  });

  check('a drawing the family leaves alone keeps the one it has today', () => {
    // The fallback every uncovered job rests on: a pack that covers one drawing must not blank the other sixty-two.
    const kept = [...shipped.matchAll(/\n\.lt-icon-([a-z0-9-]+) \{/g)]
      .map((hit) => hit[1])
      .filter((icon) => icon !== 'back')
      .filter((icon) => painted(swapped, icon, 'nightshade') !== painted(shipped, icon, null));
    if (kept.length) throw new Error(`${kept.length} drawings moved under a family that never named them: ${kept.slice(0, 5).join(', ')}`);
  });

  check('a family that redeclares nothing looks exactly like today', () => {
    const moved = [...swapped.matchAll(/\n\.lt-icon-([a-z0-9-]+) \{/g)]
      .map((hit) => hit[1])
      .filter((icon) => painted(swapped, icon, 'pippin') !== painted(shipped, icon, null));
    if (moved.length) throw new Error(`${moved.length} drawings moved on a family with no pack of its own: ${moved.slice(0, 5).join(', ')}`);
  });
}
