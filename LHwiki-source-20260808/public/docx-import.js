const decoder = new TextDecoder();

function uint16(view, offset) { return view.getUint16(offset, true); }
function uint32(view, offset) { return view.getUint32(offset, true); }

const MAX_XML_BYTES = 24 * 1024 * 1024;

async function inflateRaw(bytes) {
  if (!globalThis.DecompressionStream) throw new Error('当前浏览器不支持 DOCX 解压，请换用新版 Chrome、Edge 或 Safari');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), chunks = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_XML_BYTES) { await reader.cancel(); throw new Error('DOCX 正文解压后超过 24 MB'); } chunks.push(value); }
  const result = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result;
}

async function unzipEntry(buffer, wantedName) {
  const view = new DataView(buffer); let eocd = -1;
  for (let offset = Math.max(0, view.byteLength - 65557); offset <= view.byteLength - 22; offset += 1) if (uint32(view, offset) === 0x06054b50) eocd = offset;
  if (eocd < 0) throw new Error('这不是有效的 DOCX 文件');
  const entries = uint16(view, eocd + 10), centralOffset = uint32(view, eocd + 16); let cursor = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (uint32(view, cursor) !== 0x02014b50) break;
    const method = uint16(view, cursor + 10), compressedSize = uint32(view, cursor + 20), uncompressedSize = uint32(view, cursor + 24), nameLength = uint16(view, cursor + 28), extraLength = uint16(view, cursor + 30), commentLength = uint16(view, cursor + 32), localOffset = uint32(view, cursor + 42);
    const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));
    if (name === wantedName) {
      if (uncompressedSize > MAX_XML_BYTES) throw new Error('DOCX 正文解压后超过 24 MB');
      if (uint32(view, localOffset) !== 0x04034b50) throw new Error('DOCX ZIP 目录已损坏');
      const localNameLength = uint16(view, localOffset + 26), localExtraLength = uint16(view, localOffset + 28), start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = new Uint8Array(buffer, start, compressedSize);
      if (method === 0) return compressed;
      if (method === 8) return inflateRaw(compressed);
      throw new Error(`DOCX 使用了不支持的压缩方式（${method}）`);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('DOCX 中缺少 word/document.xml');
}

function children(node, name) { return Array.from(node.childNodes || []).filter(child => child.nodeType === 1 && child.localName === name); }
function descendants(node, name) { return Array.from(node.getElementsByTagNameNS('*', name)); }
function escapeMarkdown(value) { return String(value).replace(/([\\`*_[\]~])/g, '\\$1'); }

function enabled(props, name) { const node = props && descendants(props, name)[0]; if (!node) return false; const value = node.getAttributeNS('*', 'val') || node.getAttribute('w:val') || node.getAttribute('val'); return !/^(?:0|false|off)$/i.test(value || '1'); }

function runText(paragraph, warnings = []) {
  let value = '';
  for (const run of descendants(paragraph, 'r')) {
    const raw = Array.from(run.childNodes || []).map(item => item.localName === 't' ? item.textContent || '' : ['br', 'cr'].includes(item.localName) ? '\n' : item.localName === 'tab' ? '\t' : '').join('');
    if (!raw) continue;
    const props = children(run, 'rPr')[0]; let text = escapeMarkdown(raw);
    const bold = enabled(props, 'b'), italic = enabled(props, 'i');
    if (bold) text = `**${text}**`;
    else if (italic) text = `*${text}*`;
    if (bold && italic) warnings.push('同时设置粗体和斜体的 Word 文字会优先保留粗体。');
    if (enabled(props, 'strike')) text = `~~${text}~~`;
    value += text;
  }
  if (!value) value = descendants(paragraph, 't').map(item => item.textContent || '').join('');
  return value.replace(/\s+$/g, '');
}

function paragraphBlock(paragraph, warnings) {
  const text = runText(paragraph, warnings); if (!text.trim()) return null;
  const props = children(paragraph, 'pPr')[0], style = props ? descendants(props, 'pStyle')[0]?.getAttributeNS('*', 'val') || descendants(props, 'pStyle')[0]?.getAttribute('w:val') || '' : '';
  const heading = String(style).match(/heading\s*([1-4])/i);
  if (heading) {
    const level = Number(heading[1]); if (level === 1) warnings.push('Word “标题 1”会按站内大标题（H2）导入。');
    return { type: level <= 2 ? 'heading' : level === 3 ? 'subheading' : 'minorheading', text };
  }
  if (props && descendants(props, 'numPr').length) { warnings.push('Word 自动编号与项目符号会统一按项目列表导入。'); return { type: 'bullet', text }; }
  if (/quote/i.test(style)) return { type: 'quote', text };
  return { type: 'paragraph', text };
}

function tableBlock(table, warnings) {
  if (descendants(table, 'gridSpan').length || descendants(table, 'vMerge').length) warnings.push('Word 表格合并单元格会按普通单元格展开。');
  const rows = children(table, 'tr').slice(0, 30).map(row => children(row, 'tc').slice(0, 10).map(cell => descendants(cell, 'p').map(item => runText(item, warnings)).filter(Boolean).join('\n').slice(0, 1000)));
  const width = Math.max(0, ...rows.map(row => row.length));
  if (!width) return null;
  return { type: 'table', header: true, rows: rows.map(row => Array.from({ length: width }, (_, index) => row[index] || '')) };
}

export async function parseDocx(file) {
  if (!file || file.size > 12 * 1024 * 1024) throw new Error('DOCX 文件不能超过 12 MB');
  const xmlBytes = await unzipEntry(await file.arrayBuffer(), 'word/document.xml');
  const xml = new DOMParser().parseFromString(decoder.decode(xmlBytes), 'application/xml');
  if (descendants(xml, 'parsererror').length) throw new Error('DOCX 正文 XML 无法解析');
  const body = descendants(xml, 'body')[0], blocks = [], warnings = ['DOCX 中的图片、脚注、批注、修订和浮动文本框不会导入。'];
  if (descendants(xml, 'numPr').length) warnings.push('Word 自动编号与项目符号会统一按项目列表导入。');
  if (descendants(xml, 'tr').length > 30 || descendants(xml, 'tc').some(cell => children(cell.parentNode, 'tc').length > 10)) warnings.push('超过 30 行或 10 列的 Word 表格会按编辑器上限截断。');
  for (const child of Array.from(body?.childNodes || [])) {
    if (child.localName === 'p') { const block = paragraphBlock(child, warnings); if (block) blocks.push(block); }
    if (child.localName === 'tbl') { const block = tableBlock(child, warnings); if (block) blocks.push(block); }
  }
  if (!blocks.length) throw new Error('DOCX 中没有可导入的文字或表格');
  return { blocks, warnings: [...new Set(warnings)] };
}
