import { expect, test } from "bun:test";
import { total } from "../src/cart.ts";
import { format } from "../src/money.ts";

test("rounds tax half-up", () => {
  // 1999 * 0.0825 = 164.9175 -> 165
  expect(total([{ sku: "a", unit: 1999, qty: 1 }], 0.0825)).toBe(2164);
  expect(format(total([{ sku: "b", unit: 600, qty: 1 }], 0.0825))).toBe("$6.50");
});
