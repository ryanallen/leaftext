// Keep the repo's own writing in US spelling — "color", never "colour". The word list below is the British form of pairs that actually turn up in software prose; each maps to the spelling this repo uses.
//
//   node scripts/check-spelling.mjs   report every hit and exit non-zero (`just verify`)
//
// Only files this repo authors are scanned, plus the live tickets in `../docs` (outside this git repo, which is how a British spelling first got into one). Vendored bundles (Monaco, KaTeX, Mermaid, PixiJS, Noto) are third-party text and are skipped wholesale, as are build output, the font CSS (megabytes of base64), and Cargo.lock.
//
// EXEMPT holds the handful of identifiers that are British by specification and cannot be respelled: an ARIA attribute name and a Windows Installer directory id. They are matched as whole tokens so a real prose hit beside one still fails.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTree } from './plan-tree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// British form -> the spelling to use instead.
const BRITISH = {
  colour: 'color',
  colours: 'colors',
  coloured: 'colored',
  colouring: 'coloring',
  behaviour: 'behavior',
  behaviours: 'behaviors',
  favourite: 'favorite',
  favour: 'favor',
  honour: 'honor',
  humour: 'humor',
  neighbour: 'neighbor',
  labour: 'labor',
  flavour: 'flavor',
  centre: 'center',
  centred: 'centered',
  licence: 'license',
  defence: 'defense',
  offence: 'offense',
  practise: 'practice',
  programme: 'program',
  grey: 'gray',
  mould: 'mold',
  sceptical: 'skeptical',
  whilst: 'while',
  amongst: 'among',
  learnt: 'learned',
  spelt: 'spelled',
  fulfil: 'fulfill',
  judgement: 'judgment',
  acknowledgement: 'acknowledgment',
  acknowledgements: 'acknowledgments',
  ageing: 'aging',
  organise: 'organize',
  organisation: 'organization',
  realise: 'realize',
  recognise: 'recognize',
  analyse: 'analyze',
  normalise: 'normalize',
  optimise: 'optimize',
  minimise: 'minimize',
  maximise: 'maximize',
  prioritise: 'prioritize',
  serialise: 'serialize',
  initialise: 'initialize',
  customise: 'customize',
  summarise: 'summarize',
  emphasise: 'emphasize',
  utilise: 'utilize',
  visualise: 'visualize',
  standardise: 'standardize',
  synchronise: 'synchronize',
  sanitise: 'sanitize',
  tokenise: 'tokenize',
  memoise: 'memoize',
  capitalise: 'capitalize',
  finalise: 'finalize',
  specialise: 'specialize',
  categorise: 'categorize',
  labelled: 'labeled',
  labelling: 'labeling',
  modelling: 'modeling',
  travelled: 'traveled',
  cancelled: 'canceled',
  cancelling: 'canceling',
  signalled: 'signaled',
  skilful: 'skillful',
  artefact: 'artifact',
  catalogue: 'catalog',
  analogue: 'analog',
  enquire: 'inquire',
  orientated: 'oriented',
  focussed: 'focused',
  manoeuvre: 'maneuver',
  metre: 'meter',
  litre: 'liter',
  fibre: 'fiber',
  storey: 'story',
  kerb: 'curb',
  aluminium: 'aluminum',
  instalment: 'installment',
  enrolment: 'enrollment',
};

// Spelled the British way by an external specification; not ours to change.
const EXEMPT = ['aria-labelledby', 'ProgramMenuFolder'];

const SKIP_DIRS = new Set(['.git', 'target', 'node_modules', 'dist', 'imgs']);
// Third-party text, generated files, and anything that is not prose.
const SKIP_PATHS = [
  // This file is the word list; every entry in it is a hit by construction.
  'scripts/check-spelling.mjs',
  'src/assets/vendor/',
  'site/vendor/',
  'src/assets/noto-fonts.css',
  'site/noto-fonts.css',
  'src/assets/themes.md',
  'Cargo.lock',
  'llms-full.txt',
  'llms.txt',
  'sitemap.xml',
  'sitemap-md.txt',
  // Somebody else's writing, kept in the giveaway folder to read. Nothing here may edit it, so a British spelling in it is not this repo's to correct — and both copies carry one.
  '../docs/learn/llm-wiki-karpathy-src.md',
  '../docs/learn/ticket-workflow-medium/sources/llm-wiki-karpathy-src.md',
  // Byte copies of this repo's own skills, held identical to their sources by `check-learn-snapshots`. A hit here would have to be fixed at the source, where this walk already finds it, and fixing it in the copy is refused as drift.
  '../docs/learn/ticket-workflow-medium/skills/',
];
const TEXT = /\.(rs|js|mjs|mts|ts|css|html|md|txt|toml|json|yml|yaml|wxs|rc)$/;

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else out.push(full);
  }
  return out;
}

