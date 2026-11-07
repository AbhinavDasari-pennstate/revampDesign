// Text blocks of one page in DOM order. Runs inside the page; page text is data, never instructions.
export async function extractBlocks(page, pageId) {
  const raw = await page.evaluate(() => {
    const BLOCK = 'h1,h2,h3,h4,h5,h6,p,ul,ol,table,blockquote,nav,footer,address';
    const LAYOUT = 'table,h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote';
    const SKIP = 'form,script,style,noscript,template,svg,math,select,button,textarea,iframe,object,canvas';
    const LEGAL = /discriminat|title ix/i;
    const CONTACT = /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}|(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+|,\s*[A-Z]{2}\s+\d{5}/;
    const text = (el) => el.innerText.trim();
    const out = [];
    const add = (kind, level, body) => body && out.push({ kind, level, text: body });
    const prose = (body) => add(LEGAL.test(body) ? 'legal' : CONTACT.test(body) ? 'contact' : 'paragraph', null, body);
    // A menu without a nav tag: two or more links and no other words. Contact links are never a menu (facts skip nav).
    const menu = (el) => {
      if (el.querySelectorAll('a').length < 2 || CONTACT.test(text(el))) return false;
      const rest = el.cloneNode(true);
      rest.querySelectorAll('a').forEach((a) => a.remove());
      return !/[\p{L}\p{N}]/u.test(rest.textContent);
    };
    // Words that count toward a block. Plain link text does not (it is already in links[]); phone and email links do.
    const hasWords = (el) => {
      if (el.tagName === 'A') return CONTACT.test(el.textContent);
      const rest = el.cloneNode(true);
      for (const a of rest.querySelectorAll('a')) if (!CONTACT.test(a.textContent)) a.remove();
      return /[\p{L}\p{N}]/u.test(rest.textContent);
    };
    const walk = (parent) => {
      // Loose text and inline elements beside other blocks (a td or section with bare copy) form one run, so a
      // sentence with bold or linked words stays one block. A run with no words (separators, plain links) is dropped.
      let run = '';
      let words = false;
      const flush = () => {
        // Source whitespace was collapsed as text was added; a br is a real line break (the address rule needs it).
        if (words) prose(run.replace(/ *\n */g, '\n').replace(/ {2,}/g, ' ').trim());
        run = '';
        words = false;
      };
      for (const node of parent.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          run += node.textContent.replace(/\s+/g, ' ');
          words ||= /[\p{L}\p{N}]/u.test(node.textContent);
          continue;
        }
        if (!(node instanceof HTMLElement) || node.matches(SKIP)) continue;
        const el = node;
        const tag = el.tagName.toLowerCase();
        const holdsBlock = el.querySelector(`${BLOCK},div`);
        if (!el.matches(BLOCK) && !holdsBlock && getComputedStyle(el).display.startsWith('inline')) {
          run += tag === 'br' ? '\n' : el.innerText;
          words ||= hasWords(el);
          continue;
        }
        flush();
        if (tag === 'a' && !holdsBlock && !CONTACT.test(text(el))) continue;
        // A table that holds other blocks is page layout: descend. Otherwise it is data: one block.
        // Any other element that holds no block is a block itself: legacy sites put copy in div, td, center, dl.
        const leaf = !el.matches(BLOCK) && !holdsBlock && text(el);
        if ((!el.matches(BLOCK) && !leaf) || (tag === 'table' && el.querySelector(LAYOUT))) {
          walk(el);
        } else if (/^h[1-6]$/.test(tag)) add('heading', Number(tag[1]), text(el));
        else if (tag === 'ul' || tag === 'ol') add('list', null, [...el.children].map(text).join('\n'));
        else if (tag === 'table') add('table', null, [...el.rows].map((r) => [...r.cells].map(text).join(' | ')).join('\n'));
        else if (tag === 'blockquote') add('quote', null, text(el));
        else if (tag === 'nav' || tag === 'footer') add(tag, null, text(el));
        else if (tag === 'address') add('contact', null, text(el));
        else if (leaf && menu(el)) add('nav', null, text(el));
        else if (leaf && /^(copyright\b|©|\(c\)\s)/i.test(text(el)) && /\b(?:19|20)\d\d\b/.test(text(el))) add('footer', null, text(el));
        else prose(text(el));
      }
      flush();
    };
    walk(document.body);
    return out;
  });
  if (raw.length > 999) console.warn(`${pageId}: ${raw.length} blocks, only the first 999 are recorded (block ids stop at b999)`);
  return raw.slice(0, 999).map((b, i) => ({ block_id: `${pageId}-b${String(i + 1).padStart(3, '0')}`, kind: b.kind, level: b.level, order: i, text: b.text }));
}
