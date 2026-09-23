export interface User {
  first: string;
  last: string;
  nick?: string;
}

export function getUserName(u: User): string {
  return u.nick ?? `${u.first} ${u.last}`;
}
