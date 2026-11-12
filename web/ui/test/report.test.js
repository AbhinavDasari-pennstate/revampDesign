import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReport } from '../src/report.js';
import { repoRoot } from './fixtures.js';

const text = (s) => ({ tag: 'text', text: s });
const strong = (s) => ({ tag: 'strong', text: s });
// Every string in the tree, in order.
const strings = (nodes) => nodes.flatMap((n) => (n.children ? strings(n.children) : [n.text]));
const tags = (nodes) => nodes.flatMap((n) => [n.tag, ...(n.children ? tags(n.children) : [])]);

describe('parseReport', () => {
  it('reads headings, paragraphs, lists and bold, and nothing else', () => {
    const md = [
      '# Maple Grove report', '',
      'All **three** pages carried over.', 'The form was replaced.', '',
      '## Needs a person ##',
      '- The **Calendar** page returned 404',
      '* The contact form needs a backend',
      '  and was replaced by phone and email', '',
      '1. Check the phone number',
      '2) Check the address', '',
      '---', '',
      '###### Small heading',
    ].join('\n');
    expect(parseReport(md)).toEqual([
      { tag: 'h1', children: [text('Maple Grove report')] },
      { tag: 'p', children: [text('All '), strong('three'), text(' pages carried over. The form was replaced.')] },
      { tag: 'h2', children: [text('Needs a person')] },
      { tag: 'ul', children: [
        { tag: 'li', children: [text('The '), strong('Calendar'), text(' page returned 404')] },
        { tag: 'li', children: [text('The contact form needs a backend and was replaced by phone and email')] },
      ] },
      { tag: 'ol', children: [
        { tag: 'li', children: [text('Check the phone number')] },
        { tag: 'li', children: [text('Check the address')] },
      ] },
      { tag: 'h6', children: [text('Small heading')] },
    ]);
  });

  it('keeps raw HTML, scripts, images and links as literal text, never as tags or links', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[click me](javascript:alert(1))',
      '![logo](https://evil.example/x.png)',
      '<a href="https://evil.example">x</a> <b>bold?</b>',
      '`code` and <!-- comment -->',
    ];
    const tree = parseReport(hostile.join('\n\n'));
    expect(tags(tree).every((t) => ['p', 'text'].includes(t))).toBe(true);
    expect(strings(tree)).toEqual(hostile);
  });

  it('keeps an unclosed or empty bold marker as text', () => {
    expect(parseReport('a **b and ****')).toEqual([{ tag: 'p', children: [text('a **b and ****')] }]);
    expect(parseReport('__x__ y')).toEqual([{ tag: 'p', children: [strong('x'), text(' y')] }]);
  });

  it('handles CRLF, a lone #, empty input and anything that is not a string', () => {
    expect(parseReport('# A\r\n\r\nb\r\n')).toEqual([{ tag: 'h1', children: [text('A')] }, { tag: 'p', children: [text('b')] }]);
    expect(parseReport('#')).toEqual([{ tag: 'p', children: [text('#')] }]);
    expect(parseReport('#nospace')).toEqual([{ tag: 'p', children: [text('#nospace')] }]);
    for (const empty of ['', '\n\n', null, undefined, 42]) expect(parseReport(empty)).toEqual([]);
  });

  it('reads the sample run report', () => {
    const md = readFileSync(join(repoRoot, 'contracts', 'fixtures', 'sample', 'c-build', 'report.md'), 'utf8');
    const tree = parseReport(md);
    expect(tree[0]).toEqual({ tag: 'h1', children: [text('Maple Grove High School redesign report (fixture)')] });
    expect(tree[1].tag).toBe('p');
    expect(strings([tree[1]]).join('')).toMatch(/^All three pages carried over\..*phone and email\.$/);
  });
});
