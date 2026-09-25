import { expect, test } from "bun:test";
import { Database } from "./src/db.ts";

test("create, insert, select", () => {
  const db = new Database();
  db.exec("CREATE TABLE users (id INTEGER, name TEXT, age INTEGER)");
  db.exec("INSERT INTO users VALUES (1, 'Ann', 31), (2, 'Bob', NULL)");
  expect(db.exec("SELECT name, age + 1 AS next FROM users WHERE age IS NOT NULL")).toEqual({ columns: ["name", "next"], rows: [["Ann", 32]] });
});
