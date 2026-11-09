export type SyncDatabaseValue = string | number | boolean | null | Uint8Array;

export type SyncStatement = {
  all(...params: SyncDatabaseValue[]): unknown[];
  get(...params: SyncDatabaseValue[]): unknown;
  run(...params: SyncDatabaseValue[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
};

export type SyncDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SyncStatement;
};
