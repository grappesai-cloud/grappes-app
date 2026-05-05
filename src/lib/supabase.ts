/**
 * Supabase-compatibility shim. Drop-in for the supabase-js client API used by
 * legacy code, but routes queries to Neon Postgres (via postgres-js) and storage
 * to Vercel Blob.
 *
 * Status: TEMPORARY. Callsites should be progressively migrated to raw SQL or
 * Drizzle queries; once `git grep "supabase\\.from"` is empty and storage is
 * fully on @vercel/blob, this file can be deleted.
 *
 * Coverage:
 *   ✓ .from(table).select|insert|update|upsert|delete + filters
 *     (eq, neq, gt, gte, lt, lte, in, is, like, ilike, match, or)
 *     + order, limit, range, single, maybeSingle, count/head
 *   ✓ .rpc(name, args)            — calls SQL function
 *   ✓ .storage.from(bucket).{upload,download,remove,list,getPublicUrl}
 *     — backed by @vercel/blob
 *   ✗ .storage.from(bucket).createSignedUploadUrl                   — throws;
 *     sign-upload endpoint must be rewritten with `handleUpload` from
 *     '@vercel/blob/client'
 *   ✗ .auth.*                     — returns no-op stubs (use Better-Auth instead)
 *   ✗ .channel/.subscribe (Realtime)                                — not supported;
 *     replace with polling
 */

import postgres from 'postgres';
import { e } from './env';
import { put, del, head as blobHead, list as blobList } from '@vercel/blob';

// ─── Connection ─────────────────────────────────────────────────────────────

let _sql: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (!_sql) {
    const url = e('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL is not set — Postgres client cannot connect.');
    _sql = postgres(url, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return _sql;
}

// Re-exported for direct use (preferred for new code).
export function getPg() {
  return getSql();
}

// ─── Filter representation ──────────────────────────────────────────────────

type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'like' | 'ilike';

interface Filter {
  kind: 'simple' | 'or' | 'raw';
  op?: Op;
  col?: string;
  val?: unknown;
  // for `or`: array of OR-joined sub-filters
  parts?: Filter[];
  // for `raw`: a fragment + binds
  text?: string;
  binds?: unknown[];
}

const OP_TO_SQL: Record<Op, string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: 'IN',
  is: 'IS',
  like: 'LIKE',
  ilike: 'ILIKE',
};

