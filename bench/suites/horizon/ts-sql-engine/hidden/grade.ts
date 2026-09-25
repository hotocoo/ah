// Hidden grader: every query runs on the candidate engine and on SQLite (bun:sqlite); rows,
// column names, change counts and errors must agree. Prints AH_SCORE passed total.
import { Database as Sqlite } from "bun:sqlite";

type Value = number | string | null;
type Result = { columns: string[]; rows: Value[][]; changes?: number };
interface Engine {
  exec(sql: string): Result;
}

let passed = 0;
let total = 0;
const fail = (name: string, detail: string) => console.log(`FAIL ${name}: ${detail.slice(0, 400)}`);
function check(name: string, fn: () => void) {
  total++;
  try {
    fn();
    passed++;
  } catch (err) {
    fail(name, (err as Error).message ?? String(err));
  }
}
function finish(): never {
  console.log(`AH_SCORE ${passed} ${total}`);
  process.exit(passed === total ? 0 : 1);
}

let Ctor: new () => Engine;
try {
  Ctor = (await import(`${process.cwd()}/src/db.ts`)).Database;
  if (typeof Ctor !== "function") throw new Error("src/db.ts does not export class Database");
} catch (err) {
  fail("import", (err as Error).message);
  total = 1;
  finish();
}

const same = (a: Value, b: Value) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
const show = (x: unknown) => JSON.stringify(x);
function sameRows(got: Value[][], want: Value[][], ordered: boolean) {
  if (!Array.isArray(got)) throw new Error(`rows is not an array: ${show(got)}`);
  const norm = (rs: Value[][]) => (ordered ? rs : [...rs].sort((x, y) => (show(x) < show(y) ? -1 : show(x) > show(y) ? 1 : 0)));
  const g = norm(got);
  const w = norm(want);
  const ok = g.length === w.length && g.every((r, i) => Array.isArray(r) && r.length === w[i]!.length && r.every((v, j) => same(v, w[i]![j]!)));
  if (!ok) throw new Error(`rows ${show(got)} expected ${show(want)}`);
}

const BASE = `
CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT);
INSERT INTO users VALUES (1, 'Ann', 31, 'Oslo'), (2, 'Bob', NULL, 'Rome'), (3, 'Cid', 25, 'Oslo'), (4, 'Dee', 42, NULL), (5, 'Eve', 25, 'Paris'), (6, 'fay', 19, 'Rome');
CREATE TABLE orders (id INTEGER, user_id INTEGER, amount INTEGER, item TEXT);
INSERT INTO orders VALUES (10, 1, 30, 'book'), (11, 1, 12, 'pen'), (12, 3, 99, 'lamp'), (13, 5, 5, 'pen'), (14, 5, NULL, 'gift'), (15, 9, 40, 'book');
`;

function fresh(): { db: Engine; ref: Sqlite } {
  const ref = new Sqlite(":memory:");
  ref.exec(BASE);
  const db = new Ctor();
  try {
    db.exec(BASE);
  } catch {
    // Multi-statement exec is itself a check (below); fall back so the rest can still be graded.
    for (const s of BASE.split(";").map((x) => x.trim()).filter(Boolean)) db.exec(s);
  }
  return { db, ref };
}

check("exec runs several statements", () => {
  const db = new Ctor();
  db.exec(BASE);
  const r = db.exec("SELECT count(*) FROM orders;");
  sameRows(r.rows, [[6]], true);
});

let shared: { db: Engine; ref: Sqlite } | null = null;
function q(sql: string, opts: { cols?: boolean } = {}) {
  check(sql, () => {
    const { db, ref } = (shared ??= fresh());
    const stmt = ref.query(sql);
    const want = stmt.values() as Value[][];
    const got = db.exec(sql);
    sameRows(got.rows, want, /order\s+by/i.test(sql));
    if (opts.cols && show(got.columns) !== show(stmt.columnNames)) throw new Error(`columns ${show(got.columns)} expected ${show(stmt.columnNames)}`);
  });
}

