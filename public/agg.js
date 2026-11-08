// Pure helpers shared by the dashboard and tests. Points: [{ date: 'YYYY-MM-DD', php }] sorted by date.
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
    b.sum += p.php; b.n++;
  }
  return [...m].map(([date, b]) => ({ date, php: b.sum / b.n })).sort((a, b) => a.date.localeCompare(b.date));
}

// Last known value on or before `date` (forward fill), undefined if none.
export function valueAt(points, date) {
  let v;
  for (const p of points) { if (p.date > date) break; v = p.php; }
  return v;
}

// Average of actual data points in the `days` days ending at `asOf` (trading days for daily, months for monthly).
export function windowAvg(points, days, asOf = points.at(-1)?.date) {
  if (!points.length) return undefined;
  const from = toIso(ms(asOf) - days * DAY);
  const inWin = points.filter((p) => p.date > from && p.date <= asOf);
  return inWin.length ? inWin.reduce((a, p) => a + p.php, 0) / inWin.length : undefined;
}

// % change of latest value vs the value `days` earlier.
export function pctChange(points, days) {
  const last = points.at(-1);
  if (!last) return undefined;
  const prev = valueAt(points, toIso(ms(last.date) - days * DAY));
  return prev ? ((last.php - prev) / prev) * 100 : undefined;
}

// Equal-weight basket: mean of members' forward-filled values on every date where all members have data.
export function basket(members) {
  const dates = [...new Set(members.flatMap((s) => s.map((p) => p.date)))].sort();
  const out = [];
  for (const date of dates) {
    const vals = members.map((s) => valueAt(s, date));
    if (vals.every((v) => v !== undefined)) out.push({ date, php: vals.reduce((a, b) => a + b, 0) / vals.length });
  }
  return out;
}
