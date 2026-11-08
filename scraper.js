// Fetches rubber + plastics prices from public sources and merges them into data/prices.json.
// Every series is stored as [{ date: 'YYYY-MM-DD', native, php }] where php = PHP per kg.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const DATA_FILE = new URL('./data/prices.json', import.meta.url);
const UA = 'Mozilla/5.0 (tracky price dashboard)';

export const SERIES = {
  smr20: { name: 'SMR 20', group: 'rubber', origin: 'Malaysia', freq: 'daily', unit: 'RM/kg',
    source: 'Malaysian Rubber Board', url: 'https://www.lgm.gov.my/' },
  phRubber: { name: 'PH Rubber (cuplump)', group: 'rubber', origin: 'Philippines', freq: 'monthly', unit: '₱/kg',
    source: 'PSA OpenSTAT farmgate prices', url: 'https://openstat.psa.gov.ph/' },
  pvc: { name: 'PVC', group: 'plastic', origin: 'NE Asia', freq: 'monthly', unit: 'US$/kg',
    source: 'businessanalytiq price index', url: 'https://businessanalytiq.com/procurementanalytics/index/pvc-price-index/' },
  ldpe: { name: 'LDPE', group: 'plastic', origin: 'SE Asia', freq: 'monthly', unit: 'US$/kg',
    source: 'businessanalytiq price index', url: 'https://businessanalytiq.com/procurementanalytics/index/ldpe-price-index/' },
  eva: { name: 'EVA', group: 'plastic', origin: 'SE Asia', freq: 'monthly', unit: 'US$/kg',
    source: 'businessanalytiq price index', url: 'https://businessanalytiq.com/procurementanalytics/index/ethylene-vinyl-acetate-eva-price-index/' },
};

const iso = (d) => d.toISOString().slice(0, 10);
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

async function get(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...opts.headers }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

// ---------- FX (ECB rates via Frankfurter) ----------
async function fxSeries(from, start) {
  const j = await (await get(`https://api.frankfurter.app/${start}..?from=${from}&to=PHP`)).json();
  return Object.entries(j.rates).map(([date, r]) => [date, r.PHP]).sort();
}
// Rate on or before `date` (FX has no weekend quotes).
export function rateOn(fx, date) {
  let r = fx[0]?.[1];
  for (const [d, v] of fx) { if (d > date) break; r = v; }
  return r;
}

// ---------- Malaysia: SMR 20 daily, sen/kg ----------
export function parseMrb(rows) {
  return rows.filter((r) => r.grade === 'SMR 20' && +r.rm > 0).map((r) => ({ date: r.date, native: round(+r.rm / 100, 4) }));
}
async function smr20(months) {
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const res = await get(`https://www.lgm.gov.my/webv2api/api/rubberprice/month=${d.getMonth() + 1}&year=${d.getFullYear()}`);
    out.push(...parseMrb(await res.json()));
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

// ---------- Plastics: businessanalytiq monthly index, US$/kg ----------
const MONTHS = 'January February March April May June July August September October November December'.split(' ');
export function parseBa(html, regions) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(/price (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4}) and outlook/);
  if (!m) throw new Error('businessanalytiq: month heading not found');
  for (const region of regions) {
    const p = text.match(new RegExp(`${region}: ?US\\$([\\d.]+)/KG`));
    if (p) return { date: `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-01`, native: +p[1], region };
  }
  throw new Error(`businessanalytiq: no price for ${regions.join('/')}`);
}
async function plastic(id) {
  const html = await (await get(SERIES[id].url)).text();
  const pt = parseBa(html, ['Southeast Asia', 'Northeast Asia']);
  SERIES[id].origin = pt.region;
  return [{ date: pt.date, native: pt.native }];
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
  const firstRun = !data.series.smr20?.length;
  const start = iso(new Date(Date.now() - 4 * 365 * 864e5));
  const [myrFx, usdFx] = await Promise.all([fxSeries('MYR', start), fxSeries('USD', start)]);
  const toPhp = { 'RM/kg': myrFx, 'US$/kg': usdFx };

  const jobs = {
    smr20: () => smr20(firstRun ? 25 : 2),
    phRubber: () => phRubber(4),
    pvc: () => plastic('pvc'), ldpe: () => plastic('ldpe'), eva: () => plastic('eva'),
  };
  const errors = {};
  await Promise.all(Object.entries(jobs).map(async ([id, job]) => {
    try {
      const fx = toPhp[SERIES[id].unit];
      const pts = (await job()).map((p) => ({ ...p, php: round(fx ? p.native * rateOn(fx, p.date) : p.native) }));
      data.series[id] = merge(data.series[id], pts);
    } catch (e) { errors[id] = e.message; console.error(`[scrape] ${id}: ${e.message}`); }
  }));

  data.meta = SERIES;
  data.fx = { PHP_per_USD: usdFx.at(-1)[1], PHP_per_MYR: myrFx.at(-1)[1], date: usdFx.at(-1)[0] };
  data.updatedAt = new Date().toISOString();
  data.errors = errors;
  await mkdir(new URL('./data/', import.meta.url), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 1));
  return data;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = await scrape();
  for (const [id, s] of Object.entries(d.series)) console.log(id.padEnd(9), s.length, 'pts, latest', s.at(-1));
  if (Object.keys(d.errors).length) console.log('errors:', d.errors);
}
