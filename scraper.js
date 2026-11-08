// Fetches rubber + plastics prices from public sources and merges them into data/prices.json.
// Every series is stored as [{ date: 'YYYY-MM-DD', native, php }] where php = PHP per kg.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const DATA_FILE = new URL('./data/prices.json', import.meta.url);
const UA = 'Mozilla/5.0 (tracky price dashboard)';

const MRB = { source: 'Malaysian Rubber Board', url: 'https://www.lgm.gov.my/', group: 'rubber', origin: 'Malaysia', freq: 'daily', unit: 'RM/kg' };
const GC = (path) => ({ source: 'Guidechem GuideTrends', url: `https://www.guidechem.com/price/en/${path}.html`, group: 'plastic', origin: 'China', freq: 'daily', unit: 'CNY/t' });
export const SERIES = {
  smr5: { name: 'SMR 5', ...MRB },
  smr10: { name: 'SMR 10', ...MRB },
  smr20: { name: 'SMR 20', ...MRB },
  phRubber: { name: 'PH Rubber (cuplump)', group: 'rubber', origin: 'Philippines', freq: 'monthly', unit: '₱/kg',
    source: 'PSA OpenSTAT farmgate prices', url: 'https://openstat.psa.gov.ph/' },
  pvc: { name: 'PVC', ...GC('detail-babuax'), origin: 'East China · SG-5' },
  ldpe: { name: 'LDPE', ...GC('detail-elr36h'), origin: 'China · film grade' },
  eva: { name: 'EVA', ...GC('detail-bq16xn'), origin: 'China · foaming grade' },
};
const MRB_GRADES = { smr5: 'SMR 5', smr10: 'SMR 10', smr20: 'SMR 20' };

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
  const daily = text.match(/Reg Spec (\d{4}\/\d{2}\/\d{2}) (\d{4}\/\d{2}\/\d{2}) (\d{4}\/\d{2}\/\d{2}) Change Unit Comparison (.*?) -?[\d.]+ \/ -?[\d.]+ CNY\/TON/);
  if (daily) {
    const vals = daily[4].split(' ').slice(-3);
    [daily[1], daily[2]].forEach((d, i) => {
      const v = cell(vals[i]), date = d.replace(/\//g, '-');
      if (v !== undefined && !pts.has(date)) pts.set(date, v);
    });
  }
  return [...pts].map(([date, native]) => ({ date, native })).sort((a, b) => a.date.localeCompare(b.date));
}
async function plastic(id) {
  return parseGuidechem(await (await get(SERIES[id].url)).text());
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
  const [myrFx, usdFx, cnyFx] = await Promise.all([fxSeries('MYR', start), fxSeries('USD', start), fxSeries('CNY', start)]);
  const toPhp = { 'RM/kg': (v, d) => v * rateOn(myrFx, d), 'CNY/t': (v, d) => (v / 1000) * rateOn(cnyFx, d), '₱/kg': (v) => v };

  // A series whose source changed starts fresh, so old numbers from another source never mix in.
  for (const id of Object.keys(data.series)) if (!SERIES[id] || data.meta?.[id]?.source !== SERIES[id].source) delete data.series[id];

  const mrb = mrbRows(firstRun ? 25 : 2);
  const jobs = {
    ...Object.fromEntries(Object.entries(MRB_GRADES).map(([id, grade]) => [id, async () => parseMrb(await mrb, grade)])),
    phRubber: () => phRubber(4),
    pvc: () => plastic('pvc'), ldpe: () => plastic('ldpe'), eva: () => plastic('eva'),
  };
  const errors = {};
  await Promise.all(Object.entries(jobs).map(async ([id, job]) => {
    try {
      const pts = (await job()).map((p) => ({ ...p, php: round(toPhp[SERIES[id].unit](p.native, p.date)) }));
      data.series[id] = merge(data.series[id], pts);
    } catch (e) { errors[id] = e.message; console.error(`[scrape] ${id}: ${e.message}`); }
  }));

  data.meta = SERIES;
  data.fx = { PHP_per_USD: usdFx.at(-1)[1], PHP_per_MYR: myrFx.at(-1)[1], PHP_per_CNY: cnyFx.at(-1)[1], date: usdFx.at(-1)[0] };
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