function quoteIdent(name: string): string {
  // Reject anything that isn't a safe identifier — defence-in-depth, callers
  // never pass user-controlled column names but be paranoid anyway.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

function quoteTable(name: string): string {
  // Allow schema-qualified table names like "public.users".
  return name.split('.').map(quoteIdent).join('.');
}

// Render a list of filters as a parameterised WHERE fragment.
// Returns: { fragment: string, binds: unknown[], nextIndex: number }
function renderWhere(filters: Filter[], startIndex = 1): { fragment: string; binds: unknown[]; nextIndex: number } {
  if (!filters.length) return { fragment: '', binds: [], nextIndex: startIndex };

  const binds: unknown[] = [];
  let idx = startIndex;
  const parts = filters.map((f) => renderFilter(f));
  function renderFilter(f: Filter): string {
    if (f.kind === 'raw') {
      const out = f.text!.replace(/\$(\d+)/g, (_, n) => {
        const slot = idx++;
        binds.push(f.binds![Number(n) - 1]);
        return `$${slot}`;
      });
      return `(${out})`;
    }
    if (f.kind === 'or') {
      return '(' + f.parts!.map(renderFilter).join(' OR ') + ')';
    }
    const col = quoteIdent(f.col!);
    const op = f.op!;
    if (op === 'is') {
      // .is('col', null) — render as IS NULL / IS NOT NULL
      if (f.val === null) return `${col} IS NULL`;
      if (f.val === false) return `${col} IS FALSE`;
      if (f.val === true) return `${col} IS TRUE`;
      const slot = idx++;
      binds.push(f.val);
      return `${col} IS $${slot}`;
    }
    if (op === 'in') {
      const arr = (f.val as unknown[]) ?? [];
      if (arr.length === 0) return 'FALSE'; // empty IN (...) is invalid SQL; semantically false
      const placeholders = arr.map(() => `$${idx++}`).join(',');
      arr.forEach((v) => binds.push(v));
      return `${col} IN (${placeholders})`;
    }
    const slot = idx++;
    binds.push(f.val);
    return `${col} ${OP_TO_SQL[op]} $${slot}`;
  }
  return { fragment: 'WHERE ' + parts.join(' AND '), binds, nextIndex: idx };
}

// ─── QueryBuilder ───────────────────────────────────────────────────────────

interface CountOpts { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }
type ResultRow = Record<string, unknown>;

/** Supabase-compatible error: includes `code` so callers that check
 *  `error.code === 'PGRST116'` etc. keep working. */
export class ShimError extends Error {
  code: string;
  details: string | null;
  hint: string | null;
  constructor(message: string, opts: { code?: string; details?: string | null; hint?: string | null } = {}) {
    super(message);
    this.name = 'ShimError';
    this.code = opts.code ?? '';
    this.details = opts.details ?? null;
    this.hint = opts.hint ?? null;
  }
}

function toShimError(err: unknown, codeHint?: string): ShimError {
  if (err instanceof ShimError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const code = codeHint ?? (err as any)?.code ?? '';
  return new ShimError(message, { code });
}

class QueryBuilder<T = any> implements PromiseLike<{ data: T[] | null; error: ShimError | null; count?: number }> {
  private table: string;
  private filters: Filter[] = [];
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private selectCols = '*';
  private orderBy: { col: string; ascending: boolean }[] = [];
  private limitN?: number;
  private offsetN?: number;
  private payload?: ResultRow | ResultRow[];
  private upsertOnConflict?: string;
  private upsertIgnoreDuplicates?: boolean;
  private returning?: string;
  private countMode?: 'exact' | 'planned' | 'estimated';
  private headOnly = false;

  constructor(table: string) {
    this.table = table;
  }

  // ── Filters (chainable) ──────────────────────────────────────────────────
  private add(op: Op, col: string, val: unknown) { this.filters.push({ kind: 'simple', op, col, val }); return this; }
  eq(col: string, val: unknown) { return this.add('eq', col, val); }
  neq(col: string, val: unknown) { return this.add('neq', col, val); }
  gt(col: string, val: unknown) { return this.add('gt', col, val); }
  gte(col: string, val: unknown) { return this.add('gte', col, val); }
  lt(col: string, val: unknown) { return this.add('lt', col, val); }
  lte(col: string, val: unknown) { return this.add('lte', col, val); }
  in(col: string, vals: unknown[]) { return this.add('in', col, vals); }
  is(col: string, val: unknown) { return this.add('is', col, val); }
  like(col: string, pat: string) { return this.add('like', col, pat); }
  ilike(col: string, pat: string) { return this.add('ilike', col, pat); }
  match(criteria: Record<string, unknown>) {
    for (const [col, val] of Object.entries(criteria)) {
      if (val === null) this.add('is', col, null);
      else this.add('eq', col, val);
    }
    return this;
  }
  /** Supabase `.not(col, op, val)` — negates a filter. Most common form is
   *  `.not('col', 'is', null)` → `col IS NOT NULL`. */
  not(col: string, op: Op, val: unknown) {
    if (op === 'is') {
      // IS NOT NULL / IS NOT TRUE / IS NOT FALSE / IS NOT $val
      const text = val === null
        ? `${quoteIdent(col)} IS NOT NULL`
        : val === true
          ? `${quoteIdent(col)} IS NOT TRUE`
          : val === false
            ? `${quoteIdent(col)} IS NOT FALSE`
            : `${quoteIdent(col)} IS NOT $1`;
      this.filters.push({ kind: 'raw', text, binds: val === null || val === true || val === false ? [] : [val] });
      return this;
    }
    if (op === 'in') {
      const arr = (val as unknown[]) ?? [];
      if (arr.length === 0) return this; // empty IN-negation = always true
      const placeholders = arr.map((_, i) => `$${i + 1}`).join(',');
      this.filters.push({ kind: 'raw', text: `${quoteIdent(col)} NOT IN (${placeholders})`, binds: arr });
      return this;
    }
    this.filters.push({ kind: 'raw', text: `NOT (${quoteIdent(col)} ${OP_TO_SQL[op]} $1)`, binds: [val] });
    return this;
  }
  /**
   * Supabase's .or('col1.eq.x,col2.eq.y') — comma-separated filter clauses
   * that are OR-joined. Only the basic forms used by this codebase are supported.
   */
  or(filterString: string) {
    const parts: Filter[] = filterString.split(',').map((piece) => {
      const m = piece.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(eq|neq|gt|gte|lt|lte|like|ilike|is)\.(.*)$/);
      if (!m) throw new Error(`Unsupported .or() clause: ${piece}`);
      const [, col, op, raw] = m;
      let val: unknown = raw;
      if (op === 'is') {
        if (raw === 'null') val = null;
        else if (raw === 'true') val = true;
        else if (raw === 'false') val = false;
      } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
        val = Number(raw);
      }
      return { kind: 'simple', op: op as Op, col, val };
    });
    this.filters.push({ kind: 'or', parts });
    return this;
  }

  // ── Modifiers ────────────────────────────────────────────────────────────
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, ascending: opts.ascending ?? true });
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.offsetN = from; this.limitN = to - from + 1; return this; }

  // ── Terminators (op-changers, still chainable) ───────────────────────────
  select(cols = '*', opts: CountOpts = {}) {
    if (this.op === 'select') {
      this.selectCols = cols;
      if (opts.count) this.countMode = opts.count;
      if (opts.head) this.headOnly = true;
    } else {
      // insert/update/delete .select() = RETURNING
      this.returning = cols;
    }
    return this;
  }
  insert(data: ResultRow | ResultRow[]) { this.op = 'insert'; this.payload = data; return this; }
  update(data: ResultRow) { this.op = 'update'; this.payload = data; return this; }
  upsert(data: ResultRow | ResultRow[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.payload = data;
    this.upsertOnConflict = opts.onConflict;
    this.upsertIgnoreDuplicates = opts.ignoreDuplicates;
    return this;
  }
  delete() { this.op = 'delete'; return this; }

  // ── Execution ────────────────────────────────────────────────────────────
  async single(): Promise<{ data: T | null; error: ShimError | null }> {
    const r = await this.execute();
    if (r.error) return { data: null, error: r.error };
    if (!r.data || r.data.length === 0) {
      return { data: null, error: new ShimError('No rows returned', { code: 'PGRST116' }) };
    }
    if (r.data.length > 1) {
      return { data: null, error: new ShimError('Multiple rows returned for single()', { code: 'PGRST117' }) };
    }
    return { data: r.data[0], error: null };
  }
  async maybeSingle(): Promise<{ data: T | null; error: ShimError | null }> {
    const r = await this.execute();
    if (r.error) return { data: null, error: r.error };
    if (!r.data || r.data.length === 0) return { data: null, error: null };
    return { data: r.data[0], error: null };
  }

  // PromiseLike — `await client.from(...).select()` resolves to {data, error[, count]}
  then<TR1 = { data: T[] | null; error: ShimError | null; count?: number }, TR2 = never>(
    onfulfilled?: ((value: { data: T[] | null; error: ShimError | null; count?: number }) => TR1 | PromiseLike<TR1>) | null,
    onrejected?: ((reason: any) => TR2 | PromiseLike<TR2>) | null,
  ): Promise<TR1 | TR2> {
    return this.execute().then(onfulfilled as any, onrejected);
  }

  // ── SQL emission ─────────────────────────────────────────────────────────
  private async execute(): Promise<{ data: T[] | null; error: ShimError | null; count?: number }> {
    const sql = getSql();
    try {
      if (this.op === 'select') {
        const { fragment, binds } = renderWhere(this.filters);
        const orderClause = this.orderBy.length
          ? 'ORDER BY ' + this.orderBy.map((o) => `${quoteIdent(o.col)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')
          : '';
        const limitClause = this.limitN != null ? `LIMIT ${this.limitN}` : '';
        const offsetClause = this.offsetN != null ? `OFFSET ${this.offsetN}` : '';

        if (this.countMode === 'exact') {
          // Count + (optional) head-only — return count, no data when head:true
          const countSql = `SELECT COUNT(*)::int AS c FROM ${quoteTable(this.table)} ${fragment}`;
          const cRows = await sql.unsafe(countSql, binds as any[]);
          const count = (cRows[0] as any)?.c ?? 0;
          if (this.headOnly) return { data: null, error: null, count };
          const dataSql = `SELECT ${this.selectCols === '*' ? '*' : this.selectCols} FROM ${quoteTable(this.table)} ${fragment} ${orderClause} ${limitClause} ${offsetClause}`;
          const rows = await sql.unsafe(dataSql, binds as any[]);
          return { data: rows as unknown as T[], error: null, count };
        }

        const dataSql = `SELECT ${this.selectCols === '*' ? '*' : this.selectCols} FROM ${quoteTable(this.table)} ${fragment} ${orderClause} ${limitClause} ${offsetClause}`;
        const rows = await sql.unsafe(dataSql, binds as any[]);
        return { data: rows as unknown as T[], error: null };
      }

      if (this.op === 'insert' || this.op === 'upsert') {
        const records = Array.isArray(this.payload) ? this.payload : [this.payload as ResultRow];
        if (records.length === 0) return { data: [], error: null };

        // Union of all keys (Supabase tolerates heterogeneous rows by defaulting NULLs).
        const cols = Array.from(new Set(records.flatMap((r) => Object.keys(r ?? {}))));
        if (cols.length === 0) return { data: null, error: new ShimError('insert/upsert requires at least one column') };

        const colList = cols.map(quoteIdent).join(', ');
        const placeholders: string[] = [];
        const binds: unknown[] = [];
        let idx = 1;
        for (const r of records) {
          const row = cols.map((c) => {
            binds.push((r as any)[c] ?? null);
            return `$${idx++}`;
          });
          placeholders.push('(' + row.join(', ') + ')');
        }

        let onConflict = '';
        if (this.op === 'upsert') {
          const target = this.upsertOnConflict ?? 'id';
          const targetCols = target.split(',').map((s) => quoteIdent(s.trim())).join(', ');
          if (this.upsertIgnoreDuplicates) {
            onConflict = `ON CONFLICT (${targetCols}) DO NOTHING`;
          } else {
            const updates = cols
              .filter((c) => !target.split(',').map((s) => s.trim()).includes(c))
              .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`);
            onConflict = updates.length
              ? `ON CONFLICT (${targetCols}) DO UPDATE SET ${updates.join(', ')}`
              : `ON CONFLICT (${targetCols}) DO NOTHING`;
          }
        }

        const returning = this.returning ? `RETURNING ${this.returning === '*' ? '*' : this.returning}` : '';
        const stmt = `INSERT INTO ${quoteTable(this.table)} (${colList}) VALUES ${placeholders.join(', ')} ${onConflict} ${returning}`.trim();
        const rows = returning
          ? await sql.unsafe(stmt, binds as any[])
          : ((await sql.unsafe(stmt, binds as any[])), [] as any[]);
        return { data: rows as unknown as T[], error: null };
      }

      if (this.op === 'update') {
        const data = (this.payload ?? {}) as ResultRow;
        const cols = Object.keys(data);
        if (cols.length === 0) return { data: null, error: new ShimError('update requires at least one column') };

        const binds: unknown[] = [];
        let idx = 1;
        const sets = cols.map((c) => {
          binds.push((data as any)[c]);
          return `${quoteIdent(c)} = $${idx++}`;
        }).join(', ');
        const where = renderWhere(this.filters, idx);
        binds.push(...(where.binds as unknown[]));
        const returning = this.returning ? `RETURNING ${this.returning === '*' ? '*' : this.returning}` : '';
        const stmt = `UPDATE ${quoteTable(this.table)} SET ${sets} ${where.fragment} ${returning}`.trim();
        const rows = returning
          ? await sql.unsafe(stmt, binds as any[])
          : ((await sql.unsafe(stmt, binds as any[])), [] as any[]);
        return { data: rows as unknown as T[], error: null };
      }

      if (this.op === 'delete') {
        const where = renderWhere(this.filters);
        const returning = this.returning ? `RETURNING ${this.returning === '*' ? '*' : this.returning}` : '';
        const stmt = `DELETE FROM ${quoteTable(this.table)} ${where.fragment} ${returning}`.trim();
        const rows = returning
          ? await sql.unsafe(stmt, where.binds as any[])
          : ((await sql.unsafe(stmt, where.binds as any[])), [] as any[]);
        return { data: rows as unknown as T[], error: null };
      }

      return { data: null, error: new ShimError(`Unknown op: ${this.op}`) };
    } catch (err) {
      return { data: null, error: toShimError(err) };
    }
  }
}

