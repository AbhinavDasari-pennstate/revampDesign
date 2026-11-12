// Safety rule (plan/web-plan.md section 1): scraped text only ever goes into the page as React text children.
// This test fails the build when any file under src/ names a way to turn a string into markup.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const BANNED = /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write|DOMParser/;

const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));

export const findMarkup = (text) => text.split(/\r?\n/).flatMap((line, i) => (BANNED.test(line) ? [i + 1] : []));

describe('no markup from strings in src/', () => {
  it('catches every banned name', () => {
    for (const s of ['<div dangerouslySetInnerHTML={{ __html: x }} />', 'el.innerHTML = x', 'el.outerHTML = x', "el.insertAdjacentHTML('beforeend', x)", 'document.write(x)', 'document . write(x)', 'new DOMParser()']) {
      expect(findMarkup(s), s).toEqual([1]);
    }
    expect(findMarkup('<p>{text}</p>\nconst a = 1;')).toEqual([]);
  });

  it('finds none in any file under src/', () => {
    const files = filesUnder(srcDir);
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap((f) => findMarkup(readFileSync(f, 'utf8')).map((line) => `${relative(srcDir, f)}:${line}`));
    expect(hits).toEqual([]);
  });
});
