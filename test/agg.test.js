import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketKey, aggregate, windowAvg, pctChange } from '../public/agg.js';
import { parseMrb, parseGuidechem, parseShfe, parseShfeBar, parseWestmetall, rateOn } from '../scraper.js';

test('bucketKey', () => {
  assert.equal(bucketKey('2026-11-08', 'weekly'), '2026-11-02'); // Sunday -> Monday
  assert.equal(bucketKey('2026-11-02', 'weekly'), '2026-11-02');
  assert.equal(bucketKey('2026-11-08', 'monthly'), '2026-11-01');
  assert.equal(bucketKey('2026-11-08', 'yearly'), '2026-01-01');
});

test('aggregate averages per bucket', () => {
  const pts = [{ date: '2026-11-02', v: 10 }, { date: '2026-11-03', v: 20 }, { date: '2026-11-10', v: 5 }];
  assert.deepEqual(aggregate(pts, 'weekly'), [{ date: '2026-11-02', v: 15 }, { date: '2026-11-09', v: 5 }]);
});

test('windowAvg averages points inside window', () => {
  const pts = [{ date: '2026-10-01', v: 99 }, { date: '2026-11-01', v: 10 }, { date: '2026-11-03', v: 40 }];
  assert.equal(windowAvg(pts, 3), 25);
  assert.equal(windowAvg(pts, 30), 25);
});

test('pctChange', () => {
  const a = [{ date: '2026-01-01', v: 100 }, { date: '2026-02-01', v: 110 }];
  assert.ok(Math.abs(pctChange(a, 31) - 10) < 1e-9);
});

test('scraper parsers', () => {
  const rows = [{ date: '2026-11-06', grade: 'SMR 20', rm: '955.50' }, { date: '2026-11-06', grade: 'SMR 5', rm: '975' }];
  assert.deepEqual(parseMrb(rows, 'SMR 20'), [{ date: '2026-11-06', native: 9.555 }]);
  assert.deepEqual(parseMrb(rows, 'SMR 5'), [{ date: '2026-11-06', native: 9.75 }]);
  const html = '<b>4,955</b> CNY/TON <span>Updated: 2026-11-08</span> ... <th>Reg Spec</th><th>2026/11/06</th><th>2026/11/07</th><th>2026/11/08</th>'
    + ' Change Unit Comparison <td>East China</td><td>SG-5 First-Class</td><td>4865-5041</td><td>-</td><td>4955</td><td>0 / 0 CNY/TON</td>';
  assert.deepEqual(parseGuidechem(html), [{ date: '2026-11-06', native: 4953 }, { date: '2026-11-08', native: 4955 }]);
  const abs = '<b>12,083</b> CNY/TON Updated: 2026-11-08 Reg Spec 2026/11/06 2026/11/07 2026/11/08 Change Unit Comparison'
    + ' East China Shandong ≥99.5% 10167 - - 0 / 0 CNY/TON South China Guangdong 0215A 12000 12083 12083 0 / 0 CNY/TON Reg Spec 43th week';
  assert.deepEqual(parseGuidechem(abs), [{ date: '2026-11-06', native: 12000 }, { date: '2026-11-07', native: 12083 }, { date: '2026-11-08', native: 12083 }]);
  const shfe = { o_curinstrument: [
    { PRODUCTGROUPID: 'cu    ', DELIVERYMONTH: '2611', OPENINTEREST: 10, SETTLEMENTPRICE: 1 },
    { PRODUCTGROUPID: 'cu    ', DELIVERYMONTH: '2612', OPENINTEREST: 99, SETTLEMENTPRICE: 105110 },
    { PRODUCTGROUPID: 'cu    ', DELIVERYMONTH: '小计', OPENINTEREST: 999, SETTLEMENTPRICE: '' }] };
  assert.equal(parseShfe(shfe, 'cu'), 105110);
  shfe.o_curinstrument[1] = { ...shfe.o_curinstrument[1], OPENPRICE: 104000, HIGHESTPRICE: 106000, LOWESTPRICE: 103500, CLOSEPRICE: 105000, VOLUME: 1200, OPENINTEREST: 99 };
  assert.deepEqual(parseShfeBar(shfe, 'cu'), { native: 105110, o: 104000, h: 106000, l: 103500, c: 105000, vol: 1200, oi: 99 });
  const wm = '<tr><th>date</th><th>LME Copper Cash-Settlement</th></tr><tr><td>06. November 2026</td><td>13,955.00</td><td>13,780.00</td><td>316,675</td></tr>'
    + '<tr><td>05. November 2026</td><td>14,110.00</td><td>14,030.00</td><td>318,675</td></tr>';
  assert.deepEqual(parseWestmetall(wm), [{ date: '2026-11-05', native: 14110, stock: 318675 }, { date: '2026-11-06', native: 13955, stock: 316675 }]);
  assert.equal(rateOn([['2026-11-05', 15], ['2026-11-06', 16]], '2026-11-08'), 16);
});

