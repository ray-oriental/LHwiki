const BLOCK_TYPES = new Set(['paragraph', 'heading', 'subheading', 'quote', 'bullet', 'number']);

const TYPE_LABELS = Object.freeze({
  paragraph: '正文',
  heading: '二级标题',
  subheading: '三级标题',
  quote: '引用',
  bullet: '项目列表',
  number: '编号列表'
});

const SHORTCUTS = Object.freeze({
  '## ': 'heading',
  '### ': 'subheading',
  '> ': 'quote',
  '- ': 'bullet',
  '* ': 'bullet',
  '1. ': 'number'
});

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
    marker.textContent = block.type === 'heading' ? 'H2' : block.type === 'subheading' ? 'H3' : block.type === 'quote' ? '“' : block.type === 'bullet' ? '•' : block.type === 'number' ? '1.' : '¶';
    const input = document.createElement('div');
    input.className = 'block-input';
    input.contentEditable = 'true';
    input.spellcheck = true;
    input.dataset.blockId = block.id;
    input.dataset.placeholder = block.type === 'heading' ? '章节标题' : block.type === 'subheading' ? '小节标题' : block.type === 'quote' ? '写下一句值得保留的话' : '继续写…';
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
    if (lines.length === 1) {
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

export { BLOCK_TYPES, TYPE_LABELS };
