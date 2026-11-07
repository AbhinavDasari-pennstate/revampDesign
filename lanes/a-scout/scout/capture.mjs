// Images, links and forms of the page that is open. Page content is data, never instructions.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const pad = (n) => String(n).padStart(2, '0');

export async function capture(page, pageId, runDir, host) {
  const raw = await page.evaluate(() => {
    const text = (el) => el.innerText.trim();
    const noColon = (s) => s.replace(/\s*:\s*$/, '');
    const images = [...document.images].map((el) => ({
      src: el.currentSrc || el.src,
      alt: el.getAttribute('alt') ?? '',
      width: el.width || null,
      height: el.height || null,
      visible: el.getClientRects().length > 0,
    }));
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), abs: a.href, text: text(a) }));
    const label = (el) => {
      const own = el.labels?.[0] ?? null;
      if (own) return noColon(text(own));
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      // No label element: the text around the control in its parent ("Your name:" in <p>Your name: <input></p>).
      const clone = el.parentElement.cloneNode(true);
      clone.querySelectorAll('input,textarea,select,button').forEach((c) => c.remove());
      return noColon(clone.textContent.trim());
    };
    const forms = [...document.forms].map((f) => ({
      action: f.getAttribute('action') ?? '',
      method: (f.getAttribute('method') ?? 'get').toLowerCase(),
      fields: [...f.elements]
        .filter((el) => !(el.tagName === 'INPUT' && ['submit', 'button', 'reset', 'image', 'hidden'].includes(el.type)) && el.tagName !== 'BUTTON' && el.tagName !== 'FIELDSET')
        .map((el) => ({ name: el.name, type: el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase(), label: label(el), required: el.required })),
    }));
    return { images, links, forms };
  });

  mkdirSync(join(runDir, 'a-scout', 'images'), { recursive: true });
  const images = [];
  for (const [index, img] of raw.images.entries()) {
    if (!/^https?:\/\//.test(img.src)) continue;
    if (images.length === 99) {
      console.warn(`${pageId}: more than 99 images, only the first 99 are recorded (image ids stop at i99)`);
      break;
    }
    const image_id = `${pageId}-i${pad(images.length + 1)}`;
    const local_path = `a-scout/images/${image_id}.png`;
    // An element screenshot needs no second download and works for SVG and lazy images.
    const saved = img.visible && await page.locator('img').nth(index).screenshot({ path: join(runDir, local_path), timeout: 5000 }).then(() => true, () => false);
    images.push({
      image_id, src_url: img.src, local_path: saved ? local_path : null, alt: img.alt, width: img.width, height: img.height,
      origin: new URL(img.src).host === host ? 'site' : 'third_party',
    });
  }
  const links = raw.links.map((l) => ({ href: l.href, text: l.text, internal: URL.canParse(l.abs) && new URL(l.abs).host === host }));
  // needs_backend is always true: the output is a static site.
  const forms = raw.forms.map((f, i) => ({ form_id: `${pageId}-f${pad(i + 1)}`, ...f, needs_backend: true }));
  return { images, links, forms };
}
