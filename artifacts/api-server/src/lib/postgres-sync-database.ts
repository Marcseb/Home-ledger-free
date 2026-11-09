import { Worker } from "node:worker_threads";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SyncDatabase,
  SyncDatabaseValue,
  SyncStatement,
} from "./sync-database.ts";
// @ts-ignore Node's strip-types scripts use explicit TypeScript extensions.
import { translateLedgerSql } from "./postgres-sql.ts";

const RESPONSE_CAPACITY = 16 * 1024 * 1024;
const HEADER_BYTES = 8;
const WAIT_TIMEOUT_MS = 60_000;

type QueryResponse = {
  rows?: unknown[];
  rowCount?: number;
  error?: { message?: string; code?: string };
};

export class PostgresSyncDatabase implements SyncDatabase {
  private readonly sharedBuffer = new SharedArrayBuffer(HEADER_BYTES + RESPONSE_CAPACITY);
  private readonly control = new Int32Array(this.sharedBuffer, 0, 2);
  private readonly worker: Worker;

  constructor(connectionString: string, schema: string) {
    if (!connectionString) throw new Error("DATABASE_URL must be set for the reviewer demo");
    if (!/^home_ledger_review_demo(?:_test_[a-z0-9_]+)?$/.test(schema)) {
      throw new Error("Reviewer PostgreSQL must use its isolated review schema");
    }

    const workerPath = join(dirname(fileURLToPath(import.meta.url)), "postgres-sync-worker.mjs");
    this.worker = new Worker(workerPath, {
      workerData: { connectionString, schema, sharedBuffer: this.sharedBuffer },
    });
    this.worker.unref();

    const started = Atomics.wait(this.control, 0, 0, WAIT_TIMEOUT_MS);
    if (started === "timed-out") {
      this.worker.terminate();
      throw new Error("Timed out connecting to the reviewer PostgreSQL database");
    }
    const response = this.readResponse();
    if (Atomics.load(this.control, 0) !== 1 || !(response as { ready?: boolean }).ready) {
      this.worker.terminate();
      throw new Error((response as QueryResponse).error?.message ?? "Could not connect to reviewer PostgreSQL");
    }
    Atomics.store(this.control, 0, 0);
  }

  exec(sql: string) {
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
      const translated = translateLedgerSql(statement);
      if (translated) this.query(translated, []);
    }
  }

  prepare(sql: string): SyncStatement {
    const translated = translateLedgerSql(sql);
    return {
      all: (...params: SyncDatabaseValue[]) => {
        if (!translated) return [];
        return this.query(translated, params).rows ?? [];
      },
      get: (...params: SyncDatabaseValue[]) => {
        if (!translated) return undefined;
        return this.query(translated, params).rows?.[0];
      },
      run: (...params: SyncDatabaseValue[]) => {
        if (!translated) return { changes: 0, lastInsertRowid: 0 };
        const result = this.query(translated, params);
        const row = result.rows?.[0] as { sequence?: number } | undefined;
        return {
          changes: result.rowCount ?? 0,
          lastInsertRowid: row?.sequence ?? 0,
        };
      },
    };
  }

  private query(sql: string, params: SyncDatabaseValue[]): QueryResponse {
    Atomics.store(this.control, 0, 0);
    Atomics.store(this.control, 1, 0);
    this.worker.postMessage({ sql, params });
    const waited = Atomics.wait(this.control, 0, 0, WAIT_TIMEOUT_MS);
    if (waited === "timed-out") {
      void this.worker.terminate();
      throw new Error("Timed out waiting for reviewer PostgreSQL; restart the review service");
    }
    const response = this.readResponse() as QueryResponse;
    if (Atomics.load(this.control, 0) !== 1) {
      const error = new Error(response.error?.message ?? "Reviewer PostgreSQL query failed");
      if (response.error?.code) Object.assign(error, { code: response.error.code });
      throw error;
    }
    return response;
  }

  private readResponse() {
    const length = Atomics.load(this.control, 1);
    if (length < 0 || length > RESPONSE_CAPACITY) throw new Error("Invalid reviewer PostgreSQL response");
    const bytes = new Uint8Array(this.sharedBuffer, HEADER_BYTES, length);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
}
