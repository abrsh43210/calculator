import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Small in-memory stand-in for the parts of supabase-js the billing code uses:
 * from().select/insert/update/upsert with eq/is/in/limit/order and
 * single/maybeSingle, plus rpc(). Lets tests assert on resulting table state
 * instead of on call chains.
 */
type Row = Record<string, any>;
type Filter = (row: Row) => boolean;
type Op = "select" | "insert" | "update" | "upsert";
type Result = { data: any; error: { message: string; code?: string } | null; count?: number | null };

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  rpcHandlers: Record<string, (args: any) => Result | Promise<Result>> = {};
  failures = new Map<string, string>(); // "table:op" -> message
  calls: { table: string; op: Op; payload?: unknown }[] = [];

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows.map((r) => ({ ...r }));
    return this;
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  failOn(table: string, op: Op, message = "boom") {
    this.failures.set(`${table}:${op}`, message);
    return this;
  }

  from(table: string) {
    return new QueryBuilder(this, table);
  }

  async rpc(name: string, args: any = {}): Promise<Result> {
    const handler = this.rpcHandlers[name];
    if (!handler) return { data: null, error: { message: `no rpc ${name}` } };
    return handler(args);
  }

  auth = { getUser: async () => ({ data: { user: null }, error: null }) };

  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

class QueryBuilder implements PromiseLike<Result> {
  private op: Op = "select";
  private payload: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private limitN: number | null = null;
  private orderBy: { col: string; asc: boolean }[] = [];
  private returning = false;
  private mode: "many" | "single" | "maybe" = "many";
  private headCount = false;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private columns: string[] | null = null;

  constructor(private db: FakeSupabase, private table: string) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    if (cols && cols.trim() !== "*") this.columns = cols.split(",").map((c) => c.trim());
    if (this.op === "select") this.headCount = Boolean(opts?.head);
    else this.returning = true;
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert";
    this.payload = values;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  upsert(values: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = values;
    this.upsertOpts = opts;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: null) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  /** Supports PostgREST or-strings like: a.lt."x",and(a.eq."x",b.lt."y") */
  or(expr: string) {
    this.filters.push(parseOr(expr));
    return this;
  }
  gt(col: string, val: number) {
    this.filters.push((r) => r[col] > val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, asc: opts.ascending ?? true });
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private execute(): Result {
    this.db.calls.push({ table: this.table, op: this.op, payload: this.payload ?? undefined });
    const failure = this.db.failures.get(`${this.table}:${this.op}`);
    if (failure) return { data: null, error: { message: failure } };

    const rows = this.db.rows(this.table);
    const match = (r: Row) => this.filters.every((f) => f(r));
    let affected: Row[] = [];

    switch (this.op) {
      case "select":
        affected = rows.filter(match);
        if (this.orderBy.length) {
          affected.sort((a, b) => {
            for (const { col, asc } of this.orderBy) {
              if (a[col] === b[col]) continue;
              return (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1);
            }
            return 0;
          });
        }
        if (this.limitN != null) affected = affected.slice(0, this.limitN);
        if (this.headCount) return { data: null, error: null, count: affected.length };
        return this.shape(affected);
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        affected = list.map((v) => ({
          id: v.id ?? `${this.table}_${rows.length + 1}`,
          created_at: new Date().toISOString(),
          last_used_at: null,
          revoked_at: null,
          ...v,
        }));
        rows.push(...affected);
        break;
      }
      case "update":
        affected = rows.filter(match);
        for (const r of affected) Object.assign(r, this.payload);
        break;
      case "upsert": {
        const key = this.upsertOpts.onConflict ?? "id";
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        for (const v of list) {
          const existing = rows.find((r) => r[key] === v[key]);
          if (existing) {
            if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, v);
          } else rows.push({ ...v });
          affected.push(v);
        }
        break;
      }
    }
    return this.returning || this.mode !== "many" ? this.shape(affected) : { data: null, error: null };
  }

  private shape(list: Row[]): Result {
    const cols = this.columns;
    const copy = list.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) : { ...r }));
    if (this.mode === "many") return { data: copy, error: null };
    if (copy.length > 1) return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
    if (copy.length === 0 && this.mode === "single") {
      return { data: null, error: { message: "no rows", code: "PGRST116" } };
    }
    return { data: copy[0] ?? null, error: null };
  }
}

function splitTop(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0, quoted = false, cur = "";
  for (const ch of expr) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function parseCond(expr: string): Filter {
  if (expr.startsWith("and(")) {
    const subs = splitTop(expr.slice(4, -1)).map(parseCond);
    return (r) => subs.every((f) => f(r));
  }
  const m = /^([\w]+)\.(eq|lt|gt|lte|gte)\.(.*)$/.exec(expr);
  if (!m) throw new Error(`fake .or() can't parse ${expr}`);
  const [, col, op, raw] = m;
  const val = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  return (r) => {
    const v = r[col];
    switch (op) {
      case "eq": return v === val;
      case "lt": return v < val;
      case "gt": return v > val;
      case "lte": return v <= val;
      default: return v >= val;
    }
  };
}

function parseOr(expr: string): Filter {
  const subs = splitTop(expr).map(parseCond);
  return (r) => subs.some((f) => f(r));
}
