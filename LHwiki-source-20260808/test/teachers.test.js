import test from 'node:test';
import assert from 'node:assert/strict';
import { TEACHERS } from '../public/teachers.js';

test('public teacher index has unique stable records', () => {
  assert.ok(TEACHERS.length >= 50);
  assert.equal(new Set(TEACHERS.map(item => item.id)).size, TEACHERS.length);
  assert.equal(new Set(TEACHERS.map(item => item.name)).size, TEACHERS.length);
  for (const teacher of TEACHERS) {
    assert.ok(teacher.name.length >= 2);
    assert.match(teacher.sourceUrl, /^https:\/\/www\.luhe\.(cn|net)\//);
    assert.ok(teacher.motto.length >= 4);
  }
});
