'use strict';

const PRIMARY_KEYS = Object.freeze({
  sections: 'slug',
  articles: 'slug',
  users: 'student_id',
  submissions: 'id',
  review_events: 'id',
  contributors: 'student_id'
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

function createPgStore({ envId, apiKey, fetchImpl = globalThis.fetch }) {
  if (!envId || !apiKey || typeof fetchImpl !== 'function') {
    throw new Error('CloudBase PostgreSQL HTTP configuration is unavailable');
  }

  async function request(table, { method = 'GET', query = {}, body, prefer } = {}) {
    primaryKey(table);
    const url = new URL(`https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/${encodeURIComponent(table)}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...(prefer ? { prefer } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
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

  async function queryDocuments(table, where = null, limit = 100) {
    const filters = Object.fromEntries(
      Object.entries(where || {}).map(([key, value]) => [key, `eq.${value}`])
    );
    const result = await request(table, {
      query: { select: '*', ...filters, limit }
    });
    return assertResult(result, `Query ${table}`) || [];
  }

  return { getDocument, setDocument, deleteDocument, queryDocuments };
}

module.exports = { PRIMARY_KEYS, createPgStore };
