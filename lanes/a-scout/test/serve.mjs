// Test helper: serves contracts/fixtures/sample-site/ read-only on a free port, plus in-memory extra routes
// ({ '/path': { status, type, body } }), and records every requested path in `log`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const SITE = join(import.meta.dirname, '../../../contracts/fixtures/sample-site');
const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml' };

export async function serve(extra = {}) {
  const log = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    log.push(path);
    const hit = extra[path];
    if (hit) {
      res.writeHead(hit.status ?? 200, { 'content-type': hit.type ?? 'text/html' });
      return res.end(hit.body ?? '');
    }
    const name = basename(path) || 'index.html';
    try {
      const body = await readFile(join(SITE, name));
      res.writeHead(200, { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    log,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