// ─── Storage shim (Vercel Blob backend) ─────────────────────────────────────

class BlobBucket {
  constructor(public bucket: string) {}

  private prefixed(path: string) {
    // Namespace blob keys by bucket so multiple Supabase buckets can coexist.
    return `${this.bucket}/${path.replace(/^\/+/, '')}`;
  }

  async upload(path: string, body: Blob | ArrayBuffer | Buffer | Uint8Array, opts: { contentType?: string; upsert?: boolean } = {}) {
    try {
      const blob = await put(this.prefixed(path), body as any, {
        access: 'public',
        contentType: opts.contentType,
        addRandomSuffix: false,
        allowOverwrite: opts.upsert ?? true,
      });
      return { data: { path, fullPath: blob.pathname }, error: null };
    } catch (err) {
      return { data: null, error: toShimError(err) };
    }
  }

  async download(path: string): Promise<{ data: Blob | null; error: ShimError | null }> {
    try {
      const meta = await blobHead(this.prefixed(path));
      const res = await fetch(meta.url);
      if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
      const data = await res.blob();
      return { data, error: null };
    } catch (err) {
      return { data: null, error: toShimError(err) };
    }
  }

  async remove(paths: string[]) {
    try {
      const urls: string[] = [];
      for (const p of paths) {
        try {
          const meta = await blobHead(this.prefixed(p));
          urls.push(meta.url);
        } catch { /* missing — ignore */ }
      }
      if (urls.length) await del(urls);
      return { data: paths.map((p) => ({ name: p })), error: null };
    } catch (err) {
      return { data: null, error: toShimError(err) };
    }
  }

