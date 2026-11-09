// Pure helpers shared by the dashboard and tests. Points: [{ date: 'YYYY-MM-DD', v }] sorted by date.
const DAY = 864e5;
const toIso = (t) => new Date(t).toISOString().slice(0, 10);
const ms = (iso) => Date.parse(iso + 'T00:00:00Z');

export function bucketKey(date, g) {
  if (g === 'daily') return date;
  if (g === 'monthly') return date.slice(0, 7) + '-01';
  if (g === 'yearly') return date.slice(0, 4) + '-01-01';
  const t = ms(date); // weekly: Monday of ISO week
  return toIso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
}

export function aggregate(points, g) {
  const m = new Map();
  for (const p of points) {
    const k = bucketKey(p.date, g);
    const b = m.get(k) || m.set(k, { sum: 0, n: 0 }).get(k);
    b.sum += p.v; b.n++;
  }
  return [...m].map(([date, b]) => ({ date, v: b.sum / b.n })).sort((a, b) => a.date.localeCompare(b.date));
}

// Last known value on or before `date` (forward fill), undefined if none.
export function valueAt(points, date) {
  let v;
  for (const p of points) { if (p.date > date) break; v = p.v; }
  return v;
}

// Average of actual data points in the `days` days ending at `asOf` (trading days for daily, months for monthly).
export function windowAvg(points, days, asOf = points.at(-1)?.date) {
  if (!points.length) return undefined;
  const from = toIso(ms(asOf) - days * DAY);
  const inWin = points.filter((p) => p.date > from && p.date <= asOf);
  return inWin.length ? inWin.reduce((a, p) => a + p.v, 0) / inWin.length : undefined;
}

// % change of latest value vs the value `days` earlier.
export function pctChange(points, days) {
  const last = points.at(-1);
  if (!last) return undefined;
  const prev = valueAt(points, toIso(ms(last.date) - days * DAY));
  return prev ? ((last.v - prev) / prev) * 100 : undefined;
}

// Log returns between consecutive observations.
const logReturns = (vals) => vals.slice(1).map((v, i) => Math.log(v / vals[i]));

// Annualised volatility (%) from the last `n` daily log returns (252 trading days a year).
export function volatility(points, n = 30) {
  const r = logReturns(points.slice(-(n + 1)).map((p) => p.v));
  if (r.length < Math.max(5, n / 2)) return undefined;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
  return sd * Math.sqrt(252) * 100;
}

// Simple moving average of the last `n` observations; undefined until there are n of them.
export function sma(points, n) {
  if (points.length < n) return undefined;
  return points.slice(-n).reduce((a, p) => a + p.v, 0) / n;
}

// Year-to-date % change: latest vs the last observation of the previous calendar year.
export function ytd(points) {
  const last = points.at(-1);
  if (!last) return undefined;
  const base = valueAt(points, `${+last.date.slice(0, 4) - 1}-12-31`);
  return base ? ((last.v - base) / base) * 100 : undefined;
}

// Pearson correlation of daily log returns over the last `n` dates both series share.
export function correlation(a, b, n = 90) {
  const bm = new Map(b.map((p) => [p.date, p.v]));
  const both = a.filter((p) => bm.has(p.date)).slice(-(n + 1));
  const ra = logReturns(both.map((p) => p.v)), rb = logReturns(both.map((p) => bm.get(p.date)));
  if (ra.length < 20) return undefined;
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length, mb = rb.reduce((x, y) => x + y, 0) / rb.length;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < ra.length; i++) { cov += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2; }
  return va && vb ? cov / Math.sqrt(va * vb) : undefined;
}
