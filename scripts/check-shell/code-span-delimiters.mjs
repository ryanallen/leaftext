// The delimiter a code span is written back with: long enough that the content's own backticks stay content.

import { check, node, record } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // One code element inside a paragraph, serialized the way a committed edit serializes it.
  const written = (text) => booted.inlineDomToMarkdown(node('p', { children: [node('code', { children: [text] })] }));
  const formatted = (tag, text) => booted.inlineDomToMarkdown(node('p', { children: [node(tag, { children: [text] })] }));

  // The shortest delimiter the content cannot be mistaken for, and one padding space inside both where the content touches a backtick at either edge. The parser removes that pair, so the reader gets back exactly what is on the left.
  const SPELLINGS = [
    ['alpha', '`alpha`'],
    ['alpha` beta', '``alpha` beta``'],
    ['`alpha', '`` `alpha ``'],
    ['alpha`', '`` alpha` ``'],
    ['`alpha`', '`` `alpha` ``'],
    ['``', '``` `` ```'],
    ['a``b', '```a``b```'],
  ];

  check('a code span is written with the shortest delimiter its own text cannot be mistaken for', () => {
    for (const [text, expected] of SPELLINGS) {
      const out = written(text);
      if (out !== expected) throw new Error(`${JSON.stringify(text)} was written as ${JSON.stringify(out)} rather than ${JSON.stringify(expected)}`);
    }
  });

  check('an empty code span writes nothing', () => {
    const out = written('');
    if (out !== '') throw new Error(`an empty code span was written as ${JSON.stringify(out)}`);
  });

  check('empty bold, italic, and strikethrough wrappers write nothing', () => {
    for (const tag of ['strong', 'em', 'del']) {
      const out = formatted(tag, '');
      if (out !== '') throw new Error(`an empty ${tag} wrapper was written as ${JSON.stringify(out)}`);
    }
  });

  check('nonempty inline wrappers keep their delimiters and a one-space code span keeps its space', () => {
    const spellings = [
      [formatted('strong', 'alpha'), '**alpha**'],
      [formatted('em', 'alpha'), '*alpha*'],
      [formatted('del', 'alpha'), '~~alpha~~'],
      [written(' '), '` `'],
    ];
    for (const [out, expected] of spellings) {
      if (out !== expected) throw new Error(`${JSON.stringify(out)} was expected to be ${JSON.stringify(expected)}`);
    }
  });

  // The padding is a pair or it is nothing: one space on its own is text, and the parser only takes a space off both ends together.
  check('the padding a backtick edge needs is written inside both delimiters', () => {
    for (const [text] of SPELLINGS) {
      const out = written(text);
      const fence = out.slice(0, out.length - out.replace(/^`+/, '').length);
      const inner = out.slice(fence.length, out.length - fence.length);
      const padded = text.startsWith('`') || text.endsWith('`');
      if (inner !== (padded ? ' ' + text + ' ' : text)) throw new Error(`${JSON.stringify(text)} sits inside its delimiters as ${JSON.stringify(inner)}`);
    }
  });
}
