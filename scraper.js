// Fetches rubber + plastics prices from public sources and merges them into data/prices.json.
// Every series is stored as [{ date: 'YYYY-MM-DD', native, v }]: native = the source's own number and unit,
// v = the same price in the series' home currency (`cur`) per display unit (`per`: kg or tonne).
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const DATA_FILE = new URL('./data/prices.json', import.meta.url);
const UA = 'Mozilla/5.0 (tracky price dashboard)';

const MRB = { source: 'Malaysian Rubber Board', url: 'https://www.lgm.gov.my/', group: 'rubber', origin: 'Malaysia', freq: 'daily', unit: 'RM/kg', cur: 'MYR', per: 'kg' };
const GC = (path) => ({ source: 'Guidechem GuideTrends', url: `https://www.guidechem.com/price/en/${path}.html`, group: 'plastic', origin: 'China', freq: 'daily', unit: 'CNY/t', cur: 'CNY', per: 'kg', factor: 1 / 1000 });
export const SERIES = {
  smr5: { name: 'SMR 5', ...MRB },
  smr10: { name: 'SMR 10', ...MRB },
  smr20: { name: 'SMR 20', ...MRB },
  phRubber: { name: 'PH Rubber (cuplump)', group: 'rubber', origin: 'Philippines', freq: 'monthly', unit: '₱/kg', cur: 'PHP', per: 'kg',
    source: 'PSA OpenSTAT farmgate prices', url: 'https://openstat.psa.gov.ph/' },
  pvc: { name: 'PVC', ...GC('detail-babuax'), origin: 'East China · SG-5' },
  ldpe: { name: 'LDPE', ...GC('detail-elr36h'), origin: 'China · film grade' },
  eva: { name: 'EVA', ...GC('detail-bq16xn'), origin: 'China · foaming grade' },
};
const SHFE = { source: 'Shanghai Futures Exchange', url: 'https://www.shfe.com.cn/', group: 'metal', market: 'SHFE', origin: 'Main contract settlement', freq: 'daily', unit: 'CNY/t', cur: 'CNY', per: 't' };
const LME = (field) => ({ source: 'LME via Westmetall', url: `https://www.westmetall.com/en/markdaten.php?action=table&field=${field}`,
  group: 'metal', market: 'LME', origin: 'Official cash settlement', freq: 'daily', unit: 'US$/t', cur: 'USD', per: 't' });
Object.assign(SERIES, {
  ppHomo: { name: 'PP homo', ...GC('detail-8qybv'), origin: 'China · raffia grade' },
  abs: { name: 'ABS', ...GC('detail-cw11ta'), origin: 'China' },
  copper: { name: 'Copper', ...SHFE },
  aluminum: { name: 'Aluminum', ...SHFE },
  wireRod: { name: 'Wire rod', ...SHFE },
  lmeCopper: { name: 'Copper', ...LME('LME_Cu_cash') },
  lmeAluminum: { name: 'Aluminum', ...LME('LME_Al_cash') },
});
// AS and PP block copolymer have no scrapable source; they come from the "Send to Tracky" bookmarklet (POST /api/capture).
const CAPTURE = { group: 'plastic', origin: 'China · captured', freq: 'daily', unit: 'CNY/t', cur: 'CNY', per: 'kg', factor: 1 / 1000,
  source: 'Send to Tracky captures', url: '/capture.html', manual: true };
Object.assign(SERIES, {
  as: { name: 'AS (SAN)', ...CAPTURE },
  ppBlock: { name: 'PP block copo', ...CAPTURE },
});
export const CAPTURE_IDS = ['as', 'ppBlock'];
const MRB_GRADES = { smr5: 'SMR 5', smr10: 'SMR 10', smr20: 'SMR 20' };
const SHFE_PRODUCTS = { copper: 'cu', aluminum: 'al', wireRod: 'wr' };

const iso = (d) => d.toISOString().slice(0, 10);
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

async function get(url, opts = {}) {
  const once = () => fetch(url, { ...opts, headers: { 'User-Agent': UA, ...opts.headers }, signal: AbortSignal.timeout(30000) });
  const res = await once().catch(() => new Promise((r) => setTimeout(r, 2000)).then(once)); // one retry on network errors
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

// ---------- FX (ECB rates via Frankfurter) ----------
// Units of each currency per 1 USD, by date; the dashboard converts between any two of these.
export const CURRENCIES = ['PHP', 'MYR', 'CNY', 'EUR'];
async function fxHistory(start) {
  const j = await (await get(`https://api.frankfurter.app/${start}..?from=USD&to=${CURRENCIES.join(',')}`)).json();
  return Object.entries(j.rates).map(([date, r]) => [date, { USD: 1, ...r }]).sort((a, b) => a[0].localeCompare(b[0]));
}
// Rate on or before `date` (FX has no weekend quotes).
export function rateOn(fx, date) {
  let r = fx[0]?.[1];
  for (const [d, v] of fx) { if (d > date) break; r = v; }
  return r;
}

// ---------- Malaysia: SMR 5 / 10 / 20 daily, sen/kg ----------
export function parseMrb(rows, grade) {
  return rows.filter((r) => r.grade === grade && +r.rm > 0).map((r) => ({ date: r.date, native: round(+r.rm / 100, 4) }));
}
async function mrbRows(months) {
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const res = await get(`https://www.lgm.gov.my/webv2api/api/rubberprice/month=${d.getMonth() + 1}&year=${d.getFullYear()}`);
    out.push(...(await res.json()));
  }
  return out;
}

