const BLOCK_TYPES = new Set(['paragraph', 'heading', 'subheading', 'quote', 'bullet', 'number', 'check', 'checked', 'callout', 'code', 'divider']);

const TYPE_LABELS = Object.freeze({
  paragraph: '正文',
  heading: '小标题',
  subheading: '次级标题',
  quote: '引用',
  bullet: '项目列表',
  number: '编号列表',
  check: '待办清单',
  checked: '已完成清单',
  callout: '提示框',
  code: '代码块',
  divider: '分隔线'
});

const INLINE_FORMATS = Object.freeze({
  bold: { label: 'B', title: '粗体', prefix: '**', suffix: '**' },
  italic: { label: 'I', title: '斜体', prefix: '*', suffix: '*' },
  strike: { label: 'S', title: '删除线', prefix: '~~', suffix: '~~' },
  inlineCode: { label: '</>', title: '行内代码', prefix: '`', suffix: '`' }
});

const SHORTCUTS = Object.freeze({
  '# ': 'heading',
  '## ': 'heading',
  '### ': 'subheading',
  '> ': 'quote',
  '- ': 'bullet',
  '* ': 'bullet',
  '1. ': 'number',
  '- [ ] ': 'check',
  '- [x] ': 'checked',
  '::: ': 'callout',
  '``` ': 'code',
  '---': 'divider'
});

function markdownBlock(type, text = '') {
  return { id: blockId(), type, text: String(text).slice(0, 8000) };
}

export function parseMarkdown(markdown = '') {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(markdownBlock('paragraph', paragraph.join('\n')));
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^\s*```[^`]*$/);
    if (fence) {
      flushParagraph();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) codeLines.push(lines[index++]);
      blocks.push(markdownBlock('code', codeLines.join('\n')));
      continue;
    }
    if (!line.trim()) { flushParagraph(); continue; }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    const callout = line.match(/^\s*>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
    const quote = line.match(/^\s*>\s?(.*)$/);
    const checklist = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) { flushParagraph(); blocks.push(markdownBlock(heading[1].length <= 2 ? 'heading' : 'subheading', heading[2])); }
    else if (callout) { flushParagraph(); blocks.push(markdownBlock('callout', callout[1])); }
    else if (quote) { flushParagraph(); blocks.push(markdownBlock('quote', quote[1])); }
    else if (checklist) { flushParagraph(); blocks.push(markdownBlock(checklist[1].trim() ? 'checked' : 'check', checklist[2])); }
    else if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) { flushParagraph(); blocks.push(markdownBlock('divider')); }
    else if (bullet) { flushParagraph(); blocks.push(markdownBlock('bullet', bullet[1])); }
    else if (number) { flushParagraph(); blocks.push(markdownBlock('number', number[1])); }
    else paragraph.push(line);
  }
  flushParagraph();
  return normalizeBlocks(blocks);
}

export function blocksToMarkdown(blocks = []) {
  return normalizeBlocks(blocks).map(block => ({
    paragraph: block.text,
    heading: `## ${block.text}`,
    subheading: `### ${block.text}`,
    quote: `> ${block.text}`,
    bullet: `- ${block.text}`,
    number: `1. ${block.text}`,
    check: `- [ ] ${block.text}`,
    checked: `- [x] ${block.text}`,
    callout: `> [!NOTE] ${block.text}`,
    code: `\`\`\`\n${block.text}\n\`\`\``,
    divider: '---'
  })[block.type] ?? block.text).join('\n\n');
}

export function blockId() {
  const random = crypto.randomUUID?.().replaceAll('-', '').slice(0, 14)
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  return `b_${random}`;
}

export function normalizeBlocks(blocks = []) {
  const clean = Array.isArray(blocks) ? blocks.filter(block => block && BLOCK_TYPES.has(block.type)).map(block => ({
    id: /^[A-Za-z0-9_-]{6,64}$/.test(block.id || '') ? block.id : blockId(),
    type: block.type,
    text: String(block.text ?? '').replace(/\r\n?/g, '\n').slice(0, 8000)
  })) : [];
  return clean.length ? clean : [{ id: blockId(), type: 'paragraph', text: '' }];
}

