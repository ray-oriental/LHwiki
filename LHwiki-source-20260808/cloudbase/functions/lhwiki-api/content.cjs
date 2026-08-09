const STUDENT_ID_PATTERN = /^20\d{7}$/;
const ADMIN_LOGIN_ID = 'ray_oriental';
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'subheading', 'quote', 'bullet', 'number']);
const CONTENT_TYPES = new Set(['访谈', '评价', '经验', '指南', '说明']);
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
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

function validStudentId(value) {
  return typeof value === 'string' && STUDENT_ID_PATTERN.test(value);
}

function validLoginId(value) {
  return validStudentId(value) || value === ADMIN_LOGIN_ID;
}

function normalizeText(value, max) {
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
    if (text.trim() || allowEmpty) {
      clean.push({
        ...(typeof block.id === 'string' && BLOCK_ID_PATTERN.test(block.id) ? { id: block.id } : {}),
        type: block.type,
        text: allowEmpty ? text : text.trim()
      });
    }
  }
  return clean.length || allowEmpty ? clean : null;
}

function parseDocument(value) {
  return parseBlocks(value);
}

function parseDraftDocument(value) {
  return parseBlocks(value, { allowEmpty: true });
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
  KNOWN_TEACHER_NAMES,
  normalizeText,
  parseDocument,
  parseDraftDocument,
  slugify,
  validLoginId,
  validStudentId
};