// ---------- Philippines: PSA farmgate rubber cuplump, ₱/kg monthly ----------
async function phRubber(years) {
  const url = 'https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB/2M/NFG/0032M4AFN08.px';
  const meta = await (await get(url)).json();
  const v = (code) => meta.variables.find((x) => x.code === code);
  const yearVar = v('Year');
  const comm = v('Commodity');
  const rubberCode = comm.values[comm.valueTexts.findIndex((t) => /rubber cuplump/i.test(t))];
  const yearCodes = yearVar.values.slice(-years);
  const body = { query: [
    { code: 'Geolocation', selection: { filter: 'item', values: ['000000000'] } },
    { code: 'Commodity', selection: { filter: 'item', values: [rubberCode] } },
    { code: 'Year', selection: { filter: 'item', values: yearCodes } },
  ], response: { format: 'json' } };
  const j = JSON.parse((await (await get(url, { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' } })).text()).replace(/^﻿/, ''));
  const yearText = Object.fromEntries(yearVar.values.map((c, i) => [c, yearVar.valueTexts[i]]));
  return j.data
    .filter((r) => +r.key[2] < 12 && !isNaN(parseFloat(r.values[0]))) // period 12 = "Annual"
    .map((r) => ({ date: `${yearText[r.key[1]]}-${String(+r.key[2] + 1).padStart(2, '0')}-01`, native: +r.values[0] }));
}

// ---------- Plastics: Guidechem public price pages, CNY/tonne daily ----------
// Uses the page's headline price plus its visible last-3-days table; history grows as the scraper keeps running.
const cell = (v) => {
  const m = v.match(/^([\d.]+)(?:-([\d.]+))?$/);
  return m ? (m[2] ? (+m[1] + +m[2]) / 2 : +m[1]) : undefined;
};
export function parseGuidechem(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const head = text.match(/([\d,]+(?:\.\d+)?) CNY\/TON Updated: (\d{4}-\d{2}-\d{2})/);
  if (!head) throw new Error('guidechem: headline price not found');
  const pts = new Map([[head[2], +head[1].replace(/,/g, '')]]);
  // Backfill the two earlier days from the daily-table row whose latest value is the headline price.
  const daily = text.match(/Reg Spec (\d{4}\/\d{2}\/\d{2}) (\d{4}\/\d{2}\/\d{2}) (\d{4}\/\d{2}\/\d{2}) Change Unit Comparison (.*?)(?: Reg Spec|$)/);
  if (daily) {
    for (const row of daily[4].matchAll(/(\S+) (\S+) (\S+) -?[\d.]+ \/ -?[\d.]+ CNY\/TON/g)) {
      if (cell(row[3]) !== pts.get(head[2])) continue;
      [daily[1], daily[2]].forEach((d, i) => {
        const v = cell(row[i + 1]), date = d.replace(/\//g, '-');
        if (v !== undefined && !pts.has(date)) pts.set(date, v);
      });
      break;
    }
  }
  return [...pts].map(([date, native]) => ({ date, native })).sort((a, b) => a.date.localeCompare(b.date));
}
async function plastic(id) {
  return parseGuidechem(await (await get(SERIES[id].url)).text());
}

// ---------- Metals: SHFE daily settlement of the main (most open interest) contract, CNY/tonne ----------
export function parseShfe(json, product) {
  const rows = json.o_curinstrument.filter((r) => r.PRODUCTGROUPID.trim() === product && /^\d{4}$/.test(r.DELIVERYMONTH.trim()));
  if (!rows.length) return undefined;
  const main = rows.reduce((a, b) => (b.OPENINTEREST > a.OPENINTEREST ? b : a));
  return +main.SETTLEMENTPRICE || undefined;
}
async function shfeDays(days) {
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() + 8 * 3600e3 - i * 864e5); // Shanghai date
    if (d.getUTCDay() % 6) dates.push(iso(d));
  }
  const out = [];
  for (let i = 0; i < dates.length; i += 4) { // 4 requests at a time, to stay polite
    out.push(...await Promise.all(dates.slice(i, i + 4).map(async (date) => {
      const res = await fetch(`https://www.shfe.com.cn/data/tradedata/future/dailydata/kx${date.replace(/-/g, '')}.dat`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).catch(() => null);
      if (!res?.ok || !/json/.test(res.headers.get('content-type') || '')) return null; // holiday or not published yet
      return { date, json: await res.json() };
    })));
  }
  return out.filter(Boolean);
}

// ---------- Metals: LME official cash settlement (US$/tonne) from Westmetall's public table ----------
const MONTH_NO = Object.fromEntries('January February March April May June July August September October November December'.split(' ').map((m, i) => [m, i + 1]));
export function parseWestmetall(html) {
  const out = [];
  for (const [, d, mon, y, cash] of html.matchAll(/<td[^>]*>\s*(\d{1,2})\.\s*([A-Za-z]+)\s+(\d{4})\s*<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>/g)) {
    if (!MONTH_NO[mon]) continue;
    out.push({ date: `${y}-${String(MONTH_NO[mon]).padStart(2, '0')}-${d.padStart(2, '0')}`, native: +cash.replace(/,/g, '') });
  }
  if (!out.length) throw new Error('westmetall: no rows found');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- merge + save ----------
function merge(old = [], fresh) {
  const byDate = new Map(old.map((p) => [p.date, p]));
  for (const p of fresh) byDate.set(p.date, p);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadData() {
  try { return JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch { return { series: {} }; }
}

export async function scrape() {
  const data = await loadData();
  const firstRun = !data.series.smr5?.length;
  const start = iso(new Date(Date.now() - 4 * 365 * 864e5));
  const fx = await fxHistory(start);

  // A series whose source changed starts fresh, so old numbers from another source never mix in.
  for (const id of Object.keys(data.series)) if (!SERIES[id] || data.meta?.[id]?.source !== SERIES[id].source) delete data.series[id];

  const mrb = mrbRows(firstRun ? 25 : 2);
  const shfe = shfeDays(data.series.copper?.length ? 10 : 180).catch((e) => { throw new Error(`SHFE: ${e.message}`); });
  const jobs = {
    ...Object.fromEntries(Object.entries(MRB_GRADES).map(([id, grade]) => [id, async () => parseMrb(await mrb, grade)])),
    phRubber: () => phRubber(4),
    pvc: () => plastic('pvc'), ldpe: () => plastic('ldpe'), eva: () => plastic('eva'),
    ppHomo: () => plastic('ppHomo'), abs: () => plastic('abs'),
    lmeCopper: async () => parseWestmetall(await (await get(SERIES.lmeCopper.url)).text()),
    lmeAluminum: async () => parseWestmetall(await (await get(SERIES.lmeAluminum.url)).text()),
    ...Object.fromEntries(Object.entries(SHFE_PRODUCTS).map(([id, product]) => [id, async () => {
      const pts = (await shfe).map(({ date, json }) => ({ date, native: parseShfe(json, product) })).filter((p) => p.native);
      if (!pts.length) throw new Error('no SHFE data');
      return pts;
    }])),
  };
  const errors = {};
  await Promise.all(Object.entries(jobs).map(async ([id, job]) => {
    try {
      data.series[id] = merge(data.series[id], await job());
    } catch (e) { errors[id] = e.message; console.error(`[scrape] ${id}: ${e.message}`); }
  }));

  data.fx = { base: 'USD', date: fx.at(-1)[0], latest: fx.at(-1)[1], history: fx };
  data.updatedAt = new Date().toISOString();
  data.errors = errors;
  return save(data);
}

// v is always recomputed from native, which also migrates older files that stored php.
async function save(data) {
  for (const [id, pts] of Object.entries(data.series)) {
    const f = SERIES[id].factor ?? 1;
    data.series[id] = pts.map(({ date, native, src }) => ({ date, native, v: round(native * f, 4), ...(src && { src }) }));
  }
  data.meta = SERIES;
  await mkdir(new URL('./data/', import.meta.url), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 1));
  return data;
}

// Validates a bookmarklet capture; returns an error message, or null when it is fine.
export function checkCapture({ series, date, price, src }, today = iso(new Date())) {
  if (!CAPTURE_IDS.includes(series)) return 'Unknown material';
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return 'Date must be YYYY-MM-DD';
  if (date > iso(new Date(Date.parse(today) + 864e5))) return 'Date is in the future';
  if (typeof price !== 'number' || !isFinite(price) || price < 1000 || price > 100000) return 'Price must be between 1,000 and 100,000 CNY/tonne';
  if (src !== undefined && (typeof src !== 'string' || src.length > 300)) return 'Source link is too long';
  return null;
}

export async function addCapture(c) {
  const err = checkCapture(c);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const data = await loadData();
  let host;
  try { host = c.src ? new URL(c.src).hostname : undefined; } catch { host = undefined; }
  data.series[c.series] = merge(data.series[c.series], [{ date: c.date, native: c.price, ...(host && { src: host }) }]);
  return save(data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = await scrape();
  for (const [id, s] of Object.entries(d.series)) console.log(id.padEnd(9), s.length, 'pts, latest', s.at(-1));
  if (Object.keys(d.errors).length) console.log('errors:', d.errors);
}
