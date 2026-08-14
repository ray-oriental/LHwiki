const NS = 'http://www.w3.org/1998/Math/MathML';
const SYMBOLS = Object.freeze({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', phi: 'φ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  sum: '∑', int: '∫', prod: '∏', infty: '∞', pm: '±', times: '×', cdot: '·', div: '÷', le: '≤', ge: '≥', ne: '≠', approx: '≈',
  to: '→', leftarrow: '←', rightarrow: '→', in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩', partial: '∂', nabla: '∇'
});

function node(doc, name, text = null) {
  const element = doc.createElementNS(NS, name);
  if (text !== null) element.textContent = text;
  return element;
}

function tokenize(source) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '\\') {
      const match = source.slice(index + 1).match(/^[A-Za-z]+/);
      if (!match) throw new Error('不支持的转义');
      tokens.push(`\\${match[0]}`); index += match[0].length + 1; continue;
    }
    tokens.push(char); index += 1;
  }
  return tokens;
}

function parser(source, doc) {
  const tokens = tokenize(source);
  let position = 0;
  const parseGroup = (closing = null) => {
    const row = node(doc, 'mrow');
    while (position < tokens.length && tokens[position] !== closing) {
      let base = parseAtom();
      let sub = null, sup = null;
      while (tokens[position] === '_' || tokens[position] === '^') {
        const kind = tokens[position++];
        const script = parseAtom();
        if (kind === '_') sub = script; else sup = script;
      }
      if (sub && sup) { const wrapped = node(doc, 'msubsup'); wrapped.append(base, sub, sup); base = wrapped; }
      else if (sub) { const wrapped = node(doc, 'msub'); wrapped.append(base, sub); base = wrapped; }
      else if (sup) { const wrapped = node(doc, 'msup'); wrapped.append(base, sup); base = wrapped; }
      row.append(base);
    }
    if (closing) {
      if (tokens[position] !== closing) throw new Error('括号未闭合');
      position += 1;
    }
    return row;
  };
  const parseRequiredGroup = () => {
    if (tokens[position++] !== '{') throw new Error('命令后需要花括号');
    return parseGroup('}');
  };
  const parseAtom = () => {
    const token = tokens[position++];
    if (token === undefined || token === '}') throw new Error('公式不完整');
    if (token === '{') return parseGroup('}');
    if (token === '\\frac') { const frac = node(doc, 'mfrac'); frac.append(parseRequiredGroup(), parseRequiredGroup()); return frac; }
    if (token === '\\sqrt') { const root = node(doc, 'msqrt'); root.append(parseRequiredGroup()); return root; }
    if (token === '\\text') { const text = node(doc, 'mtext'); text.textContent = parseRequiredGroup().textContent; return text; }
    if (token.startsWith('\\')) {
      const symbol = SYMBOLS[token.slice(1)];
      if (!symbol) throw new Error(`不支持 ${token}`);
      return node(doc, ['∑', '∫', '∏'].includes(symbol) ? 'mo' : 'mi', symbol);
    }
    if (/[0-9.]/.test(token)) return node(doc, 'mn', token);
    if (/[+\-=(),[\]|<>]/.test(token)) return node(doc, 'mo', token);
    if (/[^<>&]/u.test(token)) return node(doc, 'mi', token);
    throw new Error('公式包含不支持的字符');
  };
  const row = parseGroup();
  if (position !== tokens.length) throw new Error('公式格式无效');
  return row;
}

function matrix(source, doc) {
  const match = source.match(/^\\begin\{(matrix|pmatrix|bmatrix)\}([\s\S]*)\\end\{\1\}$/);
  if (!match) return null;
  const table = node(doc, 'mtable');
  for (const rawRow of match[2].split('\\\\')) {
    const row = node(doc, 'mtr');
    for (const rawCell of rawRow.split('&')) {
      const cell = node(doc, 'mtd'); cell.append(parser(rawCell.trim(), doc)); row.append(cell);
    }
    table.append(row);
  }
  if (match[1] === 'matrix') return table;
  const fenced = node(doc, 'mrow');
  fenced.append(node(doc, 'mo', match[1] === 'pmatrix' ? '(' : '['), table, node(doc, 'mo', match[1] === 'pmatrix' ? ')' : ']'));
  return fenced;
}

export function createMathML(source, doc = document) {
  const latex = String(source ?? '').trim().slice(0, 2000);
  if (!latex) return null;
  try {
    const math = node(doc, 'math');
    math.setAttribute('display', 'block');
    math.setAttribute('aria-label', latex);
    math.append(matrix(latex, doc) || parser(latex, doc));
    return math;
  } catch { return null; }
}

export function renderMath(container, source) {
  const math = createMathML(source, container.ownerDocument || document);
  container.replaceChildren();
  if (math) container.append(math);
  else {
    const fallback = (container.ownerDocument || document).createElement('code');
    fallback.className = 'math-fallback';
    fallback.textContent = String(source ?? '') || '在此输入公式';
    container.append(fallback);
  }
  return Boolean(math);
}
