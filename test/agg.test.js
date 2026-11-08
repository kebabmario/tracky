import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketKey, aggregate, windowAvg, pctChange } from '../public/agg.js';
import { parseMrb, parseGuidechem, rateOn } from '../scraper.js';

test('bucketKey', () => {
  assert.equal(bucketKey('2026-11-08', 'weekly'), '2026-11-02'); // Sunday -> Monday
  assert.equal(bucketKey('2026-11-02', 'weekly'), '2026-11-02');
  assert.equal(bucketKey('2026-11-08', 'monthly'), '2026-11-01');
  assert.equal(bucketKey('2026-11-08', 'yearly'), '2026-01-01');
});

test('aggregate averages per bucket', () => {
  const pts = [{ date: '2026-11-02', php: 10 }, { date: '2026-11-03', php: 20 }, { date: '2026-11-10', php: 5 }];
  assert.deepEqual(aggregate(pts, 'weekly'), [{ date: '2026-11-02', php: 15 }, { date: '2026-11-09', php: 5 }]);
});

test('windowAvg averages points inside window', () => {
  const pts = [{ date: '2026-10-01', php: 99 }, { date: '2026-11-01', php: 10 }, { date: '2026-11-03', php: 40 }];
  assert.equal(windowAvg(pts, 3), 25);
  assert.equal(windowAvg(pts, 30), 25);
});

test('pctChange', () => {
  const a = [{ date: '2026-01-01', php: 100 }, { date: '2026-02-01', php: 110 }];
  assert.ok(Math.abs(pctChange(a, 31) - 10) < 1e-9);
});

test('scraper parsers', () => {
  const rows = [{ date: '2026-11-06', grade: 'SMR 20', rm: '955.50' }, { date: '2026-11-06', grade: 'SMR 5', rm: '975' }];
  assert.deepEqual(parseMrb(rows, 'SMR 20'), [{ date: '2026-11-06', native: 9.555 }]);
  assert.deepEqual(parseMrb(rows, 'SMR 5'), [{ date: '2026-11-06', native: 9.75 }]);
  const html = '<b>4,955</b> CNY/TON <span>Updated: 2026-11-08</span> ... <th>Reg Spec</th><th>2026/11/06</th><th>2026/11/07</th><th>2026/11/08</th>'
    + ' Change Unit Comparison <td>East China</td><td>SG-5 First-Class</td><td>4865-5041</td><td>-</td><td>4955</td><td>0 / 0 CNY/TON</td>';
  assert.deepEqual(parseGuidechem(html), [{ date: '2026-11-06', native: 4953 }, { date: '2026-11-08', native: 4955 }]);
  assert.equal(rateOn([['2026-11-05', 15], ['2026-11-06', 16]], '2026-11-08'), 16);
});
