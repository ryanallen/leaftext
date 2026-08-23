#!/usr/bin/env node
// Whether the two stylesheets that decide when the published minimap rail is on the page still name one width. `site/styles.css` takes the rail off the page at or below a number and `src/assets/reading.css` puts the exported page's rail back above another, so the two are one edge written twice — and a reader meets the gap between them as a rail standing on one page and gone from the other at the very same window width.
//
//   node scripts/check-minimap-breakpoint.mjs          say what each stylesheet names
//   node scripts/check-minimap-breakpoint.mjs --check  exit 1 when they disagree (`just verify`)
//
// Every run first drives its own refusals against stylesheet text written for them — a pair naming different numbers, a rule reworded past its reader, and two rules answering one question — because a check that quietly finds nothing is the fault this one was written to stop.
//
// The script that draws the rail names no width at all: it asks the rail whether the stylesheet left it on the page. That is why this holds two files rather than three.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SITE = 'site/styles.css';
const EXPORTED = 'src/assets/reading.css';

// The two bounds a media condition can carry here, read as their own pattern so no width is built out of a string.
const BOUNDS = {
  'max-width': /max-width\s*:\s*(\d+)px/g,
  'min-width': /min-width\s*:\s*(\d+)px/g,
};

/** Every `@media` block in a stylesheet, with its condition and the rules inside it. Comments come out first, so a brace inside one cannot end a block. */
function mediaBlocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const opens = /@media([^{]*)\{/g;
  let found;
  while ((found = opens.exec(text))) {
    let depth = 1;
    let at = opens.lastIndex;
    while (at < text.length && depth > 0) {
      if (text[at] === '{') depth += 1;
      else if (text[at] === '}') depth -= 1;
      at += 1;
    }
    blocks.push({ condition: found[1].trim(), body: text.slice(opens.lastIndex, at - 1) });
  }
  return blocks;
}

/** Whether a media block holds a rule for exactly this selector saying exactly this declaration. */
function says(body, selector, declaration) {
  const rules = /([^{}]+)\{([^{}]*)\}/g;
  let found;
  while ((found = rules.exec(body))) {
    const selectors = found[1].split(',').map((one) => one.trim().replace(/\s+/g, ' '));
    if (!selectors.includes(selector)) continue;
    const declared = found[2].split(';').map((one) => one.trim().replace(/\s+/g, ' ').toLowerCase());
    if (declared.includes(declaration)) return true;
  }
  return false;
}

/** The width a stylesheet names for the rail, or a sentence saying why nothing was read. The rule looked for is the one that decides whether the rail is drawn at all. */
export function widthNamed(css, { bound, selector, declaration }) {
  const holding = mediaBlocks(css).filter((block) => says(block.body, selector, declaration));
  if (holding.length !== 1) {
    return { problem: `${holding.length} media rules say \`${selector} { ${declaration} }\`, and this reads exactly one — so nothing was compared` };
  }
  const pattern = BOUNDS[bound];
  pattern.lastIndex = 0;
  const widths = [...holding[0].condition.matchAll(pattern)].map((one) => Number(one[1]));
  if (widths.length !== 1) {
    return { problem: `the media rule holding \`${selector} { ${declaration} }\` names ${widths.length} ${bound} values in \`${holding[0].condition}\`, and this reads exactly one` };
  }
  return { width: widths[0] };
}

/** What is wrong between the two stylesheets, one problem per line. Empty when the exported page shows the rail exactly one pixel above the width the site hides it below. */
export function problems(siteCss, exportedCss) {
  const found = [];
  const hides = widthNamed(siteCss, { bound: 'max-width', selector: '.document-minimap', declaration: 'display: none' });
  const shows = widthNamed(exportedCss, { bound: 'min-width', selector: 'body.leaf-web .document-minimap', declaration: 'display: block' });
  if (hides.problem) found.push(`${SITE}: ${hides.problem}`);
  if (shows.problem) found.push(`${EXPORTED}: ${shows.problem}`);
  if (found.length) return found;
  if (shows.width !== hides.width + 1) {
    found.push(
      `${SITE} hides the rail at ${hides.width}px and under, so ${EXPORTED} has to draw it from ${hides.width + 1}px up — and it says ${shows.width}px. One of the two moved without the other, and a reader meets the gap as a rail standing on one page and gone from the other at the same window width`
    );
  }
  return found;
}

/** Prove the refusals against stylesheet text written for them. A check nobody has watched fail is a check that passes on a broken tree. */
function selfTest() {
  const site = (width) => `@media (max-width: ${width}px) {\n  body { padding-right: 0; }\n  .document-minimap { display: none; }\n}\n`;
  const exported = (width) => `body.leaf-web .document-minimap { display: none; }\n@media screen and (min-width: ${width}px) {\n  body.leaf-web .document-minimap { display: block; position: fixed; }\n}\n`;
  if (problems(site(720), exported(721)).length) throw new Error('a pair one pixel apart, which is the pair that agrees, was refused');
  const apart = problems(site(720), exported(900));
  if (!apart.some((one) => one.includes('720') && one.includes('900'))) throw new Error('a pair naming different numbers was not refused, or the refusal named neither number');
  const reworded = problems(site(720), exported(721).replace('display: block', 'display: flex'));
  if (!reworded.some((one) => one.startsWith(`${EXPORTED}: `))) throw new Error('a rule reworded past its reader passed as agreement, which is this check going quietly blind');
  const twice = problems(site(720) + site(900), exported(721));
  if (!twice.some((one) => one.startsWith(`${SITE}: `))) throw new Error('two rules answering the same question passed, so which of them was read is nobody knows');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  selfTest();
  const siteCss = readFileSync(join(root, SITE), 'utf8');
  const exportedCss = readFileSync(join(root, EXPORTED), 'utf8');
  const found = problems(siteCss, exportedCss);
  if (found.length) {
    console.error('the two stylesheets no longer name one width for the minimap rail:');
    for (const one of found) console.error(`  ${one}`);
    process.exit(process.argv.includes('--check') ? 1 : 0);
  }
  const hides = widthNamed(siteCss, { bound: 'max-width', selector: '.document-minimap', declaration: 'display: none' });
  console.log(`minimap breakpoint: refuses a pair naming different numbers, a rule reworded past its reader and two rules answering one question — and the two stylesheets name one edge, the rail gone at ${hides.width}px and under and drawn from ${hides.width + 1}px up`);
}
