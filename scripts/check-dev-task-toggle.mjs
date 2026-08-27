#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillPath = '.agents/skills/dev/SKILL.md';
const anchor = '**Tick through Leaftext.**';
const required = [
  ['`leaftext_doc`', 'read the ticket through `leaftext_doc`'],
  ['`leaftext_toggle_task`', 'tick through `leaftext_toggle_task`'],
  ['`tasks`', 'use the returned task list'],
  ['document order', 'match the task in document order'],
  ['`index`', 'pass the task index'],
  ['`fingerprint`', 'pass the returned fingerprint'],
  ['writes the file at once', 'say the task action writes at once'],
  ['`leaftext_edit` and `leaftext_save` path is forbidden', 'forbid the generic edit-and-save path'],
  ['stale fingerprint is refused', 'handle a stale fingerprint refusal'],
  ['call `leaftext_doc` again', 'read the ticket again after a stale fingerprint'],
  ['fresh task list before retrying', 'choose the index from the fresh task list before retrying'],
];

function rule(text) {
  return text.split(/\n\s*\n/).find((block) => block.startsWith(anchor)) ?? null;
}

export function faults(text) {
  const block = rule(text);
  if (block === null) return [`${skillPath} has no rule opening ${anchor}`];
  const problems = required.filter(([pin]) => !block.includes(pin)).map(([, problem]) => problem);
  if (/\b(?:call|use) `leaftext_edit`[\s\S]*`leaftext_save`/.test(block)) problems.push('the rule still directs a finished box through the generic edit-and-save path');
  return problems;
}

const complete = `${anchor} Call \`leaftext_doc\`, use its \`tasks\` in document order, then call \`leaftext_toggle_task\` with the \`index\` and \`fingerprint\`; it writes the file at once, and the \`leaftext_edit\` and \`leaftext_save\` path is forbidden. When a stale fingerprint is refused, call \`leaftext_doc\` again and use the fresh task list before retrying.`;
const wrong = [];
if (faults(complete).length) wrong.push(`the complete rule is refused: ${faults(complete).join('; ')}`);
for (const [pin] of required) if (!faults(complete.replaceAll(pin, '')).length) wrong.push(`instructions missing ${pin} are accepted`);
const generic = `${complete} Then call \`leaftext_edit\` and \`leaftext_save\` for the checkbox.`;
if (!faults(generic).some((problem) => problem.includes('generic edit-and-save path'))) wrong.push('instructions directing the box through leaftext_edit and leaftext_save are accepted');
if (!faults('Some other dev rule.').length) wrong.push('instructions with no task-toggle rule are accepted');
if (wrong.length) {
  console.error('the dev task-toggle check is wrong, so the shipped skill was not read:');
  for (const problem of wrong) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`dev task-toggle check: refuses ${required.length} missing parts and the generic edit-and-save path, and accepts the complete rule`);

const problems = faults(readFileSync(join(root, skillPath), 'utf8'));
if (problems.length) {
  console.error('the build skill can tick a finished box without the guarded task action:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('dev task toggle: the finished box is matched from the task list and toggled with its index and fingerprint');
