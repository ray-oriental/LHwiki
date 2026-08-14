// 四位毕业/届别年份（20xx）+ 三位班级号 + 两位序号。
export const STUDENT_ID_PATTERN = /^20\d{7}$/;
export const ADMIN_LOGIN_ID = 'ray_oriental';
export const BLOCK_TYPES = new Set(['paragraph', 'heading', 'subheading', 'quote', 'bullet', 'number', 'check', 'checked', 'callout', 'code', 'divider']);
export const CONTENT_TYPES = new Set(['访谈', '评价', '经验', '指南', '说明']);
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export function validStudentId(value) {
  return typeof value === 'string' && STUDENT_ID_PATTERN.test(value);
}

export function validLoginId(value) {
  return validStudentId(value) || value === ADMIN_LOGIN_ID;
}

export function normalizeText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseBlocks(value, { allowEmpty = false } = {}) {
  let blocks;
  try {
    blocks = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
  if (!Array.isArray(blocks) || blocks.length > 400 || (!allowEmpty && blocks.length < 1)) return null;
  const clean = [];
  for (const block of blocks) {
    if (!block || !BLOCK_TYPES.has(block.type) || typeof block.text !== 'string') return null;
    const text = block.text.replace(/\r\n?/g, '\n').slice(0, 8000);
    const preserveEmpty = allowEmpty || block.type === 'divider';
    if (text.trim() || preserveEmpty) {
      clean.push({
        ...(typeof block.id === 'string' && BLOCK_ID_PATTERN.test(block.id) ? { id: block.id } : {}),
        type: block.type,
        text: preserveEmpty ? text : text.trim()
      });
    }
  }
  return clean.length || allowEmpty ? clean : null;
}

export function parseDocument(value) {
  return parseBlocks(value);
}

export function parseDraftDocument(value) {
  return parseBlocks(value, { allowEmpty: true });
}

export function slugify(title) {
  const base = title.toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${base || 'article'}-${crypto.randomUUID().slice(0, 8)}`;
}
