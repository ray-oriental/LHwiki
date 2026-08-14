import assert from 'node:assert/strict';
import test from 'node:test';
import { blocksToMarkdown, mergeBlocks, normalizeBlocks, parseMarkdown, setCaret, splitBlock } from '../public/editor.js';
import { DraftManager, draftKeyFor } from '../public/draft-manager.js';

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

test('markdown imports every supported block style and exports without losing meaning', () => {
  const source = `# 小标题

普通段落含 **粗体**、*斜体*、~~删除线~~、\`代码\` 和 [链接](https://luhe.net/)。

> 引用

- 项目
1. 编号
- [ ] 待办
- [x] 完成
> [!NOTE] 提示

---

\`\`\`js
const school = 'Luhe';
\`\`\``;
  const blocks = parseMarkdown(source);
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'quote', 'bullet', 'number', 'check', 'checked', 'callout', 'divider', 'code']);
  assert.match(blocksToMarkdown(blocks), /- \[x\] 完成/);
  assert.match(blocksToMarkdown(blocks), /```\nconst school/);
});

test('new structured styles survive editor normalization', () => {
  const blocks = normalizeBlocks([
    { type: 'check', text: '待办' },
    { type: 'checked', text: '完成' },
    { type: 'callout', text: '提示' },
    { type: 'code', text: 'const x = 1;' },
    { type: 'divider', text: '' }
  ]);
  assert.deepEqual(blocks.map(block => block.type), ['check', 'checked', 'callout', 'code', 'divider']);
});

test('draft keys distinguish new, submission and article targets', () => {
  assert.match(draftKeyFor('new'), /^new:/);
  assert.equal(draftKeyFor('submission', 'submission-1'), 'submission:submission-1');
  assert.equal(draftKeyFor('article', 'article-slug'), 'article:article-slug');
});

test('caret restoration keeps the viewport fixed after a block rerender', () => {
  const calls = [];
  const textNode = { textContent: 'abcdef' };
  const element = { firstChild: textNode, focus: options => calls.push(['focus', options]) };
  const selection = { removeAllRanges() {}, addRange() {} };
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = { scrollX: 0, scrollY: 0, getSelection: () => selection, scrollTo: (x, y) => calls.push(['scrollTo', x, y]) };
  globalThis.document = { createRange: () => ({ setStart() {}, collapse() {} }), createTextNode: text => ({ textContent: text }) };
  try {
    setCaret(element, 3, { x: 12, y: 640 });
    assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scrollTo', 12, 640]]);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test('removing a draft waits for an active save and deletes the created cloud draft', async () => {
  const calls = [];
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = { removeItem: key => calls.push(['local', key]), setItem() {}, getItem() { return null; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  try {
    const manager = new DraftManager({
      api: async (path, options) => {
        calls.push([options.method, path]);
        if (options.method === 'POST' || options.method === 'PUT') return { draft: { id: 'draft-1', draftKey: 'new:test', revision: options.method === 'POST' ? 1 : 2, updatedAt: new Date().toISOString(), sectionSlug: '', contentType: '', title: '', summary: '', subject: '', authorLabel: '', anonymous: false, body: [] } };
        return { ok: true };
      },
      userId: '202600043',
      draftKey: 'new:test'
    });
    manager.update({ body: [] });
    const saving = manager.saveNow();
    await manager.remove();
    await saving;
    assert.ok(calls.some(call => call[0] === 'DELETE' && call[1] === '/api/drafts/draft-1'));
    assert.equal(manager.id, null);
    manager.destroy();
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('identical editor snapshots do not schedule duplicate cloud writes', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = { removeItem() {}, setItem() {}, getItem() { return null; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  try {
    const manager = new DraftManager({ api: async () => ({ draft: {} }), userId: '202600043', draftKey: 'new:test' });
    const snapshot = { title: '同一内容', body: [{ id: 'b_12345678', type: 'paragraph', text: '内容' }] };
    assert.equal(manager.update(snapshot), true);
    assert.equal(manager.update(snapshot), false);
    assert.equal(manager.sequence, 1);
    manager.destroy();
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});
