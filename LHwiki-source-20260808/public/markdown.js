import { normalizeBlocks } from './editor.js?v=20260829-native-formats';

const CODE_FENCE = /^(`{3,})([^\n`]*)\n([\s\S]*)\n\1$/;
const INLINE_PATTERN = /(?<!\\)(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\$(?!\s)[^$\n]*?\S\$|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*[^*\n]+\*)/g;
function unescapeInline(value) { return String(value).replace(/\\([\\`*_\[\]~])/g, '$1'); }

function block(type, text = '') { return { type, text: String(text).slice(0, 8000) }; }
function escapeCell(value) { return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>'); }
function cells(line) {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(value => value.trim().replaceAll('\\|', '|').replaceAll('<br>', '\n'));
}
function tableDivider(line) {
  const values = cells(line);
  return values.length > 0 && values.every(value => /^:?-{3,}:?$/.test(value));
}

export function parseMarkdown(source = '') {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const result = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) result.push(block('paragraph', paragraph.join('\n')));
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const singleLineMath = line.match(/^\s*\$\$(.+)\$\$\s*$/);
    if (singleLineMath) { flush(); result.push(block('formula', singleLineMath[1].trim())); continue; }
    if (/^\s*\$\$\s*$/.test(line)) {
      flush(); const body = []; index += 1;
      while (index < lines.length && !/^\s*\$\$\s*$/.test(lines[index])) body.push(lines[index++]);
      result.push(block('formula', body.join('\n'))); continue;
    }
    const fence = line.match(/^(`{3,})([^`]*)$/);
    if (fence) {
      flush();
      const body = [];
      index += 1;
      while (index < lines.length && !(new RegExp(`^\`{${fence[1].length},}\\s*$`)).test(lines[index])) body.push(lines[index++]);
      const language = fence[2].trim().toLowerCase();
      if (language === 'math' || language === 'latex') result.push(block('formula', body.join('\n')));
      else if (language === 'lhwiki-block') {
        try {
          const value = JSON.parse(body.join('\n'));
          const normalized = normalizeBlocks([value])[0];
          if (normalized) result.push(normalized);
          else result.push(block('paragraph', `${fence[1]}${fence[2]}\n${body.join('\n')}\n${fence[1]}`));
        } catch {
          result.push(block('paragraph', `${fence[1]}${fence[2]}\n${body.join('\n')}\n${fence[1]}`));
        }
      } else result.push({ type: 'code', language: language.slice(0, 24), text: body.join('\n') });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    if (index + 1 < lines.length && line.includes('|') && tableDivider(lines[index + 1])) {
      flush();
      const rows = [cells(line)];
      const width = rows[0].length;
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const row = cells(lines[index]);
        if (row.length !== width) break;
        rows.push(row);
        index += 1;
      }
      index -= 1;
      result.push({ type: 'table', header: true, rows });
      continue;
    }
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    if (heading) {
      flush();
      result.push(block(heading[1].length <= 2 ? 'heading' : heading[1].length === 3 ? 'subheading' : 'minorheading', heading[2]));
      continue;
    }
    if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) { flush(); result.push({ type: 'divider' }); continue; }
    if (/^\s*>\s*\[!NOTE\]\s*$/i.test(line)) {
      flush(); const noted = []; index += 1;
      while (index < lines.length && /^\s*>/.test(lines[index])) noted.push(lines[index++].replace(/^\s*>\s?/, ''));
      index -= 1; result.push(block('callout', noted.join('\n'))); continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quoted = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quoted.push(lines[index++].replace(/^\s*>\s?/, ''));
      index -= 1;
      result.push(block('quote', quoted.join('\n')));
      continue;
    }
    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (task) { flush(); result.push({ type: 'task', checked: task[1].toLowerCase() === 'x', text: task[2] }); continue; }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) { flush(); result.push(block('bullet', bullet[1])); continue; }
    const number = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (number) { flush(); result.push(block('number', number[1])); continue; }
    paragraph.push(line);
  }
  flush();
  return normalizeBlocks(result);
}

function serializeBlock(item) {
  if (item.text?.includes('\n') && ['heading', 'subheading', 'minorheading', 'bullet', 'number', 'task'].includes(item.type)) return `\`\`\`lhwiki-block\n${JSON.stringify(item, null, 2)}\n\`\`\``;
  if (item.type === 'heading') return `## ${item.text}`;
  if (item.type === 'subheading') return `### ${item.text}`;
  if (item.type === 'minorheading') return `#### ${item.text}`;
  if (item.type === 'quote') return String(item.text).split('\n').map(line => `> ${line}`).join('\n');
  if (item.type === 'bullet') return `- ${item.text}`;
  if (item.type === 'number') return `1. ${item.text}`;
  if (item.type === 'task') return `- [${item.checked ? 'x' : ' '}] ${item.text}`;
  if (item.type === 'callout') return `> [!NOTE]\n> ${String(item.text).replaceAll('\n', '\n> ')}`;
  if (item.type === 'code') { const longest = Math.max(0, ...Array.from(String(item.text).matchAll(/`+/g), match => match[0].length)); const fence = '`'.repeat(Math.max(3, longest + 1)); return `${fence}${item.language || ''}\n${item.text}\n${fence}`; }
  if (item.type === 'divider') return '---';
  if (item.type === 'formula') return `\`\`\`math\n${item.text}\n\`\`\``;
  if (item.type === 'table') {
    const rows = item.rows || [];
    if (!rows.length) return '';
    const header = `| ${rows[0].map(escapeCell).join(' | ')} |`;
    const divider = `| ${rows[0].map(() => '---').join(' | ')} |`;
    return [header, divider, ...rows.slice(1).map(row => `| ${row.map(escapeCell).join(' | ')} |`)].join('\n');
  }
  if (item.type === 'columns' || item.type === 'toggle') return `\`\`\`lhwiki-block\n${JSON.stringify(item, null, 2)}\n\`\`\``;
  return item.text || '';
}

export function blocksToMarkdown(blocks = []) {
  return normalizeBlocks(blocks).map(serializeBlock).filter(Boolean).join('\n\n');
}

export function codeFence(value = '') {
  const match = String(value).match(CODE_FENCE);
  return match ? { language: match[2].trim(), code: match[3] } : null;
}

export function parseInlineMarkdown(value = '') {
  const source = String(value);
  const parts = [];
  let offset = 0;
  for (const match of source.matchAll(INLINE_PATTERN)) {
    if (match.index > offset) parts.push({ type: 'text', text: unescapeInline(source.slice(offset, match.index)) });
    const token = match[0];
    if (token.startsWith('**')) parts.push({ type: 'strong', text: token.slice(2, -2) });
    else if (token.startsWith('~~')) parts.push({ type: 'strike', text: token.slice(2, -2) });
    else if (token.startsWith('`')) parts.push({ type: 'code', text: token.slice(1, -1) });
    else if (token.startsWith('$')) parts.push({ type: 'formula', text: token.slice(1, -1) });
    else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      parts.push(link ? { type: 'link', text: link[1], href: link[2] } : { type: 'text', text: token });
    } else parts.push({ type: 'emphasis', text: token.slice(1, -1) });
    offset = match.index + token.length;
  }
  if (offset < source.length) parts.push({ type: 'text', text: unescapeInline(source.slice(offset)) });
  return parts.length ? parts : [{ type: 'text', text: unescapeInline(source) }];
}
