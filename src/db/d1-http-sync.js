'use strict';
const { execFileSync } = require('child_process');
const env = require('../config/env');

const REQUIRED = ['D1_ACCOUNT_ID', 'D1_DATABASE_ID', 'D1_API_TOKEN'];
let transactionWarned = false;

function assertConfigured() {
  const missing = REQUIRED.filter(key => !env[key]);
  if (missing.length) {
    throw new Error(`Cloudflare D1 is not configured: missing ${missing.join(', ')}`);
  }
}

function splitSqlScript(script) {
  const statements = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < String(script || '').length; i += 1) {
    const ch = script[i];
    const next = script[i + 1];

    if (lineComment) {
      current += ch;
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i += 1;
        blockComment = false;
      }
      continue;
    }
    if (!quote && ch === '-' && next === '-') {
      current += ch + next;
      i += 1;
      lineComment = true;
      continue;
    }
    if (!quote && ch === '/' && next === '*') {
      current += ch + next;
      i += 1;
      blockComment = true;
      continue;
    }
    if ((ch === '\'' || ch === '"') && !quote) {
      quote = ch;
      current += ch;
      continue;
    }
    if (quote && ch === quote) {
      current += ch;
      if (next === quote) {
        current += next;
        i += 1;
      } else {
        quote = null;
      }
      continue;
    }
    if (!quote && ch === ';') {
      const sql = current.trim();
      if (sql) statements.push(sql);
      current = '';
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function normalizeBindings(sql, args) {
  const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Buffer.isBuffer(params[0])) {
    const named = params[0];
    const ordered = [];
    const rewritten = sql.replace(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => {
      if (!Object.prototype.hasOwnProperty.call(named, name)) return match;
      ordered.push(named[name]);
      return '?';
    });
    return { sql: rewritten, params: ordered };
  }
  return { sql, params };
}

function shouldNoop(sql) {
  const s = String(sql || '').trim().toLowerCase();
  return (
    s === 'begin' ||
    s === 'commit' ||
    s === 'rollback' ||
    s.startsWith('pragma journal_mode') ||
    s.startsWith('pragma busy_timeout') ||
    s.startsWith('pragma wal_checkpoint') ||
    s.startsWith('pragma foreign_keys')
  );
}

function unpackResponse(payload) {
  let body;
  try {
    body = JSON.parse(payload);
  } catch (err) {
    throw new Error(`D1 returned non-JSON response: ${String(payload).slice(0, 200)}`);
  }
  if (!body.success) {
    const message = (body.errors || []).map(e => e.message || JSON.stringify(e)).join('; ') || 'D1 request failed';
    throw new Error(message);
  }

  const first = Array.isArray(body.result) ? body.result[0] : body.result;
  if (!first) return { results: [], meta: {}, success: true };
  if (first.success === false) {
    throw new Error(first.error || first.message || 'D1 query failed');
  }
  return first;
}

