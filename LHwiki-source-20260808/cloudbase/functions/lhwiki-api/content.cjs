const STUDENT_ID_PATTERN = /^20\d{7}$/;
const ADMIN_LOGIN_ID = 'ray_oriental';
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'quote', 'bullet', 'number']);
const CONTENT_TYPES = new Set(['访谈', '评价', '经验', '指南', '说明']);

function validStudentId(value) {
  return typeof value === 'string' && STUDENT_ID_PATTERN.test(value);
}

function validLoginId(value) {
  return validStudentId(value) || value === ADMIN_LOGIN_ID;
}

function normalizeText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseDocument(value) {
  let blocks;
  try {
    blocks = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > 200) return null;
  const clean = [];
  for (const block of blocks) {
    if (!block || !BLOCK_TYPES.has(block.type) || typeof block.text !== 'string') return null;
    const text = block.text.trim().slice(0, 4000);
    if (text) clean.push({ type: block.type, text });
  }
  return clean.length ? clean : null;
}

function slugify(title) {
  const base = title.toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${base || 'article'}-${crypto.randomUUID().slice(0, 8)}`;
}

module.exports = {
  ADMIN_LOGIN_ID,
  CONTENT_TYPES,
  normalizeText,
  parseDocument,
  slugify,
  validLoginId,
  validStudentId
};
