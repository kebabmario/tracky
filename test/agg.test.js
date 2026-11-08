import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketKey, aggregate, windowAvg, pctChange } from '../public/agg.js';
import { parseMrb, parseGuidechem, parseShfe, parseWestmetall, rateOn } from '../scraper.js';

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
  const wm = '<tr><th>date</th><th>LME Copper Cash-Settlement</th></tr><tr><td>06. November 2026</td><td>13,955.00</td><td>13,780.00</td></tr>'
    + '<tr><td>05. November 2026</td><td>14,110.00</td><td>14,030.00</td></tr>';
  assert.deepEqual(parseWestmetall(wm), [{ date: '2026-11-05', native: 14110 }, { date: '2026-11-06', native: 13955 }]);
  assert.equal(rateOn([['2026-11-05', 15], ['2026-11-06', 16]], '2026-11-08'), 16);
});

test('capture helpers', async () => {
  const { guessMaterial, guessDate, guessPrices, candidateRows } = await import('../public/capture-parse.js');
  assert.equal(guessMaterial('', 'PP block copolymer price - SunSirs'), 'ppBlock');
  assert.equal(guessMaterial('AS(SAN) NF2200 Ningbo'), 'as');
  assert.equal(guessMaterial('PP homo T30S'), '');
  assert.equal(guessDate('Price 2026/11/06 and 2026-11-08 and 2027-01-01', '2026-11-09'), '2026-11-08');
  assert.equal(guessDate('no date here', '2026-11-09'), '2026-11-09');
  assert.deepEqual(guessPrices('2026-11-08 AS 9,850 yuan/ton (+50) 1.2%'), [9850]);
  assert.deepEqual(guessPrices('AS NF2200 Ningbo 9,850 2026-11-08'), [9850]);
  assert.deepEqual(guessPrices('PP K8003 Yanshan 8200 yuan/ton'), [8200]);
  assert.deepEqual(candidateRows(['PS 8800', 'AS NF2200 9850', 'header'], 'as'), ['AS NF2200 9850', 'PS 8800']);
  const { checkCapture } = await import('../scraper.js');
  assert.equal(checkCapture({ series: 'ppBlock', date: '2026-11-09', price: 8200 }, '2026-11-09'), null);
  assert.ok(checkCapture({ series: 'ppBlock', date: '2026-11-09', price: NaN }, '2026-11-09'));
});
