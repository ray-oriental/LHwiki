import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, parseDate } from '../public/date.js';

test('formats CloudBase PostgreSQL timestamps that already include a timezone', () => {
  const value = '2026-08-07T12:20:46+08:00';
  assert.equal(parseDate(value)?.toISOString(), '2026-08-07T04:20:46.000Z');
  assert.equal(formatDate(value), '2026年8月7日');
});

test('continues to support UTC and legacy SQL timestamps', () => {
  assert.equal(formatDate('2026-08-07T04:20:46Z'), '2026年8月7日');
  assert.equal(formatDate('2026-08-07 04:20:46'), '2026年8月7日');
});

test('invalid or missing dates degrade without breaking the article page', () => {
  assert.equal(formatDate('not-a-date'), '—');
  assert.equal(formatDate(null), '—');
});