  async list(prefix?: string) {
    try {
      const res = await blobList({ prefix: this.prefixed(prefix ?? '') });
      return { data: res.blobs.map((b) => ({ name: b.pathname, ...b })), error: null };
    } catch (err) {
      return { data: null, error: toShimError(err) };
    }
  }

  getPublicUrl(path: string) {
    // Vercel Blob URLs are public by default; we don't have a pre-built base URL —
    // callers should use the URL returned by upload(). For legacy code that calls
    // getPublicUrl AFTER an upload, we can hit head() but that is async. The shim
    // exposes a synchronous best-effort URL via the convention used by upload().
    // In practice every callsite uses the URL returned by upload() or stored in DB.
    // This synchronous helper returns a placeholder pattern that callers fall back from.
    return { data: { publicUrl: `/__blob/${this.prefixed(path)}` } };
  }

  // Not emulated — refactor sign-upload.ts to use @vercel/blob/client handleUpload.
  async createSignedUploadUrl(_path: string): Promise<never> {
    throw new Error(
      '[supabase-shim] createSignedUploadUrl is not emulated. ' +
      "Rewrite sign-upload.ts using `handleUpload` from '@vercel/blob/client'.",
    );
  }
}

class StorageShim {
  from(bucket: string) { return new BlobBucket(bucket); }
}

