import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BlockEditor, addTableRow, cloneBlockTree, filterCommands, mergeBlocks, normalizeBlocks, setCaret, splitBlock, tableTabTarget } from '../public/editor.js';
import { DraftManager, draftKeyFor } from '../public/draft-manager.js';
import { blocksToMarkdown, codeFence, parseInlineMarkdown, parseMarkdown } from '../public/markdown.js';

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

test('caret restoration keeps the viewport fixed after a block rerender', () => {
  const calls = [];
  let focused = false;
  const textNode = { textContent: 'abcdef' };
  const element = { firstChild: textNode, focus: options => { focused = true; calls.push(['focus', options]); } };
  const selection = {
    removeAllRanges() { calls.push(['removeAllRanges']); },
    addRange() {
      assert.equal(focused, true, 'the new content block must be focused before restoring its selection');
      calls.push(['addRange']);
    }
  };
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = { scrollX: 0, scrollY: 0, getSelection: () => selection, scrollTo: (...args) => calls.push(['scrollTo', ...args]) };
  globalThis.document = { createRange: () => ({ setStart() {}, collapse() {} }), createTextNode: text => ({ textContent: text }) };
  try {
    setCaret(element, 3, { x: 12, y: 640 });
    assert.deepEqual(calls, [
      ['focus', { preventScroll: true }],
      ['removeAllRanges'],
      ['addRange'],
      ['scrollTo', { left: 12, top: 640, behavior: 'instant' }]
    ]);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test('caret movement scrolls only when the focused line leaves the viewport', () => {
  const calls = [];
  const textNode = { textContent: '' };
  const element = {
    firstChild: textNode,
    focus() {},
    getBoundingClientRect: () => ({ top: 790, bottom: 824 })
  };
  const selection = { removeAllRanges() {}, addRange() {} };
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = {
    innerHeight: 800,
    scrollX: 0,
    scrollY: 500,
    getSelection: () => selection,
    scrollTo: (...args) => calls.push(args)
  };
  globalThis.document = {
    createRange: () => ({ setStart() {}, collapse() {}, getBoundingClientRect: () => ({ top: 790, bottom: 824 }) }),
    createTextNode: text => ({ textContent: text }),
    querySelector: () => null
  };
  try {
    setCaret(element, 0);
    assert.deepEqual(calls, [[{ left: 0, top: 548, behavior: 'instant' }]]);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test('Enter inserts one block without rerendering the whole editor', () => {
  const firstInput = {
    dataset: { blockId: 'b_12345678' },
    textContent: '第一段',
    contains: () => true,
    closest: selector => selector === '.block-input' ? firstInput : null
  };
  const inserted = [];
  const editor = {
    activeId: 'b_12345678',
    blocks: [{ id: 'b_12345678', type: 'paragraph', text: '第一段' }],
    currentIndex: () => 0,
    insertSplitBlock: (input, first, second) => inserted.push({ input, first, second }),
    renderAndFocus: () => assert.fail('Enter must not rerender every content block'),
    changed: () => {}
  };
  const originalWindow = globalThis.window;
  globalThis.window = {
    getSelection: () => ({
      rangeCount: 1,
      anchorNode: firstInput,
      anchorOffset: 0,
      getRangeAt: () => ({
        cloneRange: () => ({
          selectNodeContents() {},
          setEnd() {},
          toString: () => '第一段'
        })
      })
    })
  };
  try {
    BlockEditor.prototype.handleKeydown.call(editor, {
      target: firstInput,
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {}
    });
    assert.equal(editor.blocks.length, 2);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].first.text, '第一段');
    assert.equal(inserted[0].second.text, '');
    assert.equal(editor.activeId, inserted[0].second.id);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('editor resolves the focusable input instead of the block wrapper', () => {
  const input = { className: 'block-input' };
  const calls = [];
  const result = BlockEditor.prototype.element.call({
    root: {
      querySelector(selector) {
        calls.push(selector);
        return input;
      }
    }
  }, 'b_12345678');
  assert.equal(result, input);
  assert.deepEqual(calls, ['.block-input[data-block-id="b_12345678"]']);
});

test('command palette finds Chinese and English aliases without crowding the toolbar', () => {
  assert.equal(filterCommands('表格')[0].id, 'table');
  assert.equal(filterCommands('latex')[0].id, 'formula');
  assert.equal(filterCommands('h4')[0].id, 'minorheading');
  assert.equal(filterCommands('toggle heading')[0].type, 'toggle');
});

test('advanced editor blocks normalize to stable bounded structures', () => {
  const blocks = normalizeBlocks([
    { type: 'table', rows: [['A', 'B'], ['1', '2']] },
    { type: 'columns', columns: [[{ type: 'paragraph', text: '左' }], [{ type: 'formula', text: 'x^2' }]] },
    { type: 'toggle', level: 3, text: '展开', children: [{ type: 'minorheading', text: '细节' }] }
  ]);
  assert.deepEqual(blocks[0].rows, [['A', 'B'], ['1', '2']]);
  assert.equal(blocks[1].columns.length, 2);
  assert.equal(blocks[2].children[0].type, 'minorheading');
});

test('Markdown maps onto the v0.8 editor schema without adding server block types', () => {
  const blocks = parseMarkdown('## 标题\n\n### 小节\n\n#### 细目\n\n> 引用\n\n- 项目\n\n1. 编号\n\n| 姓名 | 学科 |\n| --- | --- |\n| 李老师 | 语文 |\n\n```math\nx^2\n```\n\n---');
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'subheading', 'minorheading', 'quote', 'bullet', 'number', 'table', 'formula', 'divider']);
  assert.deepEqual(blocks[6].rows, [['姓名', '学科'], ['李老师', '语文']]);
  assert.equal(blocks[7].text, 'x^2');
});

test('Markdown round-trip preserves columns and toggles through bounded LHwiki blocks', () => {
  const original = normalizeBlocks([
    { type: 'columns', columns: [[{ type: 'paragraph', text: '左栏' }], [{ type: 'formula', text: 'a+b' }]] },
    { type: 'toggle', level: 3, text: '展开阅读', open: false, children: [{ type: 'paragraph', text: '内容' }] }
  ]);
  const restored = parseMarkdown(blocksToMarkdown(original));
  assert.deepEqual(restored.map(block => block.type), ['columns', 'toggle']);
  assert.equal(restored[0].columns[0][0].text, '左栏');
  assert.equal(restored[1].open, false);
  assert.equal(restored[1].children[0].text, '内容');
});

test('Markdown inline parsing keeps links protocol-bound and code fences inert', () => {
  assert.deepEqual(parseInlineMarkdown('**粗体**、*斜体*、~~删除~~、`代码`、[官网](https://luhe.net/)').map(part => part.type), ['strong', 'text', 'emphasis', 'text', 'strike', 'text', 'code', 'text', 'link']);
  assert.equal(parseInlineMarkdown('[危险](javascript:alert(1))')[0].type, 'text');
  assert.deepEqual(codeFence('```js\nalert(1)\n```'), { language: 'js', code: 'alert(1)' });
});

test('duplicating containers recursively assigns unique block ids', () => {
  const [columns, toggle] = normalizeBlocks([
    { id: 'b_columns1', type: 'columns', columns: [[{ id: 'b_child001', type: 'paragraph', text: '左' }], [{ id: 'b_child002', type: 'formula', text: 'x^2' }]] },
    { id: 'b_toggle01', type: 'toggle', level: 2, text: '章节', children: [{ id: 'b_child003', type: 'paragraph', text: '内容' }] }
  ]);
  const copies = [cloneBlockTree(columns), cloneBlockTree(toggle)];
  const ids = [];
  const visit = block => {
    ids.push(block.id);
    if (block.type === 'columns') block.columns.forEach(column => column.forEach(visit));
    if (block.type === 'toggle') block.children.forEach(visit);
  };
  [columns, toggle, ...copies].forEach(visit);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(copies[0].columns[0][0].text, '左');
  assert.equal(copies[1].children[0].text, '内容');
});

test('table Tab navigation adds only a bounded final row', () => {
  const table = { type: 'table', rows: [['a', 'b'], ['c', 'd']] };
  assert.deepEqual(tableTabTarget(table, 0, 0), { row: 0, column: 1, added: false });
  assert.deepEqual(tableTabTarget(table, 1, 1), { row: 2, column: 0, added: true });
  while (addTableRow(table)) { /* fill to the 30-row limit */ }
  assert.equal(table.rows.length, 30);
  assert.equal(addTableRow(table), false);
});

test('IME composition guards Enter from splitting a block', () => {
  let prevented = false;
  let changed = false;
  const input = { dataset: { blockId: 'b_12345678' }, closest: selector => selector === '.block-input' ? input : null };
  const editor = { composing: true, activeId: 'b_12345678', blocks: [{ id: 'b_12345678', type: 'paragraph', text: '中文' }], currentIndex: () => 0, changed: () => { changed = true; } };
  BlockEditor.prototype.handleKeydown.call(editor, { target: input, key: 'Enter', keyCode: 229, isComposing: true, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(editor.blocks.length, 1);
  assert.equal(prevented, false);
  assert.equal(changed, false);
});

test('editor studio keeps one restrained entry point and a narrow-screen overflow contract', async () => {
  const [app, css, html, theme] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/theme.js', import.meta.url), 'utf8')
  ]);
  assert.match(app, /data-editor-insert/);
  assert.doesNotMatch(app, /data-editor-type/);
  assert.match(app, /published-table-scroll/);
  assert.match(app, /published-columns/);
  assert.match(app, /published-toggle/);
  assert.match(css, /\.editor-table-scroll, \.published-table-scroll[^}]+overflow-x: auto/s);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]+\.editor-columns, \.published-columns \{ grid-template-columns: 1fr; \}/);
  assert.match(html, /20260815-dark-markdown-2/);
  assert.match(app, /draft-manager\.js\?v=20260813-editor-studio/);
  assert.match(app, /data-markdown-open/);
  assert.match(html, /theme\.js\?v=20260815-dark-mode/);
  assert.match(css, /:root\[data-theme-effective="dark"\]/);
  assert.match(theme, /prefers-color-scheme: dark/);
  assert.match(theme, /lhwiki:theme/);
});

test('client upgrade conflicts stop cloud retries and preserve the local snapshot', async () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = { removeItem() {}, setItem() {}, getItem() { return null; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  try {
    const manager = new DraftManager({
      api: async () => { const error = new Error('refresh'); error.status = 409; error.data = { upgradeRequired: true }; throw error; },
      userId: '202600043',
      draftKey: 'article:test'
    });
    manager.update({ schemaVersion: 1, body: [{ id: 'b_12345678', type: 'paragraph', text: '本机内容' }] });
    await manager.saveNow();
    assert.equal(manager.conflicted, true);
    assert.equal(manager.lastState, 'conflict');
    assert.equal(manager.retryTimer, null);
    assert.equal(manager.snapshot.body[0].text, '本机内容');
    manager.destroy();
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
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
