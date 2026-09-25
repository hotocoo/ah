# In-memory SQL engine

Implement `Database` in `src/db.ts`: a small SQL database that keeps tables in memory. It must give the same answers as SQLite for the subset below. Use any number of files under `src/`; no dependencies (Bun's built-in `bun:sqlite` must not be used by the engine).

```ts
import { Database } from "./src/db.ts";
const db = new Database();
db.exec("CREATE TABLE users (id INTEGER, name TEXT, age INTEGER)");
db.exec("INSERT INTO users VALUES (1, 'Ann', 31), (2, 'Bob', NULL)");
db.exec("SELECT name, age + 1 AS next FROM users WHERE age IS NOT NULL");
// => { columns: ["name", "next"], rows: [["Ann", 32]] }
```

## API

`exec(sql: string): { columns: string[]; rows: unknown[][]; changes?: number }`

- `sql` may hold several statements separated by `;` (a trailing `;` is allowed). `exec` returns the result of the last one.
- `SELECT` returns the output column names and the rows (arrays of values, in column order).
- `INSERT`, `UPDATE`, `DELETE` return `columns: []`, `rows: []` and `changes`: the number of rows inserted, updated or deleted. `CREATE TABLE` and `DROP TABLE` return `changes: 0`.
- Errors throw an `Error`. The message must contain `no such table` for an unknown table, `no such column` for an unknown column, `already exists` when creating an existing table, `syntax error` for input that does not parse, and `values for` when an `INSERT` row has the wrong number of values (for example `3 values for 2 columns`).

## Values

Values are JavaScript `number`s, `string`s and `null`. Column types (`INTEGER`, `TEXT`, `REAL`) are accepted and stored but values are kept as given. Keywords, table and column names are case-insensitive. String literals use single quotes; `''` inside a string is a quote.

## Statements

- `CREATE TABLE name (col TYPE, ...)`, `DROP TABLE name`
- `INSERT INTO name [(col, ...)] VALUES (expr, ...), (expr, ...)`. Columns not listed are `NULL`.
- `UPDATE name SET col = expr, ... [WHERE expr]`. Every `SET` expression sees the row as it was before the update.
- `DELETE FROM name [WHERE expr]`
- `SELECT [DISTINCT] item, ... [FROM table [alias] [[INNER | LEFT] JOIN table [alias] ON expr]...] [WHERE expr] [GROUP BY expr, ...] [HAVING expr] [ORDER BY expr [ASC | DESC], ...] [LIMIT n [OFFSET m]]`
  - An item is `*`, `table.*` or `expr [AS alias]`. `FROM` is optional (`SELECT 1 + 1`).
  - Output column names: the alias if given; for a column reference, the column's name as declared in `CREATE TABLE` (`SELECT u.NAME` → `name` when the table declared `name`); for `*`, the table's declared names; otherwise the expression's text exactly as written in the query (`SELECT a+1` → `a+1`, `count(*)` → `count(*)`).
  - A column reference is `col` or `table.col` / `alias.col`. An unqualified name that exists in more than one joined table is an error (`ambiguous column`).
  - `LEFT JOIN` keeps left rows without a match, with `NULL` for the right table's columns.
  - `ORDER BY` terms may be expressions, output aliases or 1-based column positions. Rows compare as SQLite does: `NULL` first, then numbers (numerically), then strings (binary); `DESC` reverses. Rows that tie keep no particular order.
  - With `GROUP BY` or an aggregate anywhere in the select list, `HAVING` or `ORDER BY`, rows are grouped (one group for the whole input when there is no `GROUP BY`, even when it is empty). A non-aggregate column in a grouped query takes its value from some row of the group.

## Expressions

- Literals: integers, decimals, strings, `NULL`.
- Arithmetic `+ - * / %`, unary `-`. `/` and `%` of two integers are integer operations truncating toward zero; division or modulo by zero is `NULL`.
- `||` concatenates (numbers print as they would in SQLite: `1 || 'a'` → `1a`).
- Comparisons `= == != <> < <= > >=` give `1`, `0` or `NULL`; `AND`, `OR`, `NOT` use SQL three-valued logic; `WHERE`/`ON`/`HAVING` keep a row only when the condition is a non-zero number.
- `x IS NULL`, `x IS NOT NULL`, `x [NOT] IN (a, b, ...)`, `x [NOT] BETWEEN a AND b`, `x [NOT] LIKE pattern` (`%` any run, `_` one character, ASCII case-insensitive).
- Any operator with a `NULL` operand gives `NULL`, except `AND`/`OR` (three-valued) and `IS [NOT] NULL`. `x IN (...)` is `NULL` when `x` is `NULL`, or when there is no match and the list holds a `NULL`.
- Scalar functions: `lower`, `upper`, `length`, `abs`, `coalesce(a, b, ...)`, `round(x)`, `round(x, digits)`.
- Aggregates: `count(*)`, `count(expr)`, `sum`, `avg`, `min`, `max`. They skip `NULL`s; `sum`/`avg`/`min`/`max` of no values are `NULL`, `count` of no values is `0`. `avg` is the plain mean. `count(DISTINCT expr)` counts distinct non-null values.

Precedence, lowest first: `OR`; `AND`; `NOT`; comparisons, `IS`, `IN`, `BETWEEN`, `LIKE`; `+ -`; `* / %`; `||`; unary `-`.

Tables in the tests hold up to 5,000 rows; any single `exec` must finish within 2 seconds.
