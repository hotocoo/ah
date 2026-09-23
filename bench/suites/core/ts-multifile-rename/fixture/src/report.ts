import { getUserName, type User } from "./user.ts";

export function report(users: User[]): string {
  return users.map((u, i) => `${i + 1}. ${getUserName(u)}`).join("\n");
}
