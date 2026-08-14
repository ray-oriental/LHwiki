import { renderMath } from './math-renderer.js?v=20260813-editor-studio';

const SIMPLE_TYPES = new Set(['paragraph', 'heading', 'subheading', 'minorheading', 'quote', 'bullet', 'number', 'formula']);
const BLOCK_TYPES = new Set([...SIMPLE_TYPES, 'divider', 'table', 'columns', 'toggle']);
const TYPE_LABELS = Object.freeze({
  paragraph: '正文', heading: '大标题（H2）', subheading: '中标题（H3）', minorheading: '小标题（H4）',
  quote: '引用', bullet: '项目列表', number: '编号列表', formula: '数学公式', table: '表格', columns: '分栏', toggle: '折叠标题', divider: '分隔线'
});
const SHORTCUTS = Object.freeze({ '## ': 'heading', '### ': 'subheading', '#### ': 'minorheading', '> ': 'quote', '- ': 'bullet', '* ': 'bullet', '1. ': 'number' });
export const EDITOR_SCHEMA_VERSION = 2;

export const COMMANDS = Object.freeze([
  { id: 'paragraph', type: 'paragraph', category: '文字', label: '正文', description: '普通段落', aliases: ['正文', '段落', 'text', 'paragraph', 'p'] },
  { id: 'heading', type: 'heading', category: '文字', label: '大标题', description: '二级标题 H2', aliases: ['大标题', '二级标题', 'h2', 'heading'] },
  { id: 'subheading', type: 'subheading', category: '文字', label: '中标题', description: '三级标题 H3', aliases: ['中标题', '三级标题', 'h3', 'subheading'] },
  { id: 'minorheading', type: 'minorheading', category: '文字', label: '小标题', description: '四级标题 H4', aliases: ['小标题', '四级标题', 'h4', 'minorheading'] },
  { id: 'quote', type: 'quote', category: '文字', label: '引用', description: '突出一段引文', aliases: ['引用', '引文', 'quote'] },
  { id: 'bullet', type: 'bullet', category: '文字', label: '项目列表', description: '无序列表', aliases: ['列表', '无序', 'bullet', 'list'] },
  { id: 'number', type: 'number', category: '文字', label: '编号列表', description: '有序列表', aliases: ['编号', '有序', 'number', 'ordered'] },
  { id: 'table', type: 'table', category: '结构', label: '表格', description: '可增删行列的纯文本表格', aliases: ['表格', 'table', 'grid'] },
  { id: 'columns2', type: 'columns', count: 2, category: '结构', label: '两栏', description: '窄屏自动上下排列', aliases: ['两栏', '双栏', '2 columns', 'columns'] },
  { id: 'columns3', type: 'columns', count: 3, category: '结构', label: '三栏', description: '窄屏自动上下排列', aliases: ['三栏', '3 columns', 'columns'] },
  { id: 'toggle2', type: 'toggle', level: 2, category: '结构', label: '折叠大标题', description: '标题和可折叠子内容', aliases: ['折叠', '大标题', 'toggle', 'toggle heading'] },
  { id: 'toggle3', type: 'toggle', level: 3, category: '结构', label: '折叠中标题', description: '标题和可折叠子内容', aliases: ['折叠', '中标题', 'toggle h3'] },
  { id: 'divider', type: 'divider', category: '结构', label: '分隔线', description: '分隔上下内容', aliases: ['分隔线', 'divider', 'line', 'hr'] },
  { id: 'formula', type: 'formula', category: '数学', label: '数学公式', description: 'LaTeX 输入，实时显示', aliases: ['公式', '数学', 'latex', 'math', 'equation'] },
  { id: 'duplicate', action: 'duplicate', category: '块操作', label: '复制当前块', description: '在下方创建副本', aliases: ['复制', 'duplicate', 'copy'] },
  { id: 'move-up', action: 'move-up', category: '块操作', label: '上移当前块', description: '向上移动一格', aliases: ['上移', 'move up'] },
  { id: 'move-down', action: 'move-down', category: '块操作', label: '下移当前块', description: '向下移动一格', aliases: ['下移', 'move down'] },
  { id: 'delete', action: 'delete', category: '块操作', label: '删除当前块', description: '保留至少一个正文块', aliases: ['删除', 'delete', 'remove'] }
]);