export function splitBlock(block, offset) {
  const safeOffset = Math.max(0, Math.min(Number(offset) || 0, block.text.length));
  return [
    { ...block, text: block.text.slice(0, safeOffset) },
    { id: blockId(), type: block.type === 'heading' || block.type === 'subheading' ? 'paragraph' : block.type, text: block.text.slice(safeOffset) }
  ];
}

export function mergeBlocks(first, second) {
  return { ...first, text: `${first.text}${second.text}` };
}

function caretOffset(element) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return 0;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(element);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}

function selectionOffsets(element) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return { start: 0, end: 0 };
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
    const offset = caretOffset(element);
    return { start: offset, end: offset };
  }
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const selected = range.cloneRange();
  selected.selectNodeContents(element);
  selected.setEnd(range.endContainer, range.endOffset);
  return { start: before.toString().length, end: selected.toString().length };
}

export function setCaret(element, offset = 0, viewport = null) {
  if (!element) return;
  const node = element.firstChild || element.appendChild(document.createTextNode(''));
  const range = document.createRange();
  range.setStart(node, Math.min(offset, node.textContent.length));
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  try { element.focus({ preventScroll: true }); } catch { element.focus(); }
  if (viewport && (window.scrollX !== viewport.x || window.scrollY !== viewport.y)) {
    window.scrollTo(viewport.x, viewport.y);
  }
}

export class BlockEditor {
  constructor(root, { blocks = [], onChange = () => {}, onSave = () => {} } = {}) {
    if (!root) throw new Error('BlockEditor root is required');
    this.root = root;
    this.blocks = normalizeBlocks(blocks);
    this.onChange = onChange;
    this.onSave = onSave;
    this.activeId = this.blocks[0].id;
    this.menu = this.createSlashMenu();
    this.render();
    this.bind();
  }

