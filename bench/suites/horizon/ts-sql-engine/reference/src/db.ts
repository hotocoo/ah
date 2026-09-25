// Reference solution: an in-memory SQL engine for the subset in SPEC.md.
export type Value = number | string | null;
export interface Result {
  columns: string[];
  rows: Value[][];
  changes?: number;
}

// ---------- lexer ----------
type Tok = { t: "num" | "str" | "id" | "op" | "eof"; v: string; pos: number; end: number };
const RESERVED = new Set(
  "SELECT DISTINCT FROM WHERE GROUP BY HAVING ORDER ASC DESC LIMIT OFFSET AS JOIN INNER LEFT OUTER ON INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP AND OR NOT NULL IS IN BETWEEN LIKE".split(" "),
);

function lex(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const digit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
  while (i < sql.length) {
    const c = sql[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    const start = i;
    if (digit(c) || (c === "." && digit(sql[i + 1]))) {
      while (digit(sql[i])) i++;
      if (sql[i] === ".") {
        i++;
        while (digit(sql[i])) i++;
      }
      out.push({ t: "num", v: sql.slice(start, i), pos: start, end: i });
      continue;
    }
    if (c === "'") {
      let s = "";
      i++;
      for (;;) {
        if (i >= sql.length) throw new Error("syntax error: unterminated string");
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += sql[i++];
      }
      out.push({ t: "str", v: s, pos: start, end: i });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i]!)) i++;
      out.push({ t: "id", v: sql.slice(start, i), pos: start, end: i });
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (["<=", ">=", "<>", "!=", "==", "||"].includes(two)) {
      out.push({ t: "op", v: two, pos: i, end: i + 2 });
      i += 2;
      continue;
    }
    if ("(),.*+-/%=<>;".includes(c)) {
      out.push({ t: "op", v: c, pos: i, end: i + 1 });
      i++;
      continue;
    }
    throw new Error(`syntax error near "${c}"`);
  }
  out.push({ t: "eof", v: "", pos: sql.length, end: sql.length });
  return out;
}

// ---------- AST ----------
type Expr =
  | { k: "lit"; v: Value }
  | { k: "col"; table: string | null; name: string }
  | { k: "neg"; e: Expr }
  | { k: "not"; e: Expr }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "isnull"; e: Expr; not: boolean }
  | { k: "in"; e: Expr; list: Expr[]; not: boolean }
  | { k: "between"; e: Expr; lo: Expr; hi: Expr; not: boolean }
  | { k: "like"; e: Expr; pat: Expr; not: boolean }
  | { k: "fn"; name: string; args: Expr[]; star: boolean; distinct: boolean };

type Item = { k: "star"; table: string | null } | { k: "expr"; e: Expr; name: string | null };
interface Select {
  k: "select";
  distinct: boolean;
  items: Item[];
  from: { table: string; alias: string } | null;
  joins: { left: boolean; table: string; alias: string; on: Expr }[];
  where: Expr | null;
  groupBy: Expr[];
  having: Expr | null;
  orderBy: { e: Expr; desc: boolean }[];
  limit: Expr | null;
  offset: Expr | null;
}
type Stmt =
  | Select
  | { k: "create"; table: string; cols: string[] }
  | { k: "drop"; table: string }
  | { k: "insert"; table: string; cols: string[] | null; rows: Expr[][] }
  | { k: "update"; table: string; sets: { col: string; e: Expr }[]; where: Expr | null }
  | { k: "delete"; table: string; where: Expr | null };

const AGGREGATES = new Set(["count", "sum", "avg", "min", "max"]);

// ---------- parser ----------
class Parser {
  private i = 0;
  constructor(private sql: string, private toks: Tok[]) {}

