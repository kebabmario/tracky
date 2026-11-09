// Pure helpers for capture.html: guess material, date and price from what the bookmarklet sent.
// Payload from the bookmarklet: { u: page URL, t: page title, s: selected text, r: table rows as text }.

const PP_BLOCK = /共聚|copolymer|block\s*co|impact|K8003|EPS30R|K7726|M2600R|K8009|EP548R/i;
const AS = /\bAS\b|\bSAN\b|苯乙烯[-－]?丙烯腈|styrene[-\s]?acrylonitrile|NF2200|PN-?127|80HF/i;

export function guessMaterial(...texts) {
  for (const t of texts) {
    if (!t) continue;
    if (PP_BLOCK.test(t)) return 'ppBlock';
    if (AS.test(t)) return 'as';
  }
  return '';
}

// Latest date found that is not in the future (YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD or YYYY年MM月DD日).
export function guessDate(text, today) {
  let best = '';
  for (const [, y, m, d] of (text || '').matchAll(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/g)) {
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (!isNaN(Date.parse(iso)) && iso <= today && iso > best) best = iso;
  }
  return best || today;
}

// Numbers that look like a resin price in CNY/tonne (1,000–100,000), in the order they appear.
export function guessPrices(text) {
  const out = [];
  // Skip digits glued to letters or dashes, so grade codes like NF2200, K8003 or 0215A are not taken as prices.
  for (const [n] of (text || '').matchAll(/(?<![A-Za-z\d\-/.,])(?:\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d+)?(?![A-Za-z\d\-/,])/g)) {
    const v = +n.replace(/,/g, '');
    if (v >= 1000 && v <= 100000 && !/^20\d{2}$/.test(n) && !out.includes(v)) out.push(v);
  }
  return out;
}

// Table rows worth showing as one-click candidates: ones with a price, rows naming the material first.
export function candidateRows(rows, material) {
  const re = material === 'ppBlock' ? PP_BLOCK : material === 'as' ? AS : null;
  return (rows || [])
    .filter((r) => guessPrices(r).length)
    .map((r, i) => ({ r, score: (re && re.test(r) ? 0 : 1) * 1000 + i }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 12)
    .map((x) => x.r);
}

// Turns one chart series ([x, y] pairs) into dated prices. x can be a timestamp, a full date
// (2025-11-09, 2025/11/09, 2025年11月09日) or a month-day label (11-09, 11/09); month-day labels get
// their year by walking back from `today`, stepping back a year whenever the month runs past the later point.
export function normalizeHistory(pairs, today) {
  const out = [];
  let year = +today.slice(0, 4), laterMonth = +today.slice(5, 7);
  for (let i = (pairs || []).length - 1; i >= 0; i--) {
    const [x, y] = pairs[i];
    const v = +String(y).replace(/,/g, '');
    if (y === null || y === '' || !isFinite(v)) continue;
    let iso;
    if (typeof x === 'number' && x > 1e11) iso = new Date(x).toISOString().slice(0, 10);
    else {
      const sx = String(x).trim();
      let m = sx.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
      if (m) iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      else if ((m = sx.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?$/))) {
        const mon = +m[1], day = m[2].padStart(2, '0');
        if (mon > laterMonth) year--;
        laterMonth = mon;
        iso = `${year}-${String(mon).padStart(2, '0')}-${day}`;
        if (iso > today) { year--; iso = `${year}-${String(mon).padStart(2, '0')}-${day}`; }
      }
    }
    if (!iso || isNaN(Date.parse(iso)) || iso > today) continue;
    out.push({ date: iso, price: v });
  }
  const seen = new Set();
  return out.reverse().filter((p) => !seen.has(p.date) && seen.add(p.date));
}
