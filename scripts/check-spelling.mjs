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

// The tickets live in `../docs`, beside the app and outside this git repo, so the walk above never reached them — which is how a British spelling got into one. Only the live plans plus the index: `done/` and `canceled/` are history, not writing to fix, but the index describes them in words written now.
const TICKET_PATHS = ['../docs/README.md', '../docs/features', '../docs/refactor'];
function ticketFiles() {
  const out = [];
  for (const path of TICKET_PATHS) {
    const full = join(root, path);
    // A clone of `app/` alone has no sibling docs tree; that is not a failure.
    if (!existsSync(full)) continue;
    out.push(...(statSync(full).isDirectory() ? files(full) : [full]));
  }
  return out;
}

const hits = [];
for (const file of [...files(root), ...ticketFiles()]) {
  const rel = relative(root, file).split('\\').join('/');
  if (!TEXT.test(rel) || SKIP_PATHS.some((skip) => rel.startsWith(skip) || rel === skip)) continue;
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
console.log('spelling: US English throughout');
