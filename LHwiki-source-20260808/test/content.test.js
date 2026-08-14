import test from 'node:test';
import assert from 'node:assert/strict';
import { validLoginId, validStudentId, parseDocument, parseDraftDocument } from '../shared/content.js';

test('student id is a 20xx year, three-digit class and two-digit number', () => {
  assert.equal(validStudentId('202600043'), true);
  assert.equal(validStudentId('202600144'), true);
  assert.equal(validStudentId('202500144'), true);
  assert.equal(validStudentId('202712345'), true);
  assert.equal(validStudentId('20261234'), false);
  assert.equal(validStudentId('2026abcde'), false);
  assert.equal(validStudentId('199900043'), false);
});

test('the private administrator handle is accepted as a login id', () => {
  assert.equal(validLoginId('202600043'), true);
  assert.equal(validLoginId('ray_oriental'), true);
  assert.equal(validLoginId('ray-oriental'), false);
});

test('document parser accepts only safe structured blocks', () => {
  assert.deepEqual(parseDocument([{ type: 'heading', text: ' 标题 ' }]), [{ type: 'heading', text: '标题' }]);
  assert.deepEqual(parseDocument([{ id: 'b_12345678', type: 'subheading', text: ' 小节 ' }]), [{ id: 'b_12345678', type: 'subheading', text: '小节' }]);
  assert.deepEqual(parseDocument([{ id: '<script>', type: 'paragraph', text: '安全文本' }]), [{ type: 'paragraph', text: '安全文本' }]);
  assert.deepEqual(parseDraftDocument([{ id: 'b_12345678', type: 'paragraph', text: '' }]), [{ id: 'b_12345678', type: 'paragraph', text: '' }]);
  assert.deepEqual(parseDraftDocument([]), []);
  assert.equal(parseDocument([{ type: 'html', text: '<script>x</script>' }]), null);
  assert.equal(parseDocument('not json'), null);
});

test('server accepts the expanded safe block set without accepting html', () => {
  const document = parseDocument([
    { type: 'check', text: '待办' },
    { type: 'checked', text: '完成' },
    { type: 'callout', text: '提示' },
    { type: 'code', text: '<script>只是代码文本</script>' },
    { type: 'divider', text: ' ' }
  ]);
  assert.deepEqual(document.map(block => block.type), ['check', 'checked', 'callout', 'code', 'divider']);
  assert.equal(parseDocument([{ type: 'html', text: '<strong>不允许</strong>' }]), null);
});
