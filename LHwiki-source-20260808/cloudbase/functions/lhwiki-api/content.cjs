const STUDENT_ID_PATTERN = /^20\d{7}$/;
const ADMIN_LOGIN_ID = 'ray_oriental';
const LEGACY_BLOCK_TYPES = new Set(['paragraph', 'heading', 'subheading', 'quote', 'bullet', 'number']);
const BLOCK_TYPES = new Set([...LEGACY_BLOCK_TYPES, 'minorheading', 'divider', 'formula', 'table', 'columns', 'toggle']);
const ADVANCED_BLOCK_TYPES = new Set(['minorheading', 'divider', 'formula', 'table', 'columns', 'toggle']);
const CONTENT_TYPES = new Set(['访谈', '评价', '经验', '指南', '说明']);
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const DOCUMENT_SCHEMA_VERSION = 2;
const LIMITS = Object.freeze({ nodes: 400, depth: 2, text: 8000, formula: 2000, rows: 30, columns: 10, cell: 1000 });
const KNOWN_TEACHER_NAMES = new Set([
  '祁京生', '白志峰', '张如意', '赵月灵', '黄耀新', '陈礼旺', '李晨松', '任孝勇', '丁云', '王翠霞',
  '杨东清', '陆畅', '熊洁婕', '姜静', '敦帅', '赵高召', '李立娟', '谷伟凤', '黄含枢', '杨贻芳',
  '张雾明', '周慧', '侯志宏', '刘野', '杨娟', '赵亚利', '吴文君', '刘亚茵', '崔长华', '何建春',
  '王智杰', '谢丹', '梁莹莹', '李晓盼', '田娜', '王静', '施庆涛', '刘楠', '许香春', '张新梅',
  '白杰', '黄萍', '张丰刚', '梁然', '陈昱英', '宋久峰', '魏海楠', '徐惠', '王维', '杨连翠',
  '刘晓蕾', '赵哲嵩', '任娟', '纪艳苹', '张凯', '王珍珍', '毛燕宁', '牛林', '李小波', '李娟',
  '王雷', '贾一震', '孙宝英', '刘进', '赵永柱', '李聪聪', '郭爱显', '姚兰', '陈晓丽', '包绍洁',
  '王永娟', '马春', '邵坤', '蒋立新', '王得勇', '秦红霞', '李玉萍', '张希武', '宗宝俊', '张宏',
  '马云荣', '张晓', '夏添', '曾苗苗', '徐维维', '马剑涛', '李书梅', '张丁丁', '曲连红'
]);
for (const name of require('./known-teachers-supplement.cjs')) KNOWN_TEACHER_NAMES.add(name);