test('capture helpers', async () => {
  const { guessMaterial, guessDate, guessPrices, candidateRows } = await import('../public/capture-parse.js');
  assert.equal(guessMaterial('', 'PP block copolymer price - SunSirs'), 'ppBlock');
  assert.equal(guessMaterial('AS(SAN) NF2200 Ningbo'), 'as');
  assert.equal(guessMaterial('PP homo T30S'), 'ppHomo');
  assert.equal(guessMaterial('ABS 0215A Jilin'), 'abs');
  assert.equal(guessMaterial('ABS resin price'), 'abs');
  assert.equal(guessMaterial('PP random 4220'), '');
  assert.equal(guessDate('Price 2026/11/06 and 2026-11-08 and 2027-01-01', '2026-11-09'), '2026-11-08');
  assert.equal(guessDate('no date here', '2026-11-09'), '2026-11-09');
  assert.deepEqual(guessPrices('2026-11-08 AS 9,850 yuan/ton (+50) 1.2%'), [9850]);
  assert.deepEqual(guessPrices('AS NF2200 Ningbo 9,850 2026-11-08'), [9850]);
  assert.deepEqual(guessPrices('PP K8003 Yanshan 8200 yuan/ton'), [8200]);
  assert.deepEqual(candidateRows(['PS 8800', 'AS NF2200 9850', 'header'], 'as'), ['AS NF2200 9850', 'PS 8800']);
  const { checkCapture } = await import('../scraper.js');
  assert.equal(checkCapture({ series: 'ppBlock', date: '2026-11-09', price: 8200 }, '2026-11-09'), null);
  assert.equal(checkCapture({ series: 'abs', date: '2026-11-09', price: 12000 }, '2026-11-09'), null);
  assert.equal(checkCapture({ series: 'ppHomo', date: '2026-11-09', price: 9000 }, '2026-11-09'), null);
  assert.ok(checkCapture({ series: 'pvc', date: '2026-11-09', price: 5000 }, '2026-11-09'));
  assert.ok(checkCapture({ series: 'ppBlock', date: '2026-11-09', price: NaN }, '2026-11-09'));
});

test('terminal metrics', async () => {
  const { volatility, sma, ytd, correlation } = await import('../public/agg.js');
  const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
  const flat = Array.from({ length: 40 }, (_, i) => ({ date: day(i), v: 100 }));
  assert.equal(volatility(flat, 30), 0);
  assert.equal(volatility(flat.slice(0, 3), 30), undefined);
  const zig = flat.map((p, i) => ({ ...p, v: i % 2 ? 101 : 100 }));
  assert.ok(volatility(zig, 30) > 10);
  assert.equal(sma([{ v: 1 }, { v: 2 }, { v: 3 }], 2), 2.5);
  assert.equal(sma([{ v: 1 }], 2), undefined);
  assert.ok(Math.abs(ytd([{ date: '2025-12-30', v: 100 }, { date: '2026-03-01', v: 110 }]) - 10) < 1e-9);
  assert.equal(ytd([{ date: '2026-01-05', v: 100 }]), undefined);
  const a = zig, b = zig.map((p) => ({ ...p, v: p.v * 2 })), c = zig.map((p, i) => ({ ...p, v: i % 2 ? 100 : 101 }));
  assert.ok(Math.abs(correlation(a, b) - 1) < 1e-9);
  assert.ok(Math.abs(correlation(a, c) + 1) < 1e-9);
});

test('chart history from the bookmarklet', async () => {
  const { normalizeHistory } = await import('../public/capture-parse.js');
  assert.deepEqual(normalizeHistory([['2025-11-09', '9,800'], ['2026/05/01', 10100], ['2026年11月09日', 10500], ['2026-12-01', 1]], '2026-11-09'),
    [{ date: '2025-11-09', price: 9800 }, { date: '2026-05-01', price: 10100 }, { date: '2026-11-09', price: 10500 }]);
  assert.deepEqual(normalizeHistory([['11-30', 1], ['12-31', 2], ['01-02', 3], ['11-09', 4]], '2026-11-09'),
    [{ date: '2025-11-30', price: 1 }, { date: '2025-12-31', price: 2 }, { date: '2026-01-02', price: 3 }, { date: '2026-11-09', price: 4 }]);
  assert.deepEqual(normalizeHistory([[Date.UTC(2026, 10, 8), 7], ['bad', 8], ['11-09', '-']], '2026-11-09'), [{ date: '2026-11-08', price: 7 }]);
  assert.deepEqual(normalizeHistory([['11-20', 5], ['11-09', 6]], '2026-11-09'), [{ date: '2025-11-20', price: 5 }, { date: '2026-11-09', price: 6 }]);
});

test('bulk capture validation', async () => {
  const { addCaptures } = await import('../scraper.js');
  await assert.rejects(addCaptures({ series: 'as', points: [] }), /No prices/);
  await assert.rejects(addCaptures({ series: 'as', points: [{ date: '2026-01-01', price: 5 }] }), /between 1,000/);
  await assert.rejects(addCaptures({ series: 'nope', points: [{ date: '2026-01-01', price: 9000 }] }), /Unknown material/);
});

test('key check', async () => {
  const { keyOk } = await import('../auth.js');
  assert.equal(keyOk('s3cret', 's3cret'), true);
  assert.equal(keyOk('wrong', 's3cret'), false);
  assert.equal(keyOk('', 's3cret'), false);
  assert.equal(keyOk(undefined, ''), false);
  assert.equal(keyOk('anything', ''), false);
});
