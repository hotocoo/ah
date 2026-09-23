import { expect, test } from "bun:test";
import { getUserName } from "../src/user.ts";
import { greet } from "../src/greet.ts";
import { report } from "../src/report.ts";

test("nick wins", () => expect(getUserName({ first: "A", last: "B", nick: "ab" })).toBe("ab"));
test("greet", () => expect(greet({ first: "Ada", last: "L" })).toBe("Hello, Ada L!"));
test("report", () => expect(report([{ first: "a", last: "b" }])).toBe("1. a b"));