  private peek(n = 0) {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)]!;
  }
  private next() {
    return this.toks[this.i++]!;
  }
  private fail(): never {
    const t = this.peek();
    throw new Error(`syntax error near "${t.t === "eof" ? "end of input" : t.v}"`);
  }
  private isKw(k: string, n = 0) {
    const t = this.peek(n);
    return t.t === "id" && t.v.toUpperCase() === k;
  }
  private eatKw(k: string) {
    if (!this.isKw(k)) return false;
    this.i++;
    return true;
  }
  private kw(k: string) {
    if (!this.eatKw(k)) this.fail();
  }
  private isOp(o: string) {
    const t = this.peek();
    return t.t === "op" && t.v === o;
  }
  private eatOp(o: string) {
    if (!this.isOp(o)) return false;
    this.i++;
    return true;
  }
  private op(o: string) {
    if (!this.eatOp(o)) this.fail();
  }
  private ident(): string {
    const t = this.peek();
    if (t.t !== "id" || RESERVED.has(t.v.toUpperCase())) this.fail();
    this.i++;
    return t.v;
  }

  atEnd() {
    while (this.eatOp(";"));
    return this.peek().t === "eof";
  }

  statement(): Stmt {
    const s = this.stmt();
    if (!this.isOp(";") && this.peek().t !== "eof") this.fail();
    return s;
  }

  private stmt(): Stmt {
    if (this.eatKw("SELECT")) return this.select();
    if (this.eatKw("CREATE")) {
      this.kw("TABLE");
      const table = this.ident();
      this.op("(");
      const cols: string[] = [];
      do {
        cols.push(this.ident());
        while (this.peek().t === "id" && !this.isOp(",")) this.i++; // type name(s)
        if (this.eatOp("(")) {
          while (!this.eatOp(")")) this.next().t === "eof" && this.fail();
        }
      } while (this.eatOp(","));
      this.op(")");
      return { k: "create", table, cols };
    }
    if (this.eatKw("DROP")) {
      this.kw("TABLE");
      return { k: "drop", table: this.ident() };
    }
    if (this.eatKw("INSERT")) {
      this.kw("INTO");
      const table = this.ident();
      let cols: string[] | null = null;
      if (this.eatOp("(")) {
        cols = [];
        do cols.push(this.ident());
        while (this.eatOp(","));
        this.op(")");
      }
      this.kw("VALUES");
      const rows: Expr[][] = [];
      do {
        this.op("(");
        const row: Expr[] = [];
        do row.push(this.expr());
        while (this.eatOp(","));
        this.op(")");
        rows.push(row);
      } while (this.eatOp(","));
      return { k: "insert", table, cols, rows };
    }
    if (this.eatKw("UPDATE")) {
      const table = this.ident();
      this.kw("SET");
      const sets: { col: string; e: Expr }[] = [];
      do {
        const col = this.ident();
        this.op("=");
        sets.push({ col, e: this.expr() });
      } while (this.eatOp(","));
      return { k: "update", table, sets, where: this.eatKw("WHERE") ? this.expr() : null };
    }
    if (this.eatKw("DELETE")) {
      this.kw("FROM");
      const table = this.ident();
      return { k: "delete", table, where: this.eatKw("WHERE") ? this.expr() : null };
    }
    this.fail();
  }

  private tableRef() {
    const table = this.ident();
    let alias = table;
    if (this.eatKw("AS")) alias = this.ident();
    else if (this.peek().t === "id" && !RESERVED.has(this.peek().v.toUpperCase())) alias = this.ident();
    return { table, alias };
  }

  private select(): Select {
    const s: Select = { k: "select", distinct: this.eatKw("DISTINCT"), items: [], from: null, joins: [], where: null, groupBy: [], having: null, orderBy: [], limit: null, offset: null };
    do {
      if (this.eatOp("*")) s.items.push({ k: "star", table: null });
      else if (this.peek().t === "id" && this.peek(1).v === "." && this.peek(2).v === "*") {
        const table = this.ident();
        this.i += 2;
        s.items.push({ k: "star", table });
      } else {
        const start = this.peek().pos;
        const e = this.expr();
        const text = this.sql.slice(start, this.toks[this.i - 1]!.end);
        // A plain column takes its declared name (resolved later); other expressions their text.
        let name: string | null = e.k === "col" ? null : text;
        if (this.eatKw("AS")) name = this.ident();
        else if (this.peek().t === "id" && !RESERVED.has(this.peek().v.toUpperCase())) name = this.ident();
        s.items.push({ k: "expr", e, name });
      }
    } while (this.eatOp(","));
    if (this.eatKw("FROM")) {
      s.from = this.tableRef();
      for (;;) {
        let left = false;
        if (this.eatKw("LEFT")) {
          left = true;
          this.eatKw("OUTER");
          this.kw("JOIN");
        } else if (this.eatKw("INNER")) this.kw("JOIN");
        else if (!this.eatKw("JOIN")) break;
        const ref = this.tableRef();
        this.kw("ON");
        s.joins.push({ left, ...ref, on: this.expr() });
      }
    }
    if (this.eatKw("WHERE")) s.where = this.expr();
    if (this.eatKw("GROUP")) {
      this.kw("BY");
      do s.groupBy.push(this.expr());
      while (this.eatOp(","));
    }
    if (this.eatKw("HAVING")) s.having = this.expr();
    if (this.eatKw("ORDER")) {
      this.kw("BY");
      do {
        const e = this.expr();
        const desc = this.eatKw("DESC") ? true : (this.eatKw("ASC"), false);
        s.orderBy.push({ e, desc });
      } while (this.eatOp(","));
    }
    if (this.eatKw("LIMIT")) {
      s.limit = this.expr();
      if (this.eatKw("OFFSET")) s.offset = this.expr();
    }
    return s;
  }

  expr(): Expr {
    return this.or();
  }
  private or(): Expr {
    let l = this.and();
    while (this.eatKw("OR")) l = { k: "bin", op: "OR", l, r: this.and() };
    return l;
  }
  private and(): Expr {
    let l = this.not();
    while (this.eatKw("AND")) l = { k: "bin", op: "AND", l, r: this.not() };
    return l;
  }
  private not(): Expr {
    if (this.eatKw("NOT")) return { k: "not", e: this.not() };
    return this.cmp();
  }
  private cmp(): Expr {
    let l = this.add();
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && ["=", "==", "!=", "<>", "<", "<=", ">", ">="].includes(t.v)) {
        this.i++;
        l = { k: "bin", op: t.v === "==" ? "=" : t.v === "<>" ? "!=" : t.v, l, r: this.add() };
        continue;
      }
      if (this.eatKw("IS")) {
        const not = this.eatKw("NOT");
        this.kw("NULL");
        l = { k: "isnull", e: l, not };
        continue;
      }
      const not = this.isKw("NOT") && (this.isKw("IN", 1) || this.isKw("BETWEEN", 1) || this.isKw("LIKE", 1));
      if (not) this.i++;
      if (this.eatKw("IN")) {
        this.op("(");
        const list: Expr[] = [];
        if (!this.isOp(")")) {
          do list.push(this.expr());
          while (this.eatOp(","));
        }
        this.op(")");
        l = { k: "in", e: l, list, not };
      } else if (this.eatKw("BETWEEN")) {
        const lo = this.add();
        this.kw("AND");
        l = { k: "between", e: l, lo, hi: this.add(), not };
      } else if (this.eatKw("LIKE")) l = { k: "like", e: l, pat: this.add(), not };
      else if (not) this.fail();
      else return l;
    }
  }
  private add(): Expr {
    let l = this.mul();
    while (this.isOp("+") || this.isOp("-")) l = { k: "bin", op: this.next().v, l, r: this.mul() };
    return l;
  }
  private mul(): Expr {
    let l = this.concat();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) l = { k: "bin", op: this.next().v, l, r: this.concat() };
    return l;
  }
  private concat(): Expr {
    let l = this.unary();
    while (this.eatOp("||")) l = { k: "bin", op: "||", l, r: this.unary() };
    return l;
  }
  private unary(): Expr {
    if (this.eatOp("-")) return { k: "neg", e: this.unary() };
    if (this.eatOp("+")) return this.unary();
    return this.primary();
  }
  private primary(): Expr {
    const t = this.peek();
    if (t.t === "num") {
      this.i++;
      return { k: "lit", v: Number(t.v) };
    }
    if (t.t === "str") {
      this.i++;
      return { k: "lit", v: t.v };
    }
    if (this.eatKw("NULL")) return { k: "lit", v: null };
    if (this.eatOp("(")) {
      const e = this.expr();
      this.op(")");
      return e;
    }
    const name = this.ident();
    if (this.eatOp("(")) {
      const f: Expr = { k: "fn", name: name.toLowerCase(), args: [], star: false, distinct: false };
      if (this.eatOp("*")) f.star = true;
      else if (!this.isOp(")")) {
        f.distinct = this.eatKw("DISTINCT");
        do f.args.push(this.expr());
        while (this.eatOp(","));
      }
      this.op(")");
      return f;
    }
    if (this.eatOp(".")) return { k: "col", table: name.toLowerCase(), name: this.ident().toLowerCase() };
    return { k: "col", table: null, name: name.toLowerCase() };
  }
}