async function fetchD1(body) {
  assertConfigured();
  const res = await fetch(
    `${env.D1_API_BASE_URL}/accounts/${encodeURIComponent(env.D1_ACCOUNT_ID)}/d1/database/${encodeURIComponent(env.D1_DATABASE_ID)}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.D1_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`D1 HTTP ${res.status}: ${text.slice(0, 300)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`D1 returned non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!parsed.success) {
    const message = (parsed.errors || []).map(e => e.message || JSON.stringify(e)).join('; ') || 'D1 request failed';
    throw new Error(message);
  }
  return parsed;
}

function normalizeD1Sql(sql) {
  return String(sql || '').replace(/\bsqlite_master\b/gi, 'sqlite_schema');
}

function queryD1(sql, params = []) {
  assertConfigured();
  sql = normalizeD1Sql(sql);
  if (shouldNoop(sql)) return { results: [], meta: { changes: 0, last_row_id: 0 }, success: true };

  const childScript = `
const fs = require('fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const base = process.env.D1_API_BASE_URL || 'https://api.cloudflare.com/client/v4';
const account = process.env.D1_ACCOUNT_ID;
const database = process.env.D1_DATABASE_ID;
const token = process.env.D1_API_TOKEN;
(async () => {
  const res = await fetch(base + '/accounts/' + encodeURIComponent(account) + '/d1/database/' + encodeURIComponent(database) + '/query', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql: input.sql, params: input.params || [] })
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(text);
    process.exit(10);
  }
  process.stdout.write(text);
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(11);
});
`;

  const stdout = execFileSync(process.execPath, ['-e', childScript], {
    input: JSON.stringify({ sql, params }),
    encoding: 'utf8',
    timeout: env.D1_SYNC_TIMEOUT_MS,
    env: {
      ...process.env,
      D1_ACCOUNT_ID: env.D1_ACCOUNT_ID,
      D1_DATABASE_ID: env.D1_DATABASE_ID,
      D1_API_TOKEN: env.D1_API_TOKEN,
      D1_API_BASE_URL: env.D1_API_BASE_URL,
    },
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return unpackResponse(stdout);
}

async function queryD1Async(sql, params = []) {
  sql = normalizeD1Sql(sql);
  if (shouldNoop(sql)) return { results: [], meta: { changes: 0, last_row_id: 0 }, success: true };
  const parsed = await fetchD1({ sql, params });
  const first = Array.isArray(parsed.result) ? parsed.result[0] : parsed.result;
  if (!first) return { results: [], meta: {}, success: true };
  if (first.success === false) throw new Error(first.error || first.message || 'D1 query failed');
  return first;
}

async function queryD1BatchAsync(batch) {
  const normalized = batch
    .map(item => ({
      sql: normalizeD1Sql(item.sql),
      params: item.params || [],
    }))
    .filter(item => !shouldNoop(item.sql));
  if (!normalized.length) return [];
  const parsed = await fetchD1({ batch: normalized });
  const results = Array.isArray(parsed.result) ? parsed.result : [parsed.result];
  for (const item of results) {
    if (item && item.success === false) throw new Error(item.error || item.message || 'D1 query failed');
  }
  return results;
}

class D1Statement {
  constructor(sql, bound = []) {
    this.sql = sql;
    this.bound = bound;
  }

  bind(...params) {
    return new D1Statement(this.sql, params);
  }

  _execute(args) {
    const source = args.length ? args : this.bound;
    const normalized = normalizeBindings(this.sql, source);
    return queryD1(normalized.sql, normalized.params);
  }

  all(...args) {
    const result = this._execute(args);
    return result.results || [];
  }

  get(...args) {
    return this.all(...args)[0];
  }

  run(...args) {
    const result = this._execute(args);
    const meta = result.meta || {};
    return {
      changes: meta.changes || 0,
      lastInsertRowid: meta.last_row_id || 0,
      meta,
    };
  }
}

class D1HttpSyncDatabase {
  constructor() {
    assertConfigured();
    this.backend = 'd1';
    this.databaseId = env.D1_DATABASE_ID;
  }

  prepare(sql) {
    return new D1Statement(sql);
  }

  exec(script) {
    for (const sql of splitSqlScript(script)) {
      queryD1(sql, []);
    }
  }

  pragma(sql) {
    const text = `PRAGMA ${sql}`;
    if (shouldNoop(text)) return [];
    return queryD1(text, []).results || [];
  }

  transaction(fn) {
    return (...args) => {
      if (!transactionWarned) {
        console.warn('[D1] better-sqlite3 transaction() emulated without local transaction state; D1 queries are committed by Cloudflare.');
        transactionWarned = true;
      }
      return fn(...args);
    };
  }

  backup() {
    throw new Error('D1 backend does not support better-sqlite3 backup(); use Cloudflare D1 export instead.');
  }

  close() {}
}

module.exports = {
  D1HttpSyncDatabase,
  splitSqlScript,
  normalizeBindings,
  queryD1,
  queryD1Async,
  queryD1BatchAsync,
};
