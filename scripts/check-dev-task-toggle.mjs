#!/usr/bin/env node
// Recording progress must never reach a running window: reading a ticket through the app fronts its page and the toggle refuses a document that is not already there, so a tick takes the owner's page and keyboard every time a box finishes. The check holds the build skill to the file-safe edit and refuses either app call anywhere in it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillPath = '.agents/skills/dev/SKILL.md';
const routeAnchor = '**Tick the ticket file, never a window.**';
const timingAnchor = '**So: never a sweep afterwards, and never ahead.**';

const route = [
  ['file-safe edit', 'name the host\'s file-safe edit as the route'],
  ['`- [ ]`', 'name the empty marker the tick replaces'],
  ['`- [x]`', 'name the ticked marker it writes'],
  ['same edit', 'tick in the same edit as the code and test'],
  ['`leaftext_doc`', 'name `leaftext_doc` so it can be refused'],
  ['`leaftext_toggle_task`', 'name `leaftext_toggle_task` so it can be refused'],
  ['forbidden', 'say both app calls are forbidden for a box'],
  ['no fallback', 'leave no fallback that opens a window'],
];

const timing = [
  ['never a sweep', 'refuse a sweep after the work'],
  ['never ahead', 'refuse a box ticked ahead of its work'],
  ['at no other moment', 'pin the tick to the moment the code and test are both in'],
];

// A direction to reach either tool, however it is worded, is the failure; the rule names both only to forbid them, so the names come before the verb rather than after it.
const directsApp = /\b(?:call|calls|calling|use|uses|using|ask|asks|asking|read|reads|reading|tick|ticks|ticking|toggle|toggles|toggling|through|via|with)\s+(?:the\s+|its\s+|an?\s+)?(?:app'?s?\s+)?`leaftext_(?:doc|toggle_task)`/i;

function block(text, anchor) {
  return text.split(/\n\s*\n/).find((part) => part.startsWith(anchor)) ?? null;
}

export function faults(text) {
  const problems = [];
  const routeBlock = block(text, routeAnchor);
  if (routeBlock === null) problems.push(`${skillPath} has no rule opening ${routeAnchor}`);
  else problems.push(...route.filter(([pin]) => !routeBlock.includes(pin)).map(([, problem]) => problem));
  const timingBlock = block(text, timingAnchor);
  if (timingBlock === null) problems.push(`${skillPath} has no rule opening ${timingAnchor}`);
  else problems.push(...timing.filter(([pin]) => !timingBlock.includes(pin)).map(([, problem]) => problem));
  if (directsApp.test(text)) problems.push('the rule still sends a finished box through a running window');
  return problems;
}

const completeRoute = `${routeAnchor} After the code and test finish one box, change that box's \`- [ ]\` to \`- [x]\` with the host's file-safe edit tool, in the same edit that lands the code and test. \`leaftext_doc\` and \`leaftext_toggle_task\` are forbidden for a box and there is no fallback that opens a window.`;
const completeTiming = `${timingAnchor} A box goes from empty to ticked at the moment its code and its test are both in, and at no other moment.`;
const complete = `${completeRoute}\n\n${completeTiming}`;

const wrong = [];
if (faults(complete).length) wrong.push(`the complete rule is refused: ${faults(complete).join('; ')}`);
for (const [pin] of [...route, ...timing]) if (!faults(complete.replaceAll(pin, '')).length) wrong.push(`instructions missing ${pin} are accepted`);
for (const direction of [
  'After the code and test finish one box, call `leaftext_doc` for the ticket and tick it.',
  'Match the finished box in document order, then call `leaftext_toggle_task` with its `index`.',
  'Record the box through `leaftext_doc` and its task list.',
]) {
  if (!faults(`${complete}\n\n${direction}`).some((problem) => problem.includes('running window'))) wrong.push(`instructions saying "${direction}" are accepted`);
}
if (!faults(completeRoute).some((problem) => problem.includes(timingAnchor))) wrong.push('instructions with no one-box timing rule are accepted');
if (!faults(completeTiming).some((problem) => problem.includes(routeAnchor))) wrong.push('instructions with no tick-route rule are accepted');
if (!faults('Some other dev rule.').length) wrong.push('instructions with neither rule are accepted');
if (wrong.length) {
  console.error('the dev task-toggle check is wrong, so the shipped skill was not read:');
  for (const problem of wrong) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`dev task-toggle check: refuses ${route.length + timing.length} missing parts, three ways of reaching a running window, and either rule missing whole`);

const problems = faults(readFileSync(join(root, skillPath), 'utf8'));
if (problems.length) {
  console.error('a build can still tick a finished box through the owner\'s running window:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('dev task toggle: the finished box is ticked in the ticket file, one at a time, and no app call is left in the route');