export function filterCommands(query = '') {
  const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return COMMANDS.filter(command => words.every(word => [command.label, command.description, ...command.aliases].join(' ').toLowerCase().includes(word)));
}

export function blockId() {
  const random = crypto.randomUUID?.().replaceAll('-', '').slice(0, 14) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  return `b_${random}`;
}

function id(value) { return /^[A-Za-z0-9_-]{6,64}$/.test(value || '') ? value : blockId(); }
function text(value, max = 8000) { return String(value ?? '').replace(/\r\n?/g, '\n').slice(0, max); }
function paragraph(value = '') { return { id: blockId(), type: 'paragraph', text: value }; }

function normalizeBlock(block, depth = 0) {
  if (!block || !BLOCK_TYPES.has(block.type) || depth > 1) return null;
  const base = { id: id(block.id), type: block.type };
  if (SIMPLE_TYPES.has(block.type)) return { ...base, text: text(block.text, block.type === 'formula' ? 2000 : 8000) };
  if (block.type === 'divider') return base;
  if (block.type === 'table') {
    const source = Array.isArray(block.rows) ? block.rows.slice(0, 30) : [];
    const width = Math.max(1, Math.min(10, Array.isArray(source[0]) ? source[0].length : 2));
    const rows = source.length ? source.map(row => Array.from({ length: width }, (_, index) => text(row?.[index], 1000))) : [['', ''], ['', '']];
    return { ...base, header: block.header !== false, rows };
  }
  if (block.type === 'columns') {
    const count = [2, 3].includes(block.columns?.length) ? block.columns.length : 2;
    return { ...base, columns: Array.from({ length: count }, (_, index) => {
      const children = Array.isArray(block.columns?.[index]) ? block.columns[index].map(child => normalizeBlock(child, depth + 1)).filter(child => child && !['columns', 'toggle'].includes(child.type)) : [];
      return children.length ? children : [paragraph()];
    }) };
  }
  const children = Array.isArray(block.children) ? block.children.map(child => normalizeBlock(child, depth + 1)).filter(child => child && !['columns', 'toggle'].includes(child.type)) : [];
  return { ...base, level: Number(block.level) === 3 ? 3 : 2, text: text(block.text), open: block.open !== false, children: children.length ? children : [paragraph()] };
}

export function normalizeBlocks(blocks = []) {
  const clean = Array.isArray(blocks) ? blocks.slice(0, 400).map(block => normalizeBlock(block)).filter(Boolean) : [];
  const normalized = clean.length ? clean : [paragraph()];
  const seen = new Set();
  const visit = block => {
    if (seen.has(block.id)) block.id = blockId();
    seen.add(block.id);
    if (block.type === 'columns') block.columns.forEach(column => column.forEach(visit));
    if (block.type === 'toggle') block.children.forEach(visit);
  };
  normalized.forEach(visit);
  return normalized;
}

export function cloneBlockTree(block) {
  const copy = JSON.parse(JSON.stringify(block));
  const rekey = item => {
    item.id = blockId();
    if (item.type === 'columns') item.columns.forEach(column => column.forEach(rekey));
    if (item.type === 'toggle') item.children.forEach(rekey);
    return item;
  };
  return rekey(copy);
}

export function splitBlock(block, offset) {
  const safeOffset = Math.max(0, Math.min(Number(offset) || 0, block.text.length));
  return [{ ...block, text: block.text.slice(0, safeOffset) }, { id: blockId(), type: ['heading', 'subheading', 'minorheading'].includes(block.type) ? 'paragraph' : block.type, text: block.text.slice(safeOffset) }];
}
export function mergeBlocks(first, second) { return { ...first, text: `${first.text || ''}${second.text || ''}` }; }
export function addTableRow(block) {
  if (block.type !== 'table' || block.rows.length >= 30) return false;
  block.rows.push(Array(block.rows[0].length).fill('')); return true;
}
export function tableTabTarget(block, row, column, backwards = false) {
  const width = block.rows[0].length;
  const flat = row * width + column + (backwards ? -1 : 1);
  if (flat < 0) return { row: 0, column: 0, added: false };
  if (flat >= block.rows.length * width) {
    const added = addTableRow(block);
    return { row: added ? block.rows.length - 1 : block.rows.length - 1, column: added ? 0 : width - 1, added };
  }
  return { row: Math.floor(flat / width), column: flat % width, added: false };
}

