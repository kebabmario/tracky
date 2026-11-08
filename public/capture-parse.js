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
