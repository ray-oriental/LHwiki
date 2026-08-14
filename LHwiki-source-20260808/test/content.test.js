import test from 'node:test';
import assert from 'node:assert/strict';
import { containsAdvancedBlocks, documentStats, validLoginId, validStudentId, parseDocument, parseDraftDocument } from '../shared/content.js';

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

test('advanced blocks are normalized with bounded recursive content', () => {
  const body = parseDraftDocument([
    { id: 'b_table001', type: 'table', header: true, rows: [['项目', '数值'], ['人数', ' 12 ']] },
    { id: 'b_columns1', type: 'columns', columns: [
      [{ id: 'b_column01', type: 'paragraph', text: '左栏' }],
      [{ id: 'b_column02', type: 'formula', text: '\\frac{1}{2}' }]
    ] },
    { id: 'b_toggle01', type: 'toggle', level: 3, text: '更多', open: false, children: [{ id: 'b_toggle02', type: 'minorheading', text: '细节' }] }
  ]);
  assert.equal(body[0].rows[1][1], ' 12 ');
  assert.equal(body[1].columns.length, 2);
  assert.equal(body[2].level, 3);
  assert.equal(containsAdvancedBlocks(body), true);
  assert.deepEqual(documentStats(body), { characters: 25, blocks: 6 });
  assert.equal(parseDraftDocument([{ type: 'columns', columns: [[], [], [], []] }]), null);
  assert.equal(parseDraftDocument([{ type: 'toggle', level: 2, text: 'x', children: [{ type: 'toggle', level: 3, text: 'nested', children: [] }] }]), null);
});

test('duplicate nested ids are removed before content is stored', () => {
  const body = parseDraftDocument([
    { id: 'b_same001', type: 'columns', columns: [[{ id: 'b_same002', type: 'paragraph', text: '左' }], [{ id: 'b_same002', type: 'paragraph', text: '右' }]] }
  ]);
  assert.equal(body[0].columns[0][0].id, 'b_same002');
  assert.equal('id' in body[0].columns[1][0], false);
});

test('tables enforce row, column and plain-text cell limits', () => {
  assert.equal(parseDraftDocument([{ type: 'table', rows: [Array(11).fill('x')] }]), null);
  assert.equal(parseDraftDocument([{ type: 'table', rows: [['a', 'b'], ['only one']] }]), null);
  const clean = parseDraftDocument([{ type: 'table', rows: [['<b>text</b>']] }]);
  assert.equal(clean[0].rows[0][0], '<b>text</b>');
});
