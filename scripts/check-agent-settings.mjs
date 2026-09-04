#!/usr/bin/env node
// What the repo's own settings file owes an agent that opens this checkout.
//
//   node scripts/check-agent-settings.mjs   (`just verify`)
//
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = '.agents/settings.json';

function settingsProblems(settingsText) {
  try {
    JSON.parse(settingsText);
  } catch {
    return [`${SETTINGS} is not valid JSON, so every hook and approval in it is off`];
  }
  return [];
}

// A hook row is a command the host runs before it will read a message, and a row naming a script that is not here fails silently: the host reports the miss to nobody, the rule that script held is simply off, and the next person to notice is whoever meets what it was stopping. So a deleted script has to take its row with it, and this is what says so.
const SCRIPT_NAMED = /scripts[\\/]([A-Za-z0-9._-]+)/g;

// A gate script is any scripts/gate-*.mjs. One definition, shared by the import guard and every direction below, so there is never a second glob to drift apart from this one.
const GATE_SCRIPT = /^gate-.*\.mjs$/;

function hookProblems(settingsText, hasScript) {
  let hooks;
  try {
    hooks = JSON.parse(settingsText).hooks ?? {};
  } catch {
    return [];
  }

  const found = [];
  for (const [event, rows] of Object.entries(hooks)) {
    for (const row of rows ?? []) {
      for (const hook of row.hooks ?? []) {
        for (const [, name] of String(hook.command ?? '').matchAll(SCRIPT_NAMED)) {
          if (!hasScript(name)) found.push(`${SETTINGS} runs "scripts/${name}" on ${event}, and this repo has no such file`);
        }
      }
    }
  }
  return found;
}

// The other direction, which nothing held: a hook is the only code here that runs without anything calling it, so a gate script reached by no hook row is a rule that is simply off — still on disk, still passing its own --check, and inert. Reached means a hook row names it, or a reached gate script imports it: a gate whose whole job is read out of another gate has no row of its own, so a bare no-row rule would fail a tree that is right.
const IMPORTS_GATE = /^import\b[^\n]*?['"][^'"]*?(gate-[A-Za-z0-9._-]+\.mjs)['"]/gm;

function reachProblems(settingsText, sources) {
  let hooks;
  try {
    hooks = JSON.parse(settingsText).hooks ?? {};
  } catch {
    return [];
  }
  const reached = new Set();
  for (const rows of Object.values(hooks)) {
    for (const row of rows ?? []) {
      for (const hook of row.hooks ?? []) {
        for (const [, name] of String(hook.command ?? '').matchAll(SCRIPT_NAMED)) {
          if (sources.has(name)) reached.add(name);
        }
      }
    }
  }
  const queue = [...reached];
  while (queue.length) {
    for (const [, name] of String(sources.get(queue.pop()) ?? '').matchAll(IMPORTS_GATE)) {
      if (sources.has(name) && !reached.has(name)) {
        reached.add(name);
        queue.push(name);
      }
    }
  }
  return [...sources.keys()].filter((name) => !reached.has(name)).sort()
    .map((name) => `nothing reaches scripts/${name}: no hook row in ${SETTINGS} names it and no reached gate script imports it, so the rule it holds is off`);
}

// The justfile's check-hooks recipe is a hand list, one `--check` line per gate script, so a new script left off it has its self-test run by nothing. Held to the folder rather than generated: a justfile recipe is static text, and a build step writing the justfile is heavier than holding a few lines to a glob.
function selfTestProblems(justfileText, names) {
  const recipe = /^check-hooks:\r?\n((?:[ \t]+[^\n]*\n?)*)/m.exec(justfileText)?.[1] ?? '';
  const run = new Set([...recipe.matchAll(/scripts[\\/](gate-[A-Za-z0-9._-]+\.mjs)\s+--check/g)].map((m) => m[1]));
  return names.filter((name) => !run.has(name)).map((name) => `the justfile's check-hooks recipe never runs scripts/${name} --check, so its self-test runs nowhere`);
}