function caretOffset(element) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return 0;
  const range = selection.getRangeAt(0).cloneRange(); range.selectNodeContents(element); range.setEnd(selection.anchorNode, selection.anchorOffset); return range.toString().length;
}
function keepCaretInView(element, range) {
  if (!Number.isFinite(window.innerHeight) || window.innerHeight <= 0) return;
  const rect = range.getBoundingClientRect?.();
  const fallback = element.getBoundingClientRect?.();
  const caret = rect && Number.isFinite(rect.top) && (rect.top || rect.bottom) ? rect : fallback;
  if (!caret) return;
  const chrome = document.querySelector?.('.editor-chrome')?.getBoundingClientRect?.();
  const top = chrome && chrome.top <= 1 && chrome.bottom > 0 ? chrome.bottom + 12 : 16;
  const bottom = window.innerHeight - 24;
  const delta = caret.bottom > bottom ? caret.bottom - bottom : caret.top < top ? caret.top - top : 0;
  if (delta) try { window.scrollTo({ left: window.scrollX, top: Math.max(0, window.scrollY + delta), behavior: 'instant' }); } catch { window.scrollTo(window.scrollX, Math.max(0, window.scrollY + delta)); }
}
export function setCaret(element, offset = 0, viewport = null) {
  if (!element) return;
  const node = element.firstChild || element.appendChild(document.createTextNode(''));
  try { element.focus({ preventScroll: true }); } catch { element.focus(); }
  const range = document.createRange(); range.setStart(node, Math.min(offset, node.textContent.length)); range.collapse(true);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  if (viewport && (window.scrollX !== viewport.x || window.scrollY !== viewport.y)) try { window.scrollTo({ left: viewport.x, top: viewport.y, behavior: 'instant' }); } catch { window.scrollTo(viewport.x, viewport.y); }
  keepCaretInView(element, range);
}