// projection, filtering, NULL logic
q("SELECT * FROM users ORDER BY id", { cols: true });
q("SELECT name, age FROM users WHERE age > 24 ORDER BY id");
q("SELECT name FROM users WHERE age IS NULL");
q("SELECT name, age + 1 AS next, age * 2 FROM users WHERE age IS NOT NULL ORDER BY id", { cols: true });
q("SELECT id FROM users WHERE city = 'Oslo' AND age < 30 OR name = 'Dee' ORDER BY id");
q("SELECT id FROM users WHERE NOT (age > 30) ORDER BY id");
q("SELECT id FROM users WHERE city IN ('Rome', 'Paris') ORDER BY id");
q("SELECT id FROM users WHERE city NOT IN ('Rome', NULL)");
q("SELECT id FROM users WHERE age BETWEEN 20 AND 31 ORDER BY id");
q("SELECT id FROM users WHERE age NOT BETWEEN 20 AND 31 ORDER BY id");
q("SELECT name FROM users WHERE name LIKE '%e' ORDER BY name");
q("SELECT name FROM users WHERE name LIKE 'F_Y'");
q("SELECT name FROM users WHERE age = NULL");
q("SELECT id FROM users WHERE age > 20 AND city IS NULL OR age IS NULL ORDER BY id");
q("select Name from USERS where ID = 3", { cols: true });
q("SELECT id FROM users -- a comment\n WHERE id < 3 ORDER BY id");
// expressions and functions
q("SELECT upper(name), lower(city), length(name) FROM users ORDER BY id", { cols: true });
q("SELECT name || '@' || city AS tag FROM users ORDER BY id", { cols: true });
q("SELECT 7 / 2, -7 / 2, 7 % 3, -7 % 3, 7 / 0, 1.5 * 2, 10 - 2 * 3, (10 - 2) * 3", { cols: true });
q("SELECT coalesce(age, -1), abs(-5), round(2.5), round(-2.5), round(3.14159, 2) FROM users WHERE id = 2");
q("SELECT 1 + 1, 'a' || 'b', NULL IS NULL, 3 > 2, 2 = NULL, 'it''s'", { cols: true });
q("SELECT id || name, id + 0.5 FROM users WHERE id <= 2 ORDER BY id");
// aggregates and grouping
q("SELECT count(*), count(age), sum(age), avg(age), min(age), max(age) FROM users", { cols: true });
q("SELECT city, count(*) AS n FROM users GROUP BY city ORDER BY city", { cols: true });
q("SELECT city, avg(age) FROM users GROUP BY city HAVING count(*) > 1 ORDER BY city");
q("SELECT city, count(*) FROM users GROUP BY city ORDER BY count(*) DESC, city");
q("SELECT count(DISTINCT city), count(DISTINCT age) FROM users");
q("SELECT count(*) FROM users WHERE age > 100");
q("SELECT sum(age), max(name) FROM users WHERE age > 100");
q("SELECT min(city), max(city) FROM users");
q("SELECT age, count(*) FROM users WHERE age IS NOT NULL GROUP BY age HAVING count(*) >= 1 ORDER BY age DESC LIMIT 3");
// ordering, distinct, limits
q("SELECT DISTINCT age FROM users ORDER BY age");
q("SELECT name FROM users ORDER BY age DESC, name");
q("SELECT name, age FROM users ORDER BY 2, 1");
q("SELECT name AS n FROM users ORDER BY n DESC LIMIT 2", { cols: true });
q("SELECT id FROM users ORDER BY id LIMIT 2 OFFSET 3");
// joins
q("SELECT u.name, o.item FROM users u JOIN orders o ON o.user_id = u.id ORDER BY o.id", { cols: true });
q("SELECT u.name, o.amount FROM users u LEFT JOIN orders o ON o.user_id = u.id ORDER BY u.id, o.id");
q("SELECT u.name, sum(o.amount) AS total, count(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id ORDER BY total DESC, u.name", { cols: true });
q("SELECT o.* FROM orders o WHERE o.amount > 20 ORDER BY o.id", { cols: true });
q("SELECT users.name, orders.item FROM orders INNER JOIN users ON users.id = orders.user_id WHERE orders.amount >= 12 ORDER BY orders.amount");