// ─── Auth shim ──────────────────────────────────────────────────────────────
// Better-Auth handles auth now. Code that called supabase.auth.* should be
// migrated to lib/session.ts. These stubs exist so legacy code compiles
// during the migration window.

class AuthShim {
  async getUser() {
    console.warn('[supabase-shim] supabase.auth.getUser() — migrate to Astro.locals.user / lib/session.ts');
    return { data: { user: null }, error: null };
  }
  async getSession() {
    return { data: { session: null }, error: null };
  }
  async signOut() {
    console.warn('[supabase-shim] supabase.auth.signOut() — migrate to /api/auth/sign-out (Better-Auth)');
    return { error: null };
  }
  async signInWithPassword(_creds: any) {
    return { data: { user: null, session: null }, error: new ShimError('Use Better-Auth: /api/auth/sign-in/email') };
  }
  async signUp(_creds: any) {
    return { data: { user: null, session: null }, error: new ShimError('Use Better-Auth: /api/auth/sign-up/email') };
  }
  async exchangeCodeForSession(_code: string) {
    return { data: { user: null, session: null }, error: new ShimError('OAuth handled by Better-Auth') };
  }
  async resetPasswordForEmail(_email: string, _opts: any) {
    return { error: new ShimError('Use Better-Auth: /api/auth/forget-password') };
  }
  async updateUser(_attrs: any) {
    return { data: { user: null }, error: new ShimError('Use Better-Auth: /api/auth/reset-password') };
  }
  async signInWithOAuth(_args: any) {
    return { data: { url: null, provider: null }, error: new ShimError('Use Better-Auth: /api/auth/sign-in/social') };
  }