  createSlashMenu() {
    const menu = document.createElement('div');
    menu.className = 'slash-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.innerHTML = Object.entries(TYPE_LABELS).map(([type, label]) =>
      `<button type="button" role="menuitem" data-slash-type="${type}"><strong>${label}</strong><span>${type === 'paragraph' ? '继续普通书写' : `转换为${label}`}</span></button>`
    ).join('');
    this.root.append(menu);
    menu.addEventListener('mousedown', event => event.preventDefault());
    menu.addEventListener('click', event => {
      const button = event.target.closest('[data-slash-type]');
      if (!button) return;
      const block = this.currentBlock();
      if (block?.text === '/') block.text = '';
      this.setCurrentType(button.dataset.slashType);
      this.hideSlashMenu();
    });
    return menu;
  }

  bind() {
    this.root.addEventListener('focusin', event => {
      const element = event.target.closest('[data-block-id]');
      if (!element) return;
      this.activeId = element.dataset.blockId;
      this.emitSelection();
    });
    this.root.addEventListener('input', event => this.handleInput(event));
    this.root.addEventListener('keydown', event => this.handleKeydown(event));
    this.root.addEventListener('paste', event => this.handlePaste(event));
    this.root.addEventListener('click', event => {
      const typeButton = event.target.closest('[data-block-picker]');
      if (typeButton) this.setCurrentType(typeButton.dataset.blockPicker);
    });
  }

  element(id) {
    const safeId = globalThis.CSS?.escape ? CSS.escape(id) : String(id).replace(/[^A-Za-z0-9_-]/g, '');
    return this.root.querySelector(`[data-block-id="${safeId}"]`);
  }

  currentIndex() {
    return Math.max(0, this.blocks.findIndex(block => block.id === this.activeId));
  }

  currentBlock() {
    return this.blocks[this.currentIndex()];
  }

  getBlocks() {
    return this.blocks.map(block => ({ ...block }));
  }

  setBlocks(blocks, { focus = false } = {}) {
    this.blocks = normalizeBlocks(blocks);
    this.activeId = this.blocks[0].id;
    this.render();
    if (focus) setCaret(this.element(this.activeId), 0);
    this.emitSelection();
  }

  setCurrentType(type) {
    if (!BLOCK_TYPES.has(type)) return;
    const index = this.currentIndex();
    const offset = caretOffset(this.element(this.activeId));
    this.blocks[index].type = type;
    this.renderAndFocus(this.activeId, offset);
    this.changed();
    this.emitSelection();
  }

  applyInline(prefix, suffix = prefix) {
    const block = this.currentBlock();
    const input = this.element(this.activeId);
    if (!block || !input || block.type === 'divider') return;
    const { start, end } = selectionOffsets(input);
    const selected = block.text.slice(start, end);
    block.text = `${block.text.slice(0, start)}${prefix}${selected}${suffix}${block.text.slice(end)}`.slice(0, 8000);
    const caret = selected ? end + prefix.length + suffix.length : start + prefix.length;
    this.renderAndFocus(block.id, Math.min(caret, block.text.length));
    this.changed();
  }

  importMarkdown(markdown) {
    this.setBlocks(parseMarkdown(markdown), { focus: true });
    this.changed();
  }

  render() {
    const fragment = document.createDocumentFragment();
    for (const block of this.blocks) fragment.append(this.renderBlock(block));
    this.root.querySelectorAll('.editor-block').forEach(element => element.remove());
    this.root.insertBefore(fragment, this.menu);
  }

  renderAndFocus(id, offset = 0) {
    const viewport = { x: window.scrollX, y: window.scrollY };
    this.render();
    setCaret(this.element(id), offset, viewport);
  }

  renderBlock(block) {
    const wrapper = document.createElement('div');
    wrapper.className = `editor-block type-${block.type}`;
    wrapper.dataset.blockId = block.id;
    wrapper.dataset.blockType = block.type;
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'block-picker';
    marker.dataset.blockPicker = block.type;
    marker.setAttribute('aria-label', `当前为${TYPE_LABELS[block.type]}，点击切换格式`);
    marker.textContent = block.type === 'heading' ? 'H2' : block.type === 'subheading' ? 'H3' : block.type === 'quote' ? '“' : block.type === 'bullet' ? '•' : block.type === 'number' ? '1.' : block.type === 'check' ? '□' : block.type === 'checked' ? '✓' : block.type === 'callout' ? '!' : block.type === 'code' ? '</>' : block.type === 'divider' ? '/' : '¶';
    const input = document.createElement('div');
    input.className = 'block-input';
    input.contentEditable = 'true';
    input.spellcheck = true;
    input.dataset.blockId = block.id;
    input.dataset.placeholder = block.type === 'heading' ? '章节标题' : block.type === 'subheading' ? '小节标题' : block.type === 'quote' ? '写下一句值得保留的话' : block.type === 'callout' ? '写下需要特别提醒的内容' : block.type === 'code' ? '粘贴代码或等宽文本' : block.type === 'divider' ? '' : '继续写…';
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-multiline', 'true');
    input.textContent = block.text;
    wrapper.append(marker, input);
    return wrapper;
  }

  handleInput(event) {
    const input = event.target.closest('.block-input');
    if (!input) return;
    const block = this.blocks.find(item => item.id === input.dataset.blockId);
    if (!block) return;
    block.text = input.innerText.replace(/\r\n?/g, '\n').slice(0, 8000);
    this.activeId = block.id;
    const type = SHORTCUTS[block.text];
    if (type) {
      block.text = '';
      block.type = type;
      this.renderAndFocus(block.id, 0);
      this.emitSelection();
    }
    if (block.text === '/') this.showSlashMenu(input);
    else this.hideSlashMenu();
    this.changed();
  }

  handleKeydown(event) {
    const input = event.target.closest('.block-input');
    if (!input) return;
    this.activeId = input.dataset.blockId;
    const index = this.currentIndex();
    const block = this.blocks[index];
    const offset = caretOffset(input);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.onSave();
      return;
    }
    if (event.key === 'Escape') {
      this.hideSlashMenu();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const [first, second] = splitBlock(block, offset);
      this.blocks.splice(index, 1, first, second);
      this.activeId = second.id;
      this.renderAndFocus(second.id, 0);
      this.changed();
      return;
    }
    if (event.key === 'Backspace' && offset === 0) {
      if (!block.text && block.type !== 'paragraph') {
        event.preventDefault();
        this.setCurrentType('paragraph');
        return;
      }
      if (index > 0) {
        event.preventDefault();
        const previous = this.blocks[index - 1];
        const previousLength = previous.text.length;
        this.blocks.splice(index - 1, 2, mergeBlocks(previous, block));
        this.activeId = previous.id;
        this.renderAndFocus(previous.id, previousLength);
        this.changed();
      }
      return;
    }
    if (event.key === 'Delete' && offset === block.text.length && index < this.blocks.length - 1) {
      event.preventDefault();
      const next = this.blocks[index + 1];
      this.blocks.splice(index, 2, mergeBlocks(block, next));
      this.renderAndFocus(block.id, offset);
      this.changed();
    }
  }

  handlePaste(event) {
    const input = event.target.closest('.block-input');
    if (!input) return;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain')?.replace(/\r\n?/g, '\n') || '';
    const lines = text.split('\n');
    const index = this.currentIndex();
    const block = this.blocks[index];
    const offset = caretOffset(input);
    const before = block.text.slice(0, offset);
    const after = block.text.slice(offset);
    const markdownLike = lines.length > 1 && lines.some(line => /^\s*(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|---+$)/.test(line));
    if (markdownLike) {
      const inserted = parseMarkdown(text);
      inserted[0].id = block.id;
      inserted[0].text = `${before}${inserted[0].text}`.slice(0, 8000);
      inserted[inserted.length - 1].text = `${inserted.at(-1).text}${after}`.slice(0, 8000);
      this.blocks.splice(index, 1, ...inserted);
      const last = inserted.at(-1);
      this.activeId = last.id;
      this.renderAndFocus(last.id, Math.max(0, last.text.length - after.length));
    } else if (lines.length === 1) {
      block.text = `${before}${lines[0]}${after}`.slice(0, 8000);
      this.renderAndFocus(block.id, Math.min(before.length + lines[0].length, block.text.length));
    } else {
      block.text = `${before}${lines.shift()}`.slice(0, 8000);
      const inserted = lines.map((line, lineIndex) => ({
        id: blockId(),
        type: 'paragraph',
        text: `${line}${lineIndex === lines.length - 1 ? after : ''}`.slice(0, 8000)
      }));
      this.blocks.splice(index + 1, 0, ...inserted);
      const last = inserted.at(-1) || block;
      this.activeId = last.id;
      this.renderAndFocus(last.id, Math.max(0, last.text.length - after.length));
    }
    this.changed();
  }

  showSlashMenu(input) {
    const wrapper = input.closest('.editor-block');
    this.menu.hidden = false;
    this.menu.style.top = `${wrapper.offsetTop + wrapper.offsetHeight + 4}px`;
  }

  hideSlashMenu() {
    this.menu.hidden = true;
  }

  changed() {
    this.onChange(this.getBlocks(), this.stats());
  }

  stats() {
    return {
      characters: this.blocks.reduce((sum, block) => sum + block.text.replace(/\s/g, '').length, 0),
      blocks: this.blocks.length
    };
  }

  emitSelection() {
    this.root.dispatchEvent(new CustomEvent('blockselectionchange', { detail: { type: this.currentBlock()?.type || 'paragraph' } }));
  }
}

export { BLOCK_TYPES, INLINE_FORMATS, TYPE_LABELS };
