// In-memory SQL engine. See SPEC.md.
export type Value = number | string | null;

export interface Result {
  columns: string[];
  rows: Value[][];
  changes?: number;
}

export class Database {
  exec(sql: string): Result {
    throw new Error(`not implemented: ${sql}`);
  }
}