export class BlockEditor {
  constructor(root, { blocks = [], onChange = () => {}, onSave = () => {} } = {}) {
    if (!root) throw new Error('BlockEditor root is required');
    this.root = root; this.blocks = normalizeBlocks(blocks); this.onChange = onChange; this.onSave = onSave; this.activeId = this.blocks[0].id; this.composing = false; this.menuIndex = 0;
    this.menu = this.createCommandPalette(); this.render(); this.bind();
  }
  createCommandPalette() {
    const menu = document.createElement('div'); menu.className = 'command-palette'; menu.hidden = true; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '插入或转换内容块');
    const search = document.createElement('input'); search.type = 'search'; search.className = 'command-search'; search.placeholder = '搜索：表格、公式、标题…'; search.setAttribute('aria-label', '搜索编辑命令');
    const list = document.createElement('div'); list.className = 'command-list'; list.setAttribute('role', 'listbox'); menu.append(search, list); this.root.append(menu);
    search.addEventListener('input', () => { this.menuIndex = 0; this.renderCommands(search.value); });
    search.addEventListener('keydown', event => this.handleMenuKeydown(event));
    menu.addEventListener('mousedown', event => { if (event.target.closest('[data-command]')) event.preventDefault(); });
    menu.addEventListener('click', event => { const button = event.target.closest('[data-command]'); if (button) this.executeCommand(button.dataset.command); });
    this.commandSearch = search; this.commandList = list; return menu;
  }
  renderCommands(query = '') {
    const commands = filterCommands(query); this.visibleCommands = commands;
    this.commandList.replaceChildren(); let category = '';
    commands.forEach((command, index) => {
      if (command.category !== category) { category = command.category; const label = document.createElement('div'); label.className = 'command-category'; label.textContent = category; this.commandList.append(label); }
      const button = document.createElement('button'); button.type = 'button'; button.dataset.command = command.id; button.setAttribute('role', 'option'); button.className = index === this.menuIndex ? 'active' : '';
      const strong = document.createElement('strong'); strong.textContent = command.label; const span = document.createElement('span'); span.textContent = command.description; button.append(strong, span); this.commandList.append(button);
    });
  }
  openCommandPalette(anchor = null, query = '') {
    this.menu.hidden = false; this.menuIndex = 0; this.renderCommands(query); this.commandSearch.value = query;
    const wrapper = anchor?.closest?.('.editor-block'); this.menu.style.top = `${(wrapper?.offsetTop ?? 0) + (wrapper?.offsetHeight ?? 0) + 4}px`;
    queueMicrotask(() => { try { this.commandSearch.focus({ preventScroll: true }); } catch { this.commandSearch.focus(); } });
  }
  hideCommandPalette({ restoreFocus = false } = {}) { this.menu.hidden = true; if (restoreFocus) setCaret(this.element(this.activeId), this.currentBlock()?.text?.length || 0); }
  handleMenuKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); this.hideCommandPalette({ restoreFocus: true }); return; }
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    event.preventDefault(); const length = this.visibleCommands?.length || 0; if (!length) return;
    if (event.key === 'Enter') return this.executeCommand(this.visibleCommands[this.menuIndex].id);
    this.menuIndex = (this.menuIndex + (event.key === 'ArrowDown' ? 1 : -1) + length) % length; this.renderCommands(this.commandSearch.value);
    this.commandList.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }
  bind() {
    this.root.addEventListener('focusin', event => { const element = event.target.closest('[data-block-id]'); if (element) { this.activeId = element.dataset.blockId; this.emitSelection(); } });
    this.root.addEventListener('compositionstart', () => { this.composing = true; });
    this.root.addEventListener('compositionend', () => { this.composing = false; });
    this.root.addEventListener('input', event => this.handleInput(event));
    this.root.addEventListener('keydown', event => this.handleKeydown(event));
    this.root.addEventListener('paste', event => this.handlePaste(event));
    this.root.addEventListener('click', event => this.handleClick(event));
  }
  element(idValue) { const safe = globalThis.CSS?.escape ? CSS.escape(idValue) : String(idValue).replace(/[^A-Za-z0-9_-]/g, ''); return this.root.querySelector(`.block-input[data-block-id="${safe}"]`); }
  location(idValue, collection = this.blocks) {
    for (let index = 0; index < collection.length; index++) {
      const block = collection[index]; if (block.id === idValue) return { block, collection, index };
      if (block.type === 'columns') for (const column of block.columns) { const found = this.location(idValue, column); if (found) return found; }
      if (block.type === 'toggle') { const found = this.location(idValue, block.children); if (found) return found; }
    }
    return null;
  }
  currentIndex() { return this.location(this.activeId)?.index ?? 0; }
  currentBlock() { return this.location(this.activeId)?.block || this.blocks[0]; }
  getBlocks() { return JSON.parse(JSON.stringify(this.blocks)); }
  setBlocks(blocks, { focus = false } = {}) { this.blocks = normalizeBlocks(blocks); this.activeId = this.blocks[0].id; this.render(); if (focus) setCaret(this.element(this.activeId), 0); this.emitSelection(); }
  setCurrentType(type) { if (!SIMPLE_TYPES.has(type)) return; const location = this.location(this.activeId); if (!location || !('text' in location.block)) return; const offset = caretOffset(this.element(this.activeId)); location.block.type = type; this.replaceBlockDom(location.block); setCaret(this.element(this.activeId), offset); this.changed(); this.emitSelection(); }
  render() { const fragment = document.createDocumentFragment(); this.blocks.forEach(block => fragment.append(this.renderBlock(block))); this.root.querySelectorAll(':scope > .editor-block').forEach(element => element.remove()); this.root.insertBefore(fragment, this.menu); }
  replaceBlockDom(block) { const old = this.root.querySelector(`.editor-block[data-block-id="${block.id}"]`); old?.replaceWith(this.renderBlock(block, old.classList.contains('nested-block'))); }
  insertSplitBlock(input, first, second) {
    input.textContent = first.text;
    const wrapper = input.closest('.editor-block');
    if (!wrapper) return;
    const secondWrapper = this.renderBlock(second, wrapper.classList?.contains('nested-block'));
    wrapper.after(secondWrapper);
    setCaret(secondWrapper.querySelector('.block-input'), 0);
  }
  renderBlock(block, nested = false) {
    const wrapper = document.createElement('div'); wrapper.className = `editor-block type-${block.type}${nested ? ' nested-block' : ''}`; wrapper.dataset.blockId = block.id; wrapper.dataset.blockType = block.type;
    const marker = document.createElement('button'); marker.type = 'button'; marker.className = 'block-picker'; marker.dataset.blockMenu = block.id; marker.setAttribute('aria-label', `打开${TYPE_LABELS[block.type]}菜单`); marker.textContent = '+'; wrapper.append(marker);
    if (SIMPLE_TYPES.has(block.type)) {
      const input = document.createElement('div'); input.className = 'block-input'; input.contentEditable = 'true'; input.spellcheck = block.type !== 'formula'; input.dataset.blockId = block.id; input.dataset.placeholder = block.type === 'formula' ? '输入 LaTeX，例如 \\frac{a}{b}' : ['heading', 'subheading', 'minorheading'].includes(block.type) ? '写下标题' : '继续写…'; input.setAttribute('role', 'textbox'); input.setAttribute('aria-multiline', 'true'); input.textContent = block.text; wrapper.append(input);
      if (block.type === 'formula') { const preview = document.createElement('div'); preview.className = 'formula-preview'; renderMath(preview, block.text); wrapper.append(preview); }
    } else if (block.type === 'divider') { const rule = document.createElement('hr'); rule.className = 'editor-divider'; wrapper.append(rule); }
    else if (block.type === 'table') wrapper.append(this.renderTable(block));
    else if (block.type === 'columns') {
      const grid = document.createElement('div'); grid.className = `editor-columns columns-${block.columns.length}`;
      block.columns.forEach((column, columnIndex) => { const area = document.createElement('section'); area.className = 'editor-column'; area.dataset.column = String(columnIndex); column.forEach(child => area.append(this.renderBlock(child, true))); grid.append(area); }); wrapper.append(grid);
    } else {
      const details = document.createElement('details'); details.className = 'editor-toggle'; details.open = true;
      const summary = document.createElement('summary'); const title = document.createElement('div'); title.className = `block-input toggle-title toggle-level-${block.level}`; title.contentEditable = 'true'; title.dataset.blockId = block.id; title.dataset.toggleTitle = 'true'; title.dataset.placeholder = block.level === 2 ? '折叠大标题' : '折叠中标题'; title.textContent = block.text; summary.append(title); details.append(summary);
      const children = document.createElement('div'); children.className = 'toggle-children'; block.children.forEach(child => children.append(this.renderBlock(child, true))); details.append(children); wrapper.append(details);
    }
    return wrapper;
  }
  renderTable(block) {
    const region = document.createElement('div'); region.className = 'editor-table-region';
    const scroller = document.createElement('div'); scroller.className = 'editor-table-scroll'; const table = document.createElement('table');
    block.rows.forEach((row, rowIndex) => { const tr = document.createElement('tr'); row.forEach((cell, columnIndex) => { const tag = block.header && rowIndex === 0 ? 'th' : 'td'; const item = document.createElement(tag); item.contentEditable = 'true'; item.spellcheck = true; item.dataset.tableId = block.id; item.dataset.row = String(rowIndex); item.dataset.column = String(columnIndex); item.textContent = cell; tr.append(item); }); table.append(tr); }); scroller.append(table);
    const tools = document.createElement('div'); tools.className = 'table-tools';
    [['add-row','＋ 行'],['remove-row','－ 行'],['add-column','＋ 列'],['remove-column','－ 列']].forEach(([action, label]) => { const button = document.createElement('button'); button.type = 'button'; button.dataset.tableAction = action; button.dataset.tableId = block.id; button.textContent = label; tools.append(button); });
    region.append(scroller, tools); return region;
  }
  handleInput(event) {
    const cell = event.target.closest('[data-table-id]');
    if (cell) { const block = this.location(cell.dataset.tableId)?.block; if (block?.type === 'table') { block.rows[Number(cell.dataset.row)][Number(cell.dataset.column)] = text(cell.innerText, 1000); this.activeId = block.id; this.changed(); } return; }
    const input = event.target.closest('.block-input'); if (!input) return; const block = this.location(input.dataset.blockId)?.block; if (!block) return;
    block.text = text(input.innerText, block.type === 'formula' ? 2000 : 8000); this.activeId = block.id;
    if (block.type === 'formula') renderMath(input.closest('.editor-block').querySelector('.formula-preview'), block.text);
    if (!this.composing) {
      const type = SHORTCUTS[block.text]; if (type) { block.text = ''; block.type = type; this.replaceBlockDom(block); setCaret(this.element(block.id), 0); this.emitSelection(); }
      else if (block.text.startsWith('/')) this.openCommandPalette(input, block.text.slice(1)); else if (!this.menu.hidden && document.activeElement !== this.commandSearch) this.hideCommandPalette();
    }
    this.changed();
  }
  handleKeydown(event) {
    const cell = event.target.closest?.('[data-table-id]');
    if (cell && event.key === 'Tab') { event.preventDefault(); const block = this.location(cell.dataset.tableId)?.block; if (!block) return; const target = tableTabTarget(block, Number(cell.dataset.row), Number(cell.dataset.column), event.shiftKey); if (target.added) this.replaceBlockDom(block); const next = this.root.querySelector(`[data-table-id="${block.id}"][data-row="${target.row}"][data-column="${target.column}"]`); try { next?.focus({ preventScroll: true }); } catch { next?.focus(); } this.changed(); return; }
    const input = event.target.closest?.('.block-input'); if (!input) return; this.activeId = input.dataset.blockId;
    if (this.composing || event.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); this.onSave(); return; }
    if (event.key === 'Escape') { this.hideCommandPalette(); return; }
    const location = typeof this.location === 'function' ? this.location(this.activeId) : { block: this.blocks[this.currentIndex()], collection: this.blocks, index: this.currentIndex() };
    const block = location?.block; if (!block) return;
    if (input.dataset.toggleTitle) {
      if (event.key === 'Enter') { event.preventDefault(); const first = block.children?.[0]; if (first) setCaret(this.element(first.id), 0); }
      return;
    }
    const offset = caretOffset(input);
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); const [first, second] = splitBlock(block, offset); location.collection.splice(location.index, 1, first, second); this.activeId = second.id; this.insertSplitBlock(input, first, second); this.changed(); return; }
    if (event.key === 'Backspace' && offset === 0) {
      if (!block.text && block.type !== 'paragraph') { event.preventDefault(); this.setCurrentType('paragraph'); return; }
      if (location.index > 0 && 'text' in location.collection[location.index - 1]) { event.preventDefault(); const previous = location.collection[location.index - 1], length = previous.text.length; location.collection.splice(location.index - 1, 2, mergeBlocks(previous, block)); input.closest('.editor-block').remove(); this.replaceBlockDom(previous); this.activeId = previous.id; setCaret(this.element(previous.id), length); this.changed(); }
    }
    if (event.key === 'Delete' && offset === block.text.length && location.index < location.collection.length - 1 && 'text' in location.collection[location.index + 1]) {
      event.preventDefault(); const next = location.collection[location.index + 1]; block.text += next.text; location.collection.splice(location.index + 1, 1); this.root.querySelector(`.editor-block[data-block-id="${next.id}"]`)?.remove(); input.textContent = block.text; setCaret(input, offset); this.changed();
    }
  }
  handlePaste(event) {
    const input = event.target.closest?.('.block-input'); if (!input || input.dataset.toggleTitle) return;
    event.preventDefault(); const value = event.clipboardData?.getData('text/plain')?.replace(/\r\n?/g, '\n') || ''; const lines = value.split('\n'); const location = this.location(input.dataset.blockId); if (!location) return; const block = location.block, offset = caretOffset(input), before = block.text.slice(0, offset), after = block.text.slice(offset);
    block.text = text(`${before}${lines.shift()}`); const inserted = lines.map((line, index) => paragraph(`${line}${index === lines.length - 1 ? after : ''}`)); location.collection.splice(location.index + 1, 0, ...inserted); this.replaceBlockDom(block); let previous = this.root.querySelector(`.editor-block[data-block-id="${block.id}"]`); inserted.forEach(child => { const dom = this.renderBlock(child, previous.classList.contains('nested-block')); previous.after(dom); previous = dom; }); const last = inserted.at(-1) || block; this.activeId = last.id; setCaret(this.element(last.id), inserted.length ? Math.max(0, last.text.length - after.length) : before.length + value.length); this.changed();
  }
  handleClick(event) {
    const picker = event.target.closest('[data-block-menu]'); if (picker) { this.activeId = picker.dataset.blockMenu; this.openCommandPalette(picker); return; }
    const action = event.target.closest('[data-table-action]'); if (!action) return; const block = this.location(action.dataset.tableId)?.block; if (!block?.rows?.length) return; const width = block.rows[0].length;
    if (action.dataset.tableAction === 'add-row') addTableRow(block);
    if (action.dataset.tableAction === 'remove-row' && block.rows.length > 1) block.rows.pop();
    if (action.dataset.tableAction === 'add-column' && width < 10) block.rows.forEach(row => row.push(''));
    if (action.dataset.tableAction === 'remove-column' && width > 1) block.rows.forEach(row => row.pop());
    this.replaceBlockDom(block); this.changed();
  }
  executeCommand(commandId) {
    const command = COMMANDS.find(item => item.id === commandId), location = this.location(this.activeId); if (!command || !location) return;
    const old = location.block; if (old.text === '/' || old.text?.startsWith('/')) old.text = '';
    if (command.action) {
      if (command.action === 'duplicate') { const copy = cloneBlockTree(old); location.collection.splice(location.index + 1, 0, copy); old && this.root.querySelector(`.editor-block[data-block-id="${old.id}"]`)?.after(this.renderBlock(copy)); this.activeId = copy.id; }
      if (command.action === 'delete') { if (location.collection.length === 1) location.collection.splice(0, 1, paragraph()); else location.collection.splice(location.index, 1); this.render(); this.activeId = location.collection[Math.min(location.index, location.collection.length - 1)].id; }
      if (command.action.startsWith('move-')) { const target = location.index + (command.action === 'move-up' ? -1 : 1); if (target >= 0 && target < location.collection.length) { [location.collection[location.index], location.collection[target]] = [location.collection[target], location.collection[location.index]]; this.render(); } }
    } else {
      let replacement;
      if (SIMPLE_TYPES.has(command.type)) replacement = { id: old.id, type: command.type, text: old.text || '' };
      else if (command.type === 'table') replacement = { id: old.id, type: 'table', header: true, rows: [['标题 1', '标题 2'], [old.text || '', '']] };
      else if (command.type === 'columns') replacement = { id: old.id, type: 'columns', columns: Array.from({ length: command.count }, (_, index) => [paragraph(index === 0 ? old.text || '' : '')]) };
      else if (command.type === 'toggle') replacement = { id: old.id, type: 'toggle', level: command.level, text: old.text || '', open: true, children: [paragraph()] };
      else if (old.text) {
        replacement = { id: blockId(), type: 'divider' };
        location.collection.splice(location.index + 1, 0, replacement);
        this.root.querySelector(`.editor-block[data-block-id="${old.id}"]`)?.after(this.renderBlock(replacement));
        this.activeId = replacement.id;
        this.hideCommandPalette(); this.changed(); this.emitSelection(); return;
      } else replacement = { id: old.id, type: 'divider' };
      location.collection[location.index] = replacement; this.replaceBlockDom(replacement); this.activeId = replacement.id;
    }
    this.hideCommandPalette(); this.changed(); const focus = this.element(this.activeId) || this.root.querySelector(`.editor-block[data-block-id="${this.activeId}"] [contenteditable="true"]`); if (focus) setCaret(focus, focus.textContent?.length || 0); this.emitSelection();
  }
  changed() { this.onChange(this.getBlocks(), this.stats()); }
  stats() {
    let characters = 0, blocks = 0; const visit = block => { blocks += 1; characters += (block.text || '').replace(/\s/g, '').length; if (block.type === 'table') block.rows.forEach(row => row.forEach(cell => { characters += cell.replace(/\s/g, '').length; })); if (block.type === 'columns') block.columns.forEach(column => column.forEach(visit)); if (block.type === 'toggle') block.children.forEach(visit); }; this.blocks.forEach(visit); return { characters, blocks };
  }
  emitSelection() { this.root.dispatchEvent(new CustomEvent('blockselectionchange', { detail: { type: this.currentBlock()?.type || 'paragraph' } })); }
}

export { BLOCK_TYPES, TYPE_LABELS };
