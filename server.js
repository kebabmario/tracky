// Serves the dashboard + /api/prices, and re-scrapes on start and every 6 hours.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';
import { scrape, loadData, addCapture } from './scraper.js';

const PORT = process.env.PORT || 3000;
const PUBLIC = new URL('./public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// Every write to data/prices.json goes through this queue so a capture never races a scrape.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));
let scraping = null;
const refresh = () => (scraping ??= serial(scrape).catch((e) => console.error('[scrape]', e.message)).finally(() => (scraping = null)));

async function readJson(req, limit = 4096) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > limit) throw Object.assign(new Error('Too large'), { status: 413 }); }
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
refresh();
setInterval(refresh, 6 * 3600e3);

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path === '/api/prices') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(await loadData()));
    }
    if (path === '/api/refresh' && req.method === 'POST') {
      await refresh();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(await loadData()));
    }
    if (path === '/api/capture' && req.method === 'POST') {
      try {
        const c = await readJson(req);
        await serial(() => addCapture({ series: c.series, date: c.date, price: Number(c.price), src: c.src }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: e.status ? e.message : 'Could not save' }));
      }
    }
    const file = normalize(PUBLIC + (path === '/' ? 'index.html' : path));
    if (!file.startsWith(PUBLIC)) throw new Error('outside public');
    const body = await readFile(file);
    // sw.js must not be HTTP-cached so updates to it are picked up.
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', ...(path === '/sw.js' && { 'Cache-Control': 'no-cache' }) });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`tracky on http://localhost:${PORT}`));
