import { normalizeBlocks } from './editor.js?v=20260829-native-formats';
import { parseMarkdown } from './markdown.js?v=20260829-native-formats';
import { parseDocx } from './docx-import.js?v=20260829-native-formats';

export function parseLatexDocument(source = '') {
  const raw = String(source).replace(/(^|[^\\])%.*$/gm, '$1'), documentStart = raw.indexOf('\\begin{document}');
  const clean = (documentStart >= 0 ? raw.slice(documentStart + '\\begin{document}'.length) : raw).replace(/\\end\{document\}/g, '').trim();
  const blocks = []; let cursor = 0;
  const pattern = /\\(section|subsection|subsubsection)\{([^{}]*)\}|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\\begin\{(equation\*?|align\*?|gather\*?)\}([\s\S]*?)\\end\{\5\}/g;
  const addText = value => value.replace(/\\\(([^\n]*?)\\\)/g, '$$$1$$').split(/\n\s*\n/).map(item => item.trim()).filter(Boolean).forEach(text => {
    const cleanText = text.replace(/\\textbf\{([^{}]*)\}/g, '**$1**').replace(/\\textit\{([^{}]*)\}/g, '*$1*').replace(/\\(?:emph)\{([^{}]*)\}/g, '*$1*');
    const environment = cleanText.match(/^\\begin\{(itemize|enumerate)\}([\s\S]*?)\\end\{\1\}$/), body = environment ? environment[2].trim() : cleanText;
    const items = body.split(/\n|(?=\\item\s+)/).map(line => line.trim()).filter(Boolean);
    if (items.length && items.every(line => /^\\item\s+/.test(line))) items.forEach(line => blocks.push({ type: environment?.[1] === 'enumerate' ? 'number' : 'bullet', text: line.replace(/^\\item\s+/, '') }));
    else blocks.push({ type: 'paragraph', text: body });
  });
  for (const match of clean.matchAll(pattern)) {
    addText(clean.slice(cursor, match.index));
    if (match[1]) blocks.push({ type: match[1] === 'section' ? 'heading' : match[1] === 'subsection' ? 'subheading' : 'minorheading', text: match[2] });
    else { const formulas = String(match[3] || match[4] || match[6] || '').split(/\\\\/).map(value => value.replaceAll('&', '').trim()).filter(Boolean); formulas.forEach(text => blocks.push({ type: 'formula', text })); }
    cursor = match.index + match[0].length;
  }
  addText(clean.slice(cursor));
  return normalizeBlocks(blocks);
}

export async function importDocument({ format, source = '', file = null } = {}) {
  if (String(source).length > 2_000_000) throw new Error('源文不能超过 200 万字符');
  let blocks = [], warnings = [];
  if (format === 'docx') ({ blocks, warnings } = await parseDocx(file));
  else if (format === 'latex') { blocks = parseLatexDocument(source); warnings.push('LaTeX 导入支持章节、显示公式、粗体和斜体；宏、引用和排版参数会保留为文本。'); }
  else if (format === 'text') blocks = normalizeBlocks(String(source).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(text => ({ type: 'paragraph', text })));
  else {
    blocks = parseMarkdown(source);
    if (/^\s*#\s+/m.test(source)) warnings.push('Markdown H1 会按站内大标题（H2）导入。');
    if (/^\s+[-*+]\s+/m.test(source)) warnings.push('嵌套列表会展平为单层列表。');
    if (/!\[[^\]]*\]\([^)]*\)/.test(source)) warnings.push('图片不会导入，请确认附近文字是否完整。');
  }
  const clippedBeforeNormalization = Boolean(blocks.truncated);
  blocks = normalizeBlocks(blocks);
  if (JSON.stringify(blocks).length > 180_000) throw new Error('导入内容超过草稿安全大小，请拆分为多篇或精简后重试');
  if (clippedBeforeNormalization || blocks.truncated) warnings.push('内容超过编辑器 400 节点上限，超出部分已在预检时截断。');
  let blockCount = 0, characters = 0, meaningful = false;
  const visit = block => {
    blockCount += 1; characters += String(block.text || '').replace(/\s/g, '').length;
    if (block.text || ['divider', 'table', 'columns', 'toggle'].includes(block.type)) meaningful = true;
    if (block.type === 'table') block.rows.flat().forEach(cell => { characters += String(cell).replace(/\s/g, '').length; });
    if (block.type === 'columns') block.columns.flat().forEach(visit);
    if (block.type === 'toggle') block.children.forEach(visit);
  };
  blocks.forEach(visit);
  if (!meaningful) throw new Error('没有检测到可导入的内容');
  return { blocks, warnings: [...new Set(warnings)], stats: { blocks: blockCount, characters } };
}
