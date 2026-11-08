import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketKey, aggregate, windowAvg, pctChange, basket } from '../public/agg.js';
import { parseMrb, parseBa, rateOn } from '../scraper.js';

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

test('pctChange and basket', () => {
  const a = [{ date: '2026-01-01', php: 100 }, { date: '2026-02-01', php: 110 }];
  assert.ok(Math.abs(pctChange(a, 31) - 10) < 1e-9);
  const b = [{ date: '2026-02-01', php: 50 }];
  assert.deepEqual(basket([a, b]), [{ date: '2026-02-01', php: 80 }]);
});

test('scraper parsers', () => {
  assert.deepEqual(parseMrb([{ date: '2026-11-06', grade: 'SMR 20', rm: '955.50' }, { date: '2026-11-06', grade: 'SMR 5', rm: '975' }]),
    [{ date: '2026-11-06', native: 9.555 }]);
  const html = '<h2>PVC price September 2026 and outlook</h2><li>Northeast Asia:US$0.75/KG, 1.4% up</li>';
  assert.deepEqual(parseBa(html, ['Southeast Asia', 'Northeast Asia']), { date: '2026-09-01', native: 0.75, region: 'Northeast Asia' });
  assert.equal(rateOn([['2026-11-05', 15], ['2026-11-06', 16]], '2026-11-08'), 16);
});
