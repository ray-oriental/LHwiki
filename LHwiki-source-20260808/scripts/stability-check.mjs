const origins = (process.env.LHWIKI_ORIGINS || [
  'https://lhwiki-d9g6r8vfzc7be1c0a-1465088461.ap-shanghai.app.tcloudbase.com',
  'https://lhwiki-lhwiki-d9g6r8vfzc7be1c0a.webapps.tcloudbase.com'
].join(',')).split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);

const timeoutMs = Number(process.env.LHWIKI_TIMEOUT_MS || 10000);
const quick = process.argv.includes('--quick');
// Production checks are deliberately bounded. This script is a health probe,
// not a load generator; keeping the ceiling here prevents an accidental CI or
// scheduler configuration from consuming a large CloudBase point budget.
const concurrency = Math.max(1, Math.min(4, Number(process.env.LHWIKI_CONCURRENCY || 2)));
const rounds = Math.max(1, Math.min(5, Number(process.env.LHWIKI_ROUNDS || 2)));
const results = [];

async function probe(origin, path, expectation) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}${path}`, {
      signal: controller.signal,
      headers: { accept: expectation === 'json' ? 'application/json' : '*/*' },
      cache: 'no-store'
    });
    const body = expectation === 'json' ? await response.json() : await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (expectation === 'html' && !/<html/i.test(body)) throw new Error('HTML document missing');
    if (expectation === 'script' && body.length < 100) throw new Error('static asset unexpectedly short');
    if (path === '/api/health' && (!body?.ok || body?.database !== 'ready')) throw new Error('database is not ready');
    if (path === '/api/bootstrap' && (!Array.isArray(body?.sections) || !Array.isArray(body?.articles))) throw new Error('bootstrap shape invalid');
    if (path === '/api/session' && !Object.hasOwn(body || {}, 'user')) throw new Error('session shape invalid');
    const durationMs = Math.round(performance.now() - started);
    return { origin, path, ok: true, status: response.status, durationMs };
  } catch (error) {
    return { origin, path, ok: false, durationMs: Math.round(performance.now() - started), error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

const fullBaseline = [
  ['/', 'html'],
  ['/styles.css', 'script'],
  ['/app.js', 'script'],
  ['/editor.js', 'script'],
  ['/draft-manager.js', 'script'],
  ['/api/health', 'json'],
  ['/api/bootstrap', 'json'],
  ['/api/session', 'json']
];
const quickBaseline = [
  ['/', 'html'],
  ['/app.js', 'script'],
  ['/api/health', 'json'],
  ['/api/bootstrap', 'json']
];

const requestBudget = quick ? origins.length * quickBaseline.length : origins.length * (fullBaseline.length + rounds);
if (requestBudget > 30) throw new Error(`稳定性巡检请求预算超限：${requestBudget} > 30`);

for (const origin of origins) {
  results.push(...await Promise.all((quick ? quickBaseline : fullBaseline).map(([path, type]) => probe(origin, path, type))));
}

const queue = [];
if (!quick) for (const origin of origins) for (let index = 0; index < rounds; index += 1) queue.push([origin, '/api/bootstrap', 'json']);
for (let offset = 0; offset < queue.length; offset += concurrency) {
  results.push(...await Promise.all(queue.slice(offset, offset + concurrency).map(args => probe(...args))));
}

const durations = results.filter(item => item.ok).map(item => item.durationMs).sort((a, b) => a - b);
const percentile = value => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))] ?? null;
const failures = results.filter(item => !item.ok);
const report = {
  checkedAt: new Date().toISOString(),
  origins,
  requests: results.length,
  succeeded: results.length - failures.length,
  failed: failures.length,
  latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: durations.at(-1) ?? null },
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