  // .auth.admin.* — used by admin tooling. Routes the call to Better-Auth or
  // raw SQL where it makes sense; surfaces a clear error otherwise so the bug
  // shows up loudly during smoke testing.
  admin = {
    async deleteUser(userId: string) {
      try {
        const sql = getSql();
        await sql`DELETE FROM "user" WHERE id = ${userId}`;
        return { data: null, error: null };
      } catch (err) {
        return { data: null, error: toShimError(err) };
      }
    },
    async generateLink(_args: any) {
      return { data: null, error: new ShimError('admin.generateLink not emulated — implement via Better-Auth admin plugin or short-lived signed cookie') };
    },
  };
}

// ─── Top-level shim ─────────────────────────────────────────────────────────

class SupabaseShim {
  storage = new StorageShim();
  auth = new AuthShim();

  from<T = any>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table);
  }

  /** Calls a SQL function: SELECT fn(arg1 => $1, arg2 => $2). */
  async rpc(fnName: string, params?: Record<string, unknown>): Promise<{ data: any; error: ShimError | null }> {
    try {
      const sql = getSql();
      if (!params || Object.keys(params).length === 0) {
        const rows = await sql.unsafe(`SELECT ${quoteIdent(fnName)}() AS result`);
        return { data: (rows[0] as any)?.result ?? null, error: null };
      }
      const keys = Object.keys(params);
      const binds = keys.map((k) => params[k]);
      const args = keys.map((k, i) => `${quoteIdent(k)} := $${i + 1}`).join(', ');
      const rows = await sql.unsafe(`SELECT ${quoteIdent(fnName)}(${args}) AS result`, binds as any[]);
      const result = (rows[0] as any)?.result ?? null;
      return { data: result, error: null };
    } catch (err) {
      return { data: null, error: toShimError(err) };
    }
  }

  /** No-op: realtime is not supported. Returns a chainable stub so callers don't crash. */
  channel(_name: string) {
    const noop = {
      on: () => noop,
      subscribe: () => ({ unsubscribe: () => {} }),
      unsubscribe: () => {},
    };
    return noop;
  }
  removeChannel(_ch: any) { /* noop */ }
}

// ─── Public factory functions ───────────────────────────────────────────────

/**
 * Auth-aware client. The legacy signature accepted (request, cookies); we now
 * ignore them since Better-Auth handles sessions out-of-band. Kept for compat.
 */
export function createAuthClient(_request?: Request, _cookies?: unknown): SupabaseShim {
  return new SupabaseShim();
}

/** Admin client — same shape, same DB connection (no privilege separation now). */
export function createAdminClient(): SupabaseShim {
  return new SupabaseShim();
}

export type SupabaseLikeClient = SupabaseShim;
