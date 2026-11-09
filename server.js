// Serves the dashboard + /api/prices. Locally it re-scrapes on start and every 6 hours; on Vercel a daily
// Vercel Cron calls /api/cron instead (functions are short-lived, so timers and start-up scrapes don't fit).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';
import { scrape, loadData, addCapture, addCaptures } from './scraper.js';
import { keyOk } from './auth.js';

const ON_VERCEL = !!process.env.VERCEL;
const CAPTURE_KEY = process.env.CAPTURE_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

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
if (!ON_VERCEL) {
  refresh();
  setInterval(refresh, 6 * 3600e3);
}

const sendJson = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

// Saving (captures, Refresh) needs the X-Tracky-Key header once CAPTURE_KEY is set. Locally with no key it stays
// open as before; on Vercel it is refused until CAPTURE_KEY exists, so the public site can't be written to by anyone.
function writeGuard(req, res) {
  if (!CAPTURE_KEY) {
    if (!ON_VERCEL) return true;
    sendJson(res, 403, { ok: false, error: 'Saving is turned off on this site: add a CAPTURE_KEY environment variable in Vercel, then redeploy.' });
    return false;
  }
  if (keyOk(req.headers['x-tracky-key'], CAPTURE_KEY)) return true;
  sendJson(res, 401, { ok: false, needKey: true, error: req.headers['x-tracky-key'] ? 'Wrong Tracky key.' : 'This site needs your Tracky key to save.' });
  return false;
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path === '/api/prices') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(await loadData()));
    }
    if (path === '/api/refresh' && req.method === 'POST') {
      if (!writeGuard(req, res)) return;
      await refresh();
      return sendJson(res, 200, await loadData({ fresh: true }));
    }
    // Vercel Cron: GET with "Authorization: Bearer <CRON_SECRET>".
    if (path === '/api/cron') {
      if (!keyOk((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), CRON_SECRET)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      try {
        const d = await serial(scrape);
        return sendJson(res, 200, { ok: true, updatedAt: d.updatedAt, errors: d.errors });
      } catch (e) {
        console.error('[cron]', e);
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }
    if (path === '/api/capture' && req.method === 'POST') {
      if (!writeGuard(req, res)) return;
      try {
        const c = await readJson(req, 256 * 1024);
        const r = Array.isArray(c.points)
          ? await serial(() => addCaptures({ series: c.series, src: c.src, points: c.points }))
          : (await serial(() => addCapture({ series: c.series, date: c.date, price: Number(c.price), src: c.src })), { saved: 1, skipped: 0 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, ...r }));
      } catch (e) {
        if (!e.status) console.error('[capture]', e);
        res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: e.status ? e.message : `Could not save: the server couldn't store the prices (${e.code || e.message}).` }));
      }
    }
    const file = normalize(PUBLIC + (path === '/' ? 'index.html' : path));
    if (!file.startsWith(PUBLIC)) throw new Error('outside public');
    const body = await readFile(file);
    // Pages and sw.js must revalidate every time so a new version is picked up straight away.
    const fresh = path === '/sw.js' || extname(file) === '.html';
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', ...(fresh && { 'Cache-Control': 'no-cache' }) });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`tracky on http://localhost:${PORT}`));