function validStudentId(value) { return typeof value === 'string' && STUDENT_ID_PATTERN.test(value); }
function validLoginId(value) { return validStudentId(value) || value === ADMIN_LOGIN_ID; }
function normalizeText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function cleanId(block, state) {
  if (typeof block.id !== 'string' || !BLOCK_ID_PATTERN.test(block.id) || state.ids.has(block.id)) return {};
  state.ids.add(block.id);
  return { id: block.id };
}
function cleanText(value, max, allowEmpty) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').slice(0, max);
  return allowEmpty ? text : text.trim();
}
function cleanBlock(block, state, depth, allowEmpty) {
  if (!block || !BLOCK_TYPES.has(block.type) || depth >= LIMITS.depth || ++state.nodes > LIMITS.nodes) return null;
  const base = { ...cleanId(block, state), type: block.type };
  if (LEGACY_BLOCK_TYPES.has(block.type) || block.type === 'minorheading') {
    const text = cleanText(block.text, LIMITS.text, allowEmpty);
    return text === null || (!allowEmpty && !text) ? null : { ...base, text };
  }
  if (block.type === 'divider') return base;
  if (block.type === 'formula') {
    const text = cleanText(block.text, LIMITS.formula, allowEmpty);
    return text === null || (!allowEmpty && !text) ? null : { ...base, text };
  }
  if (block.type === 'table') {
    if (!Array.isArray(block.rows) || block.rows.length < 1 || block.rows.length > LIMITS.rows) return null;
    const width = Array.isArray(block.rows[0]) ? block.rows[0].length : 0;
    if (width < 1 || width > LIMITS.columns) return null;
    const rows = [];
    for (const row of block.rows) {
      if (!Array.isArray(row) || row.length !== width) return null;
      const cells = row.map(cell => cleanText(cell, LIMITS.cell, true));
      if (cells.some(cell => cell === null)) return null;
      state.nodes += cells.length;
      if (state.nodes > LIMITS.nodes) return null;
      rows.push(cells);
    }
    return { ...base, header: block.header !== false, rows };
  }
  if (block.type === 'columns') {
    if (!Array.isArray(block.columns) || ![2, 3].includes(block.columns.length)) return null;
    const columns = [];
    for (const column of block.columns) {
      if (!Array.isArray(column) || column.length > 100) return null;
      const children = [];
      for (const child of column) {
        if (child?.type === 'columns' || child?.type === 'toggle') return null;
        const clean = cleanBlock(child, state, depth + 1, allowEmpty);
        if (!clean) { if (allowEmpty) return null; continue; }
        children.push(clean);
      }
      if (!children.length) children.push({ type: 'paragraph', text: '' });
      columns.push(children);
    }
    return { ...base, columns };
  }
  if (block.type === 'toggle') {
    if (![2, 3].includes(Number(block.level)) || !Array.isArray(block.children) || block.children.length > 100) return null;
    const text = cleanText(block.text, LIMITS.text, allowEmpty);
    if (text === null || (!allowEmpty && !text)) return null;
    const children = [];
    for (const child of block.children) {
      if (child?.type === 'columns' || child?.type === 'toggle') return null;
      const clean = cleanBlock(child, state, depth + 1, allowEmpty);
      if (!clean) { if (allowEmpty) return null; continue; }
      children.push(clean);
    }
    return { ...base, level: Number(block.level), text, open: block.open !== false, children };
  }
  return null;
}
function parseBlocks(value, { allowEmpty = false } = {}) {
  let blocks;
  try { blocks = typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
  if (!Array.isArray(blocks) || blocks.length > LIMITS.nodes || (!allowEmpty && blocks.length < 1)) return null;
  const state = { nodes: 0, ids: new Set() }, clean = [];
  for (const block of blocks) {
    const normalized = cleanBlock(block, state, 0, allowEmpty);
    if (!normalized) { if (allowEmpty || block?.type === 'divider') return null; continue; }
    clean.push(normalized);
  }
  return clean.length || allowEmpty ? clean : null;
}
function parseDocument(value) { return parseBlocks(value); }
function parseDraftDocument(value) { return parseBlocks(value, { allowEmpty: true }); }
function documentStats(blocks = []) {
  let characters = 0, nodes = 0;
  const visit = block => {
    nodes += 1;
    characters += typeof block.text === 'string' ? block.text.replace(/\s/g, '').length : 0;
    if (block.type === 'table') for (const row of block.rows || []) for (const cell of row) characters += String(cell).replace(/\s/g, '').length;
    if (block.type === 'columns') for (const column of block.columns || []) column.forEach(visit);
    if (block.type === 'toggle') (block.children || []).forEach(visit);
  };
  blocks.forEach(visit);
  return { characters, blocks: nodes };
}
function containsAdvancedBlocks(blocks = []) {
  return blocks.some(block => ADVANCED_BLOCK_TYPES.has(block.type)
    || (block.type === 'columns' && block.columns.some(column => containsAdvancedBlocks(column)))
    || (block.type === 'toggle' && containsAdvancedBlocks(block.children)));
}
function slugify(title) {
  const base = title.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `${base || 'article'}-${crypto.randomUUID().slice(0, 8)}`;
}

module.exports = { ADMIN_LOGIN_ID, BLOCK_TYPES, CONTENT_TYPES, DOCUMENT_SCHEMA_VERSION, KNOWN_TEACHER_NAMES, containsAdvancedBlocks, documentStats, normalizeText, parseDocument, parseDraftDocument, slugify, validLoginId, validStudentId };