// writes: change counts and resulting state
function write(name: string, steps: string[], verify: string) {
  check(name, () => {
    const { db, ref } = fresh();
    for (const s of steps) {
      const want = ref.run(s).changes;
      const got = db.exec(s);
      if (got.changes !== want) throw new Error(`${s}: changes ${show(got.changes)} expected ${want}`);
    }
    sameRows(db.exec(verify).rows, ref.query(verify).values() as Value[][], true);
  });
}
write("update with where", ["UPDATE users SET age = age + 1 WHERE city = 'Oslo'"], "SELECT id, age FROM users ORDER BY id");
write("update sets several columns", ["UPDATE users SET age = 0, city = 'X' WHERE age IS NULL"], "SELECT * FROM users ORDER BY id");
write("update sees the old row", ["UPDATE users SET id = age, age = id WHERE id = 1"], "SELECT id, age FROM users ORDER BY id");
write("delete with where", ["DELETE FROM orders WHERE amount IS NULL OR amount < 10"], "SELECT id FROM orders ORDER BY id");
write("insert with columns and quotes", ["INSERT INTO orders (id, item) VALUES (20, 'x'), (21, 'it''s')"], "SELECT * FROM orders WHERE id >= 20 ORDER BY id");
write("delete everything", ["DELETE FROM users"], "SELECT count(*) FROM users");
check("drop table", () => {
  const { db } = fresh();
  const r = db.exec("DROP TABLE orders");
  if (r.changes !== 0) throw new Error(`changes ${show(r.changes)} expected 0`);
  let msg = "";
  try {
    db.exec("SELECT * FROM orders");
  } catch (err) {
    msg = (err as Error).message;
  }
  if (!/no such table/.test(msg)) throw new Error(`expected "no such table", got ${show(msg)}`);
});

// errors
function throws(sql: string, re: RegExp) {
  check(`error: ${sql}`, () => {
    const { db } = fresh();
    db.exec("CREATE TABLE empty_t (a INTEGER)");
    let msg: string | null = null;
    try {
      db.exec(sql);
    } catch (err) {
      msg = String((err as Error).message ?? err);
    }
    if (msg === null) throw new Error("did not throw");
    if (!re.test(msg)) throw new Error(`message ${show(msg)} does not match ${re}`);
  });
}
throws("SELECT * FROM nope", /no such table/);
throws("SELECT nope FROM users", /no such column/);
throws("SELECT missing FROM empty_t", /no such column/);
throws("CREATE TABLE users (x INTEGER)", /already exists/);
throws("SELECT FROM users", /syntax error/);
throws("SELECT * FROM users WHERE", /syntax error/);
throws("INSERT INTO users VALUES (1, 'x')", /values for/);
throws("SELECT id FROM users u JOIN orders o ON u.id = o.user_id", /ambiguous/);

// scale: 5,000 rows, each exec under 2 s, same answers
{
  const big = new Sqlite(":memory:");
  const eng = new Ctor();
  const rows = Array.from({ length: 5000 }, (_, i) => `(${i}, ${i % 37}, 's${(i * 7919) % 5000}')`).join(", ");
  const setup = ["CREATE TABLE nums (n INTEGER, g INTEGER, s TEXT)", `INSERT INTO nums VALUES ${rows}`, "CREATE TABLE groups (g INTEGER, label TEXT)", `INSERT INTO groups VALUES ${Array.from({ length: 37 }, (_, i) => `(${i}, 'g${i}')`).join(", ")}`];
  let ready = false;
  check("scale: insert 5,000 rows", () => {
    for (const s of setup) {
      big.run(s);
      const t0 = performance.now();
      eng.exec(s);
      const ms = performance.now() - t0;
      if (ms > 2000) throw new Error(`took ${Math.round(ms)} ms`);
    }
    ready = true;
  });
  const timed = (sql: string) =>
    check(`scale: ${sql}`, () => {
      if (!ready) throw new Error("setup failed");
      const t0 = performance.now();
      const got = eng.exec(sql);
      const ms = performance.now() - t0;
      if (ms > 2000) throw new Error(`took ${Math.round(ms)} ms`);
      sameRows(got.rows, big.query(sql).values() as Value[][], true);
    });
  timed("SELECT g, count(*), sum(n) FROM nums WHERE n % 3 = 0 GROUP BY g ORDER BY g");
  timed("SELECT n, s FROM nums ORDER BY s DESC, n LIMIT 5");
  timed("SELECT label, count(*) FROM nums JOIN groups ON nums.g = groups.g WHERE n > 2500 GROUP BY label ORDER BY label");
}

finish();