// One section's body, up to the next heading at its own level or above.
function sectionBody(markdown, heading, depth) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return '';
  const stop = new RegExp(`^#{1,${depth}}\\s`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (stop.test(line) || /^---\s*$/.test(line)) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

// The layout section is two things: a pointer to the architecture page, which is the file map, and the cross-cutting rules the guide carries itself. Under one heading the rules read as a second file map, so each half owes a heading saying which it is.
export function layoutFaults(markdown) {
  const layout = sectionBody(markdown, /^##\s+Layout\b/, 2);
  if (!layout) return ['AGENTS.md: no `## Layout` section'];
  const faults = [];
  if (!/^###\s+The file map\s*$/m.test(layout)) faults.push('AGENTS.md: the layout section has no `### The file map` heading');
  if (!/docs\/02-development\/01-architecture\.md/.test(layout)) faults.push('AGENTS.md: the layout section no longer points at the architecture page, which is the file map');
  if (!/^###\s+Rules the file map does not carry\s*$/m.test(layout)) faults.push('AGENTS.md: the cross-cutting rules have no heading of their own, so they read as a second file map');
  return faults;
}

// The guide's ## Hooks section is the third hand list of the same scripts, and it had already drifted — six bullets while scripts/ held seven. The count stays out of the sentence above the bullets; a sentence with no number has no number to rot.
function guideProblems(agentsText, names) {
  const section = /^## Hooks\r?\n([\s\S]*?)(?=\r?\n## |(?![\s\S]))/m.exec(agentsText)?.[1] ?? '';
  const listed = new Set([...section.matchAll(/^- `(gate-[A-Za-z0-9._-]+\.mjs)`/gm)].map((m) => m[1]));
  return names.filter((name) => !listed.has(name)).map((name) => `AGENTS.md's ## Hooks list has no bullet for ${name}, so the guide does not say the rule exists`);
}

const problems = [];
if (settingsProblems('{').length !== 1) {
  problems.push('this check does not report unreadable JSON as one problem');
}

// The same shape, once per way a hook row can name a script that is not here. `here` is the pretend repo: everything else is gone.
const here = (name) => name === 'gate-rules.mjs';
const row = (command) => JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }] } });
// One event carrying a row per matcher is the ordinary shape here — the edit tools and the shell tools are measured separately on the same event — so a check reading only the first row would wave the second one through.
const rows = (...commands) => JSON.stringify({
  hooks: { PostToolUse: commands.map((command, i) => ({ matcher: i ? 'Write|Edit|NotebookEdit' : 'Bash|PowerShell', hooks: [{ type: 'command', command }] })) },
});
const HOOK_CASES = [
  ['a row running a script the repo does not have', row('node "${CLAUDE_PROJECT_DIR}/scripts/gate-gone.mjs"'), true],
  ['the same row written with backslashes', row('node "${CLAUDE_PROJECT_DIR}\\scripts\\gate-gone.mjs"'), true],
  ['a second script on one command line', row('node scripts/gate-rules.mjs && node scripts/gate-gone.mjs'), true],
  ['a second row on one event naming a script the repo does not have', rows('node scripts/gate-rules.mjs', 'node scripts/gate-gone.mjs'), true],
  ['two rows on one event that both name a script that is here', rows('node scripts/gate-rules.mjs', 'node scripts/gate-rules.mjs'), false],
  ['every script it names being here', row('node "${CLAUDE_PROJECT_DIR}/scripts/gate-rules.mjs"'), false],
  ['a settings file with no hooks at all', '{}', false],
];
for (const [name, text, shouldFail] of HOOK_CASES) {
  const found = hookProblems(text, here);
  if (shouldFail && !found.length) problems.push(`this check misses ${name}`);
  if (!shouldFail && found.length) problems.push(`this check fails ${name}: ${found[0]}`);
}

// The reach direction on made-up trees before the real one is opened. `src` is a pretend scripts folder: name to source text.
const src = (...entries) => new Map(entries);
const REACH_CASES = [
  ['a gate script nothing names', '{}', src(['gate-a.mjs', '']), 1],
  ['a gate script a hook row names', row('node scripts/gate-a.mjs'), src(['gate-a.mjs', '']), 0],
  ['a gate script reached only by an import from a rowed one', row('node scripts/gate-a.mjs'), src(['gate-a.mjs', "import { x } from './gate-b.mjs';"], ['gate-b.mjs', '']), 0],
  ['two rowless gate scripts importing only each other', '{}', src(['gate-c.mjs', "import './gate-d.mjs';"], ['gate-d.mjs', "import './gate-c.mjs';"]), 2],
];
for (const [name, settings, sources, count] of REACH_CASES) {
  const found = reachProblems(settings, sources);
  if (found.length !== count) problems.push(`this check reads ${name} wrong: expected ${count} problems, found ${found.length}`);
}