// ---------- values ----------
const rank = (v: Value) => (v === null ? 0 : typeof v === "number" ? 1 : 2);
export function compare(a: Value, b: Value): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  if (ra === 1) return (a as number) - (b as number);
  return a! < b! ? -1 : a! > b! ? 1 : 0;
}
function toNum(v: Value): number {
  if (typeof v === "number") return v;
  const m = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(String(v));
  return m ? Number(m[0]) : 0;
}
const toText = (v: Value) => (v === null ? null : String(v));
function truthy(v: Value): boolean {
  if (v === null) return false;
  return toNum(v) !== 0;
}
const bool = (b: boolean): number => (b ? 1 : 0);
const likeCache = new Map<string, RegExp>();
function like(s: string, pat: string): boolean {
  let re = likeCache.get(pat);
  if (!re) {
    re = new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, "[\\s\\S]*").replace(/_/g, "[\\s\\S]")}$`, "i");
    likeCache.set(pat, re);
  }
  return re.test(s);
}

// ---------- evaluation ----------
interface Table {
  name: string;
  cols: string[]; // lower-case
  decl: string[]; // as declared
  rows: Value[][];
}
interface Src {
  name: string;
  alias: string;
  table: Table;
}
type Row = (Value[] | null)[];

function hasAgg(e: Expr): boolean {
  switch (e.k) {
    case "fn":
      return (AGGREGATES.has(e.name) && (e.star || e.args.length === 1)) || e.args.some(hasAgg);
    case "neg":
    case "not":
    case "isnull":
      return hasAgg(e.e);
    case "bin":
      return hasAgg(e.l) || hasAgg(e.r);
    case "in":
      return hasAgg(e.e) || e.list.some(hasAgg);
    case "between":
      return hasAgg(e.e) || hasAgg(e.lo) || hasAgg(e.hi);
    case "like":
      return hasAgg(e.e) || hasAgg(e.pat);
    default:
      return false;
  }
}

class Evaluator {
  private cache = new Map<Expr, [number, number]>();
  constructor(private srcs: Src[]) {}

  resolve(e: Extract<Expr, { k: "col" }>): [number, number] {
    const hit = this.cache.get(e);
    if (hit) return hit;
    let found: [number, number] | null = null;
    this.srcs.forEach((s, si) => {
      if (e.table && e.table !== s.alias.toLowerCase() && e.table !== s.name.toLowerCase()) return;
      const ci = s.table.cols.indexOf(e.name);
      if (ci < 0) return;
      if (found) throw new Error(`ambiguous column name: ${e.name}`);
      found = [si, ci];
    });
    if (!found) throw new Error(`no such column: ${e.table ? `${e.table}.` : ""}${e.name}`);
    this.cache.set(e, found);
    return found;
  }

  // Resolve every column up front, so a bad name fails even when no row is evaluated.
  check(e: Expr): void {
    switch (e.k) {
      case "col":
        this.resolve(e);
        return;
      case "fn":
        e.args.forEach((a) => this.check(a));
        return;
      case "neg":
      case "not":
      case "isnull":
        return this.check(e.e);
      case "bin":
        this.check(e.l);
        return this.check(e.r);
      case "in":
        this.check(e.e);
        return e.list.forEach((x) => this.check(x));
      case "between":
        this.check(e.e);
        this.check(e.lo);
        return this.check(e.hi);
      case "like":
        this.check(e.e);
        return this.check(e.pat);
    }
  }

  ev(e: Expr, row: Row, group: Row[] | null): Value {
    switch (e.k) {
      case "lit":
        return e.v;
      case "col": {
        const [si, ci] = this.resolve(e);
        return row[si]?.[ci] ?? null;
      }
      case "neg": {
        const v = this.ev(e.e, row, group);
        return v === null ? null : -toNum(v);
      }
      case "not": {
        const v = this.ev(e.e, row, group);
        return v === null ? null : bool(!truthy(v));
      }
      case "isnull":
        return bool((this.ev(e.e, row, group) === null) !== e.not);
      case "bin":
        return this.bin(e.op, e.l, e.r, row, group);
      case "in": {
        const v = this.ev(e.e, row, group);
        if (v === null) return null;
        let sawNull = false;
        for (const x of e.list) {
          const w = this.ev(x, row, group);
          if (w === null) sawNull = true;
          else if (compare(v, w) === 0) return bool(!e.not);
        }
        return sawNull ? null : bool(e.not);
      }
      case "between": {
        const v = this.ev(e.e, row, group);
        const lo = this.ev(e.lo, row, group);
        const hi = this.ev(e.hi, row, group);
        const a = v === null || lo === null ? null : compare(v, lo) >= 0;
        const b = v === null || hi === null ? null : compare(v, hi) <= 0;
        const r = a === false || b === false ? false : a === null || b === null ? null : true;
        return r === null ? null : bool(r !== e.not);
      }
      case "like": {
        const v = this.ev(e.e, row, group);
        const p = this.ev(e.pat, row, group);
        if (v === null || p === null) return null;
        return bool(like(String(v), String(p)) !== e.not);
      }
      case "fn":
        return AGGREGATES.has(e.name) && (e.star || e.args.length === 1) ? this.agg(e, group) : this.scalar(e, row, group);
    }
  }

  private bin(op: string, le: Expr, re: Expr, row: Row, group: Row[] | null): Value {
    if (op === "AND" || op === "OR") {
      const l = this.ev(le, row, group);
      const lt = l === null ? null : truthy(l);
      if (op === "AND" && lt === false) return 0;
      if (op === "OR" && lt === true) return 1;
      const r = this.ev(re, row, group);
      const rt = r === null ? null : truthy(r);
      if (op === "AND") return rt === false ? 0 : lt === null || rt === null ? null : 1;
      return rt === true ? 1 : lt === null || rt === null ? null : 0;
    }
    const l = this.ev(le, row, group);
    const r = this.ev(re, row, group);
    if (l === null || r === null) return null;
    switch (op) {
      case "=":
        return bool(compare(l, r) === 0);
      case "!=":
        return bool(compare(l, r) !== 0);
      case "<":
        return bool(compare(l, r) < 0);
      case "<=":
        return bool(compare(l, r) <= 0);
      case ">":
        return bool(compare(l, r) > 0);
      case ">=":
        return bool(compare(l, r) >= 0);
      case "||":
        return String(l) + String(r);
    }
    const a = toNum(l);
    const b = toNum(r);
    switch (op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        if (b === 0) return null;
        return Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b;
      case "%": {
        const x = Math.trunc(a);
        const y = Math.trunc(b);
        return y === 0 ? null : x % y;
      }
    }
    throw new Error(`syntax error: unknown operator ${op}`);
  }

  private scalar(e: Extract<Expr, { k: "fn" }>, row: Row, group: Row[] | null): Value {
    const args = e.args.map((a) => this.ev(a, row, group));
    const a = args[0] ?? null;
    switch (e.name) {
      case "lower":
        return a === null ? null : String(a).toLowerCase();
      case "upper":
        return a === null ? null : String(a).toUpperCase();
      case "length":
        return a === null ? null : String(a).length;
      case "abs":
        return a === null ? null : Math.abs(toNum(a));
      case "coalesce":
        return args.find((x) => x !== null) ?? null;
      case "round": {
        if (a === null) return null;
        const f = 10 ** Math.trunc(toNum(args[1] ?? 0));
        const n = toNum(a);
        return (Math.sign(n) * Math.round(Math.abs(n) * f)) / f;
      }
    }
    throw new Error(`no such function: ${e.name}`);
  }

  private agg(e: Extract<Expr, { k: "fn" }>, group: Row[] | null): Value {
    if (!group) throw new Error(`misuse of aggregate function ${e.name}()`);
    if (e.star) return group.length;
    let vals = group.map((r) => this.ev(e.args[0]!, r, null)).filter((v): v is number | string => v !== null);
    if (e.distinct) {
      const seen = new Set<string>();
      vals = vals.filter((v) => {
        const k = JSON.stringify(v);
        return seen.has(k) ? false : (seen.add(k), true);
      });
    }
    switch (e.name) {
      case "count":
        return vals.length;
      case "sum":
        return vals.length ? vals.reduce((s: number, v) => s + toNum(v), 0) : null;
      case "avg":
        return vals.length ? vals.reduce((s: number, v) => s + toNum(v), 0) / vals.length : null;
      case "min":
        return vals.length ? vals.reduce((m, v) => (compare(v, m) < 0 ? v : m)) : null;
      case "max":
        return vals.length ? vals.reduce((m, v) => (compare(v, m) > 0 ? v : m)) : null;
    }
    return null;
  }
}

// ---------- database ----------
export class Database {
  private tables = new Map<string, Table>();

  exec(sql: string): Result {
    const p = new Parser(sql, lex(sql));
    let result: Result = { columns: [], rows: [], changes: 0 };
    while (!p.atEnd()) result = this.run(p.statement());
    return result;
  }

  private table(name: string): Table {
    const t = this.tables.get(name.toLowerCase());
    if (!t) throw new Error(`no such table: ${name}`);
    return t;
  }

  private run(s: Stmt): Result {
    switch (s.k) {
      case "select":
        return this.select(s);
      case "create": {
        const key = s.table.toLowerCase();
        if (this.tables.has(key)) throw new Error(`table ${s.table} already exists`);
        this.tables.set(key, { name: s.table, cols: s.cols.map((c) => c.toLowerCase()), decl: s.cols, rows: [] });
        return { columns: [], rows: [], changes: 0 };
      }
      case "drop":
        this.table(s.table);
        this.tables.delete(s.table.toLowerCase());
        return { columns: [], rows: [], changes: 0 };
      case "insert": {
        const t = this.table(s.table);
        const idx = (s.cols ?? t.decl).map((c) => {
          const i = t.cols.indexOf(c.toLowerCase());
          if (i < 0) throw new Error(`table ${t.name} has no column named ${c} (no such column)`);
          return i;
        });
        const ev = new Evaluator([]);
        const rows = s.rows.map((r) => {
          if (r.length !== idx.length) throw new Error(`${r.length} values for ${idx.length} columns`);
          const row: Value[] = t.cols.map(() => null);
          r.forEach((e, i) => (row[idx[i]!] = ev.ev(e, [], null)));
          return row;
        });
        t.rows.push(...rows);
        return { columns: [], rows: [], changes: rows.length };
      }
      case "update": {
        const t = this.table(s.table);
        const ev = new Evaluator([{ name: t.name, alias: t.name, table: t }]);
        const sets = s.sets.map((x) => {
          const i = t.cols.indexOf(x.col.toLowerCase());
          if (i < 0) throw new Error(`no such column: ${x.col}`);
          ev.check(x.e);
          return { i, e: x.e };
        });
        if (s.where) ev.check(s.where);
        let changes = 0;
        t.rows = t.rows.map((r) => {
          if (s.where && !truthy(ev.ev(s.where, [r], null))) return r;
          changes++;
          const next = [...r];
          for (const x of sets) next[x.i] = ev.ev(x.e, [r], null);
          return next;
        });
        return { columns: [], rows: [], changes };
      }
      case "delete": {
        const t = this.table(s.table);
        const ev = new Evaluator([{ name: t.name, alias: t.name, table: t }]);
        if (s.where) ev.check(s.where);
        const before = t.rows.length;
        t.rows = s.where ? t.rows.filter((r) => !truthy(ev.ev(s.where!, [r], null))) : [];
        return { columns: [], rows: [], changes: before - t.rows.length };
      }
    }
  }

  private select(s: Select): Result {
    const srcs: Src[] = [];
    if (s.from) srcs.push({ name: s.from.table, alias: s.from.alias, table: this.table(s.from.table) });
    for (const j of s.joins) srcs.push({ name: j.table, alias: j.alias, table: this.table(j.table) });
    const ev = new Evaluator(srcs);

    // Output items: stars expand to the declared columns of every (or the named) table.
    const out: { e: Expr; name: string }[] = [];
    for (const it of s.items) {
      if (it.k === "expr") {
        const e = it.e;
        const name = it.name ?? (e.k === "col" ? (([si, ci]) => srcs[si]!.table.decl[ci]!)(ev.resolve(e)) : "");
        out.push({ e, name });
        continue;
      }
      const picked = srcs.filter((x) => !it.table || x.alias.toLowerCase() === it.table.toLowerCase() || x.name.toLowerCase() === it.table.toLowerCase());
      if (!picked.length) throw new Error(it.table ? `no such table: ${it.table}` : "no tables specified");
      for (const x of picked) x.table.decl.forEach((d, i) => out.push({ e: { k: "col", table: x.alias.toLowerCase(), name: x.table.cols[i]! }, name: d }));
    }
    const aliasIndex = (e: Expr) => (e.k === "col" && !e.table ? out.findIndex((o) => o.name.toLowerCase() === e.name) : -1);
    const position = (e: Expr) => (e.k === "lit" && typeof e.v === "number" && Number.isInteger(e.v) ? e.v : 0);
    out.forEach((o) => ev.check(o.e));
    s.joins.forEach((j) => ev.check(j.on));
    if (s.where) ev.check(s.where);
    s.groupBy.forEach((g) => ev.check(g));
    if (s.having) ev.check(s.having);
    for (const o of s.orderBy) {
      if (position(o.e)) {
        if (position(o.e) < 1 || position(o.e) > out.length) throw new Error("ORDER BY term out of range");
      } else if (aliasIndex(o.e) < 0) ev.check(o.e);
    }

    // FROM and JOINs: nested loops; LEFT JOIN pads unmatched left rows with NULL.
    let rows: Row[] = [[]];
    if (s.from) rows = srcs[0]!.table.rows.map((r) => [r]);
    s.joins.forEach((j, n) => {
      const right = srcs[n + 1]!.table.rows;
      const next: Row[] = [];
      for (const r of rows) {
        let matched = false;
        for (const rr of right) {
          const cand = [...r, rr];
          if (truthy(ev.ev(j.on, cand, null))) {
            next.push(cand);
            matched = true;
          }
        }
        if (!matched && j.left) next.push([...r, null]);
      }
      rows = next;
    });
    if (s.where) rows = rows.filter((r) => truthy(ev.ev(s.where!, r, null)));

    const grouped = s.groupBy.length > 0 || s.having !== null || out.some((o) => hasAgg(o.e)) || s.orderBy.some((o) => hasAgg(o.e));
    let entries: { row: Row; group: Row[] | null; vals: Value[] }[];
    if (grouped) {
      const groups = new Map<string, Row[]>();
      if (!s.groupBy.length) groups.set("", rows);
      for (const r of s.groupBy.length ? rows : []) {
        const key = JSON.stringify(s.groupBy.map((g) => ev.ev(g, r, null)));
        const g = groups.get(key);
        if (g) g.push(r);
        else groups.set(key, [r]);
      }
      const empty: Row = srcs.map(() => null);
      entries = [...groups.values()].map((g) => ({ row: g[0] ?? empty, group: g, vals: [] }));
      if (s.having) entries = entries.filter((e) => truthy(ev.ev(s.having!, e.row, e.group)));
    } else entries = rows.map((r) => ({ row: r, group: null, vals: [] }));
    for (const e of entries) e.vals = out.map((o) => ev.ev(o.e, e.row, e.group));

    if (s.distinct) {
      const seen = new Set<string>();
      entries = entries.filter((e) => {
        const k = JSON.stringify(e.vals);
        return seen.has(k) ? false : (seen.add(k), true);
      });
    }
    if (s.orderBy.length) {
      const keyed = entries.map((e) => ({
        e,
        keys: s.orderBy.map((o) => {
          const pos = position(o.e);
          if (pos) return e.vals[pos - 1]!;
          const ai = aliasIndex(o.e);
          return ai >= 0 ? e.vals[ai]! : ev.ev(o.e, e.row, e.group);
        }),
      }));
      keyed.sort((a, b) => {
        for (let i = 0; i < s.orderBy.length; i++) {
          const c = compare(a.keys[i]!, b.keys[i]!);
          if (c) return s.orderBy[i]!.desc ? -c : c;
        }
        return 0;
      });
      entries = keyed.map((k) => k.e);
    }
    const none = new Evaluator([]);
    const offset = s.offset ? Math.max(0, toNum(none.ev(s.offset, [], null))) : 0;
    const limit = s.limit ? toNum(none.ev(s.limit, [], null)) : -1;
    entries = entries.slice(offset, limit < 0 ? undefined : offset + limit);
    return { columns: out.map((o) => o.name), rows: entries.map((e) => e.vals) };
  }
}
