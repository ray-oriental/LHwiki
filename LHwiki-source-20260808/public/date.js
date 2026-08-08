export function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  let normalized = raw.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    normalized += 'T00:00:00Z';
  } else if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
    normalized += 'Z';
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value) {
  const parsed = parseDate(value);
  if (!parsed) return '—';

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Shanghai'
  }).format(parsed);
}
