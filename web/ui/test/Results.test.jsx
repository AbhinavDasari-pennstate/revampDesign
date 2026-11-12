// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import Results from '../src/Results.jsx';
import { fixture } from './fixtures.js';

const MANIFEST_URL = fixture('job-done.json').manifest_url;
const HOSTILE = '# Report\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n- **Calendar** page returned 404';

// fetch stub that answers the manifest and the report like the viewer.
function stubViewer({ manifest = fixture('manifest.json'), report = HOSTILE, reportStatus = 200 } = {}) {
  const fn = vi.fn(async (url) => {
    if (url === MANIFEST_URL) return new Response(JSON.stringify(manifest), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === fixture('manifest.json').report_url) return new Response(report, { status: reportStatus, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function show(options) {
  const fn = stubViewer(options);
  render(<Results manifestUrl={MANIFEST_URL} />);
  await screen.findByRole('tablist');
  return fn;
}
const tab = (name) => screen.getByRole('tab', { name });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Results', () => {
  it('frames the redesign and the compare page with exactly sandbox="allow-scripts" and no referrer', async () => {
    await show();
    const frames = document.querySelectorAll('iframe');
    expect(frames.length).toBe(2);
    for (const f of frames) {
      expect(f.getAttribute('sandbox')).toBe('allow-scripts');
      expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(f.getAttribute('title')).not.toBe('');
    }
    const m = fixture('manifest.json');
    expect([...frames].map((f) => f.getAttribute('src'))).toEqual([m.site.pages[0].url, m.compare_url]);
  });

  it('switches the framed page with the page picker and links the viewer URL for a new tab', async () => {
    await show();
    const m = fixture('manifest.json');
    const picker = screen.getByRole('group', { name: /pages/i });
    expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['Home', 'About', 'Contact']);
    fireEvent.click(within(picker).getByRole('button', { name: 'About' }));
    expect(within(picker).getByRole('button', { name: 'About' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('iframe').getAttribute('src')).toBe(m.site.pages[1].url);
    const open = screen.getByRole('link', { name: /new tab/i });
    expect(open.getAttribute('href')).toBe(m.site.pages[1].url);
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows desktop and mobile screenshots with alt text from the slug', async () => {
    await show();
    const imgs = [...document.querySelectorAll('img')];
    const m = fixture('manifest.json');
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(m.site.pages.flatMap((p) => [p.screenshots.desktop, p.screenshots.mobile]));
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual([
      'Home page on a computer screen', 'Home page on a phone',
      'About page on a computer screen', 'About page on a phone',
      'Contact page on a computer screen', 'Contact page on a phone',
    ]);
    for (const i of imgs) expect(i.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('says the gates and fidelity in plain words, notes it is a preview, and offers the download', async () => {
    await show();
    const body = document.body.textContent;
    expect(body).toContain('3 of 4 pages from your old site were carried over.');
    expect(body).toContain('It passed our automatic checks, with no serious or critical accessibility problems found.');
    expect(body).toMatch(/preview made by automated tools/i);
    expect(body).toMatch(/needs a person/i);
    expect(screen.getByRole('link', { name: /download/i }).getAttribute('href')).toBe(fixture('manifest.json').bundle_url);
  });

  it('offers no download when the manifest has no bundle', async () => {
    await show({ manifest: { ...fixture('manifest-no-bundle.json') } });
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
  });

  it('shows hostile report text as literal text, never as markup or a link', async () => {
    await show();
    fireEvent.click(tab(/report/i));
    const panel = screen.getByRole('tabpanel');
    await within(panel).findByRole('heading', { name: 'Report' });
    expect(panel.textContent).toContain('<script>alert(1)</script>');
    expect(panel.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel.textContent).toContain('[x](javascript:alert(1))');
    expect(panel.querySelector('script, img, a')).toBeNull();
    expect(within(panel).getByText('Calendar').tagName).toBe('STRONG');
  });

  it('refuses a manifest whose links leave the viewer origin or the job', async () => {
    const good = fixture('manifest.json');
    const bad = [
      { ...good, compare_url: 'https://evil.example/j/Xk3nP9qLm2VbT7sRw4YdHa/run/b-design/compare.html' },
      { ...good, site: { ...good.site, pages: [{ ...good.site.pages[0], url: 'javascript:alert(1)' }] } },
      { ...good, report_url: 'http://127.0.0.1:8788/j/OtherJobOtherJobOtherJ/report.md' },
      { ...good, gates: null },
      { ...good, site: { ...good.site, pages: [] } },
    ];
    for (const manifest of bad) {
      stubViewer({ manifest });
      render(<Results manifestUrl={MANIFEST_URL} />);
      expect(await screen.findByText(/could not load your results/i)).toBeTruthy();
      expect(document.querySelector('iframe')).toBeNull();
      cleanup();
    }
  });

  it('moves between the four views with the arrow keys', async () => {
    await show();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Redesign', 'Report', 'Compare directions', 'Screenshots']);
    tab('Redesign').focus();
    fireEvent.keyDown(tab('Redesign'), { key: 'ArrowRight' });
    expect(tab('Report').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Report'));
    fireEvent.keyDown(tab('Report'), { key: 'ArrowLeft' });
    fireEvent.keyDown(tab('Redesign'), { key: 'ArrowLeft' });
    expect(tab('Screenshots').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab('Screenshots').id);
  });
});
