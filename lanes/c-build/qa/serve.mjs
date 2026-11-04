// Serves a built site on 127.0.0.1 at a free port, so the QA tools load it the way a visitor would.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function serve(dir) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    let file = resolve(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
    if (file === root || req.url.endsWith('/')) file = join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((done, failed) => {
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      done({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
