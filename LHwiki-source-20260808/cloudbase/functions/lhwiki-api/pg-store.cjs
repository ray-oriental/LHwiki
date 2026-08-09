'use strict';

const PRIMARY_KEYS = Object.freeze({
  sections: 'slug',
  articles: 'slug',
  users: 'student_id',
  submissions: 'id',
  review_events: 'id',
  contributors: 'student_id',
  drafts: 'id',
  teacher_submissions: 'id',
  teacher_additions: 'id',
  site_stats: 'key',
  site_visit_events: 'visit_id'
});

function primaryKey(table) {
  const key = PRIMARY_KEYS[table];
  if (!key) throw new Error(`Unknown PostgreSQL table: ${table}`);
  return key;
}

function assertResult(result, operation) {
  if (result?.error) {
    const detail = result.error.message || result.error.code || String(result.error);
    throw new Error(`${operation} failed: ${detail}`);
  }
  return result?.data;
}

function createPgStore({ envId, apiKey, fetchImpl = globalThis.fetch, requestTimeoutMs = 8000 }) {
  if (!envId || !apiKey || typeof fetchImpl !== 'function') {
    throw new Error('CloudBase PostgreSQL HTTP configuration is unavailable');
  }

  async function request(table, { method = 'GET', query = {}, body, prefer } = {}) {
    primaryKey(table);
    const url = new URL(`https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/${encodeURIComponent(table)}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const maxAttempts = method === 'GET' ? 2 : 1;
    let response;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            ...(prefer ? { prefer } : {})
          },
          signal: controller.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        if (attempt < maxAttempts && [429, 502, 503, 504].includes(response.status)) {
          await response.text().catch(() => '');
          await new Promise(resolve => setTimeout(resolve, 150 * attempt));
          continue;
        }
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        await new Promise(resolve => setTimeout(resolve, 150 * attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!response) {
      const failure = new Error('CloudBase PostgreSQL HTTP request failed');
      failure.name = 'CloudBasePgError';
      failure.code = lastError?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
      failure.cause = lastError;
      throw failure;
    }
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = null; }
    }
    if (!response.ok) {
      const failure = new Error('CloudBase PostgreSQL HTTP request failed');
      failure.name = 'CloudBasePgError';
      failure.code = String(data?.code || `HTTP_${response.status}`);
      throw failure;
    }
    return { data };
  }

  async function getDocument(table, id) {
    const result = await request(table, {
      query: { select: '*', [primaryKey(table)]: `eq.${id}`, limit: 1 }
    });
    return assertResult(result, `Read ${table}`)?.[0] || null;
  }

  async function setDocument(table, id, data) {
    const key = primaryKey(table);
    const result = await request(table, {
      method: 'POST',
      body: { ...data, [key]: id },
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
    assertResult(result, `Write ${table}`);
  }

  async function deleteDocument(table, id) {
    const result = await request(table, {
      method: 'DELETE',
      query: { [primaryKey(table)]: `eq.${id}` },
      prefer: 'return=minimal'
    });
    assertResult(result, `Delete ${table}`);
  }

  function encodeFilters(where = null) {
    return Object.fromEntries(Object.entries(where || {}).map(([key, value]) => {
      if (value && typeof value === 'object' && typeof value.operator === 'string') {
        return [key, `${value.operator}.${value.value}`];
      }
      return [key, `eq.${value}`];
    }));
  }

  async function createDocument(table, data) {
    const result = await request(table, {
      method: 'POST',
      body: data,
      prefer: 'return=representation'
    });
    return assertResult(result, `Create ${table}`)?.[0] || null;
  }

  async function updateDocuments(table, where, data) {
    const result = await request(table, {
      method: 'PATCH',
      query: encodeFilters(where),
      body: data,
      prefer: 'return=representation'
    });
    return assertResult(result, `Update ${table}`) || [];
  }

  async function deleteDocuments(table, where) {
    const result = await request(table, {
      method: 'DELETE',
      query: encodeFilters(where),
      prefer: 'return=representation'
    });
    return assertResult(result, `Delete ${table}`) || [];
  }

  async function queryDocuments(table, where = null, limit = 100) {
    const filters = encodeFilters(where);
    const result = await request(table, {
      query: { select: '*', ...filters, limit }
    });
    return assertResult(result, `Query ${table}`) || [];
  }

  return { createDocument, deleteDocument, deleteDocuments, getDocument, queryDocuments, setDocument, updateDocuments };
}

module.exports = { PRIMARY_KEYS, createPgStore };
