import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeBlocks, normalizeBlocks, splitBlock } from '../public/editor.js';
import { draftKeyFor } from '../public/draft-manager.js';

test('editor normalizes legacy blocks and preserves structured headings', () => {
  const blocks = normalizeBlocks([
    { type: 'heading', text: '第一章' },
    { id: 'b_12345678', type: 'subheading', text: '准备阶段' },
    { type: 'html', text: '<script>bad()</script>' }
  ]);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].id, /^b_[A-Za-z0-9_-]+$/);
  assert.equal(blocks[1].id, 'b_12345678');
  assert.equal(blocks[1].type, 'subheading');
});

test('split and merge preserve every character', () => {
  const original = { id: 'b_12345678', type: 'heading', text: '前半后半' };
  const [first, second] = splitBlock(original, 2);
  assert.equal(first.text, '前半');
  assert.equal(second.text, '后半');
  assert.equal(second.type, 'paragraph');
  assert.equal(mergeBlocks(first, second).text, original.text);
});

test('draft keys distinguish new, submission and article targets', () => {
  assert.match(draftKeyFor('new'), /^new:/);
  assert.equal(draftKeyFor('submission', 'submission-1'), 'submission:submission-1');
  assert.equal(draftKeyFor('article', 'article-slug'), 'article:article-slug');
});
