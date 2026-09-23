import { expect, test } from "bun:test";
import { paginate } from "../src/paginate.ts";
const xs = Array.from({ length: 10 }, (_, i) => i);
test("page 1 starts at the first item", () => expect(paginate(xs, 1, 3).items).toEqual([0, 1, 2]));
test("last partial page", () => expect(paginate(xs, 4, 3).items).toEqual([9]));
test("total pages", () => expect(paginate(xs, 1, 3).totalPages).toBe(4));
test("empty input has one page", () => expect(paginate([], 1, 5)).toEqual({ items: [], page: 1, totalPages: 1 }));
