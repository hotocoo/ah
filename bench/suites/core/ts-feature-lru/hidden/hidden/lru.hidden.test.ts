import { expect, test } from "bun:test";
import { LRUCache } from "../src/lru.ts";
test("evicts least recently used", () => {
  const c = new LRUCache<string, number>(2);
  c.set("a", 1); c.set("b", 2); c.get("a"); c.set("c", 3);
  expect(c.has("b")).toBe(false); expect(c.keys()).toEqual(["a", "c"]);
});
test("has does not touch recency", () => {
  const c = new LRUCache<string, number>(2);
  c.set("a", 1); c.set("b", 2); c.has("a"); c.set("c", 3);
  expect(c.has("a")).toBe(false);
});
test("update moves to most recent", () => {
  const c = new LRUCache<string, number>(2);
  c.set("a", 1); c.set("b", 2); c.set("a", 9); c.set("c", 3);
  expect(c.get("a")).toBe(9); expect(c.has("b")).toBe(false); expect(c.size).toBe(2);
});
test("onEvict", () => {
  const ev: [string, number][] = [];
  const c = new LRUCache<string, number>(1, (k, v) => ev.push([k, v]));
  c.set("a", 1); c.set("b", 2);
  expect(ev).toEqual([["a", 1]]);
});
test("delete and capacity check", () => {
  const c = new LRUCache<string, number>(3);
  c.set("x", 1);
  expect(c.delete("x")).toBe(true); expect(c.delete("x")).toBe(false); expect(c.get("x")).toBeUndefined();
  expect(() => new LRUCache(0)).toThrow(RangeError);
});
