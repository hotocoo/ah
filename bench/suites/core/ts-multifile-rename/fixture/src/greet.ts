import { getUserName, type User } from "./user.ts";

export const greet = (u: User) => `Hello, ${getUserName(u)}!`;