// The two list directions, on a recipe and a guide invented here. The second recipe proves a --check line outside check-hooks does not count.
const RECIPE = 'check-hooks:\n    node scripts/gate-a.mjs --check\n\nother:\n    node scripts/gate-b.mjs --check\n';
if (selfTestProblems(RECIPE, ['gate-a.mjs']).length) problems.push('this check misses a --check line that is in the recipe');
if (!selfTestProblems(RECIPE, ['gate-b.mjs']).length) problems.push("this check reads a --check line in another recipe as check-hooks's");

const AGENTS = readFileSync(join(root, 'AGENTS.md'), 'utf8');
problems.push(...layoutFaults(AGENTS));
// The three cases mutate the real guide rather than a fixture, so renaming a heading fails here instead of passing against a copy.
if (!layoutFaults(AGENTS.replace(/^### The file map$/m, '### Where things live')).length) {
  problems.push('this check passes a guide whose file map lost its heading');
}
if (!layoutFaults(AGENTS.replace(/docs\/02-development\/01-architecture\.md/g, 'docs/02-development/')).length) {
  problems.push('this check passes a guide that stopped naming the architecture page');
}
if (!layoutFaults(AGENTS.replace(/^### Rules the file map does not carry$/m, '### More')).length) {
  problems.push('this check passes a guide whose cross-cutting rules lost their heading');
}

const GUIDE = '## Hooks\n\nOne sentence.\n\n- `gate-a.mjs` — what it holds.\n\n## Next\n';
if (guideProblems(GUIDE, ['gate-a.mjs']).length) problems.push('this check misses a bullet that is in the guide');
if (!guideProblems(GUIDE, ['gate-b.mjs']).length) problems.push('this check passes a gate script with no bullet in the guide');

// Every hook must be importable without its body running: gate-voice.mjs imports three of its neighbors, so hook-imports-hook is the normal shape here, and an unguarded body reads a stream nobody is writing — the importer hangs with no message. The child's standard input is closed so an unguarded hook cannot hang this check: it exits the child before the sentinel prints, or runs its body instead, and either way the sentinel goes missing.
function importProblems(dir = join(root, 'scripts')) {
  const found = [];
  for (const name of readdirSync(dir).filter((file) => GATE_SCRIPT.test(file)).sort()) {
    const url = pathToFileURL(join(dir, name)).href;
    let out = '';
    try {
      out = execFileSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(url)}; console.log('imported');`], { input: '', encoding: 'utf8' });
    } catch (error) {
      found.push(`scripts/${name} cannot be imported without its body acting: ${String(error.message).split('\n')[0]}`);
      continue;
    }
    if (out.trim() !== 'imported') found.push(`scripts/${name} ran its body on import, so the first thing that imports it wedges the turn`);
  }
  return found;
}

const settingsText = readFileSync(join(root, SETTINGS), 'utf8');
const gateSources = new Map(readdirSync(join(root, 'scripts')).filter((file) => GATE_SCRIPT.test(file)).sort().map((name) => [name, readFileSync(join(root, 'scripts', name), 'utf8')]));
problems.push(...settingsProblems(settingsText));
problems.push(...hookProblems(settingsText, (name) => existsSync(join(root, 'scripts', name))));
problems.push(...reachProblems(settingsText, gateSources));
problems.push(...selfTestProblems(readFileSync(join(root, 'justfile'), 'utf8'), [...gateSources.keys()]));
problems.push(...guideProblems(AGENTS, [...gateSources.keys()]));
problems.push(...importProblems());

if (problems.length) {
  console.error('the repo settings file is missing something an agent needs:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('agent settings: every hook row runs a script that is here, every gate script is reached, self-tested and in the guide, every one imports without acting, and both halves of the layout section in the guide still say which half they are');