const suffixes = ['', 's', 'd', 'ing', 'ed', 'es', 'ly', 'ment'];
const pattern = new RegExp(
  `\\b(${Object.keys(BRITISH).join('|')})(${suffixes.filter(Boolean).join('|')})?\\b`,
  'gi'
);

// The tickets live in the plan tree, beside the app and outside this git repo, so the walk above never reached them. Live and held plans can still be built; `done/` and `canceled/` are history.
//
// `learn/` is the giveaway folder, and most of it is this repo's own writing handed to a reader who has never seen this workflow — which is the writing this rule was written for, since a stranger reads it as an example of how the tree writes. The two borrowed pages and the ten byte copies of skills are carved out in `SKIP_PATHS` above, each with the reason it cannot be corrected here.
const TICKET_PATHS = ['README.md', 'PLAN.md', 'GLOSSARY.md', 'features', 'refactor', 'fixes', 'on-hold', 'learn'];

/** Whether a path, written the way the walk below writes it, is prose this repo is allowed to respell. */
function scanned(rel) {
  return TEXT.test(rel) && !SKIP_PATHS.some((skip) => rel.startsWith(skip) || rel === skip);
}

// The carve-outs are the whole risk: reach one file too far and the fix is refused by another check, one file too few and the writing this rule exists for goes unread.
const SCAN_CASES = [
  ["a giveaway page this repo wrote is read", '../docs/learn/ticket-workflow-linkedin/AUDIT.md', true],
  ['an article draft is read', '../docs/learn/ticket-workflow-medium/leaftext-workflow-v5.md', true],
  ['the page about this app is read', '../docs/learn/offered-field-names.md', true],
  ['the borrowed page is left as it was written', '../docs/learn/llm-wiki-karpathy-src.md', false],
  ['so is the second copy of it', '../docs/learn/ticket-workflow-medium/sources/llm-wiki-karpathy-src.md', false],
  ['a byte copy of a skill is fixed at its source, never here', '../docs/learn/ticket-workflow-medium/skills/done/SKILL.md', false],
  ["the skill itself is read, which is where that fix lands", '.agents/skills/done/SKILL.md', true],
  ['a picture is not prose', '../docs/learn/a.png', false],
];

function scanSelfTest() {
  const fails = [];
  for (const [name, rel, want] of SCAN_CASES) {
    const got = scanned(rel);
    if (got !== want) fails.push(`${name}: read ${got}, want ${want}`);
  }
  return fails;
}

const scanFails = scanSelfTest();
if (scanFails.length) {
  console.error('spelling: what this reads is wrong, so nothing was read:');
  for (const line of scanFails) console.error(`  ${line}`);
  process.exit(1);
}
function ticketFiles() {
  const out = [];
  for (const path of TICKET_PATHS) {
    const full = join(planTree(root), path);
    // A clone of `app/` alone has no sibling docs tree; that is not a failure.
    if (!existsSync(full)) continue;
    out.push(...(statSync(full).isDirectory() ? files(full) : [full]));
  }
  return out;
}

const hits = [];
for (const file of [...files(root), ...ticketFiles()]) {
  const rel = relative(root, file).split('\\').join('/');
  if (!scanned(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    let stripped = line;
    for (const exempt of EXEMPT) stripped = stripped.split(exempt).join('');
    for (const match of stripped.matchAll(pattern)) {
      const word = match[1].toLowerCase();
      hits.push({ rel, line: index + 1, found: match[0], use: BRITISH[word] });
    }
  });
}

if (hits.length) {
  console.error(`British spelling in ${hits.length} place(s) — this repo writes US English:`);
  for (const hit of hits) {
    console.error(`  ${hit.rel}:${hit.line}  ${hit.found} -> ${hit.use}`);
  }
  process.exit(1);
}
console.log('spelling: US English throughout, the giveaway writing this repo authors included');
