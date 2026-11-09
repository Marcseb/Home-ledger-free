import { DatabaseSync } from "node:sqlite";

type MemoryDatabase = DatabaseSync & {
  serialize(dbName?: string): Uint8Array;
  deserialize(bytes: Uint8Array): void;
};

function requireMemoryApis() {
  const prototype = DatabaseSync.prototype as Partial<MemoryDatabase>;
  if (typeof prototype.serialize !== "function" || typeof prototype.deserialize !== "function") {
    throw new Error("In-memory encrypted recovery requires Node.js 24.16 or newer with SQLite serialize/deserialize support; no plaintext disk fallback is permitted");
  }
}

function normalizeStandaloneImage(bytes: Uint8Array) {
  const signature = Buffer.from("SQLite format 3\0");
  if (bytes.length < 100 || !signature.equals(bytes.subarray(0, 16))
    || ![1, 2].includes(bytes[18]!) || ![1, 2].includes(bytes[19]!)) {
    throw new Error("SQLite snapshot has an invalid database header");
  }
  bytes[18] = 1;
  bytes[19] = 1;
}

export function openMemorySnapshot(bytes: Uint8Array) {
  requireMemoryApis();
  const db = new DatabaseSync(":memory:") as MemoryDatabase;
  try {
    db.deserialize(bytes);
    db.exec("PRAGMA temp_store=MEMORY;");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** A committed, transaction-consistent SQLite image. Caller must clear the bytes. */
export function snapshotDatabaseInMemory(path: string, maxBytes: number) {
  requireMemoryApis();
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 100) throw new Error("Invalid SQLite snapshot size limit");
  let db: MemoryDatabase | null = null;
  let bytes: Uint8Array | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true }) as MemoryDatabase;
    db.exec("PRAGMA query_only=ON; PRAGMA temp_store=MEMORY; BEGIN;");
    db.prepare("SELECT rootpage FROM sqlite_schema LIMIT 1").get();
    const pageSize = Number((db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size);
    const pageCount = Number((db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
    const expectedBytes = pageSize * pageCount;
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 100 || expectedBytes > maxBytes) {
      throw new Error("Household database exceeds in-memory archive size limit or is empty");
    }
    bytes = db.serialize();
    if (bytes.byteLength !== expectedBytes || bytes.byteLength > maxBytes) {
      throw new Error("SQLite snapshot size does not match the pinned transaction");
    }
    normalizeStandaloneImage(bytes);
    const check = openMemorySnapshot(bytes);
    try {
      const integrity = check.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
        throw new Error("SQLite snapshot integrity check failed");
      }
    } finally {
      check.close();
    }
    db.exec("COMMIT");
    const result = bytes;
    bytes = null;
    return result;
  } catch (error) {
    throw new Error(`In-memory database snapshot failed: ${error instanceof Error ? error.message : "SQLite read failed"}`, { cause: error });
  } finally {
    bytes?.fill(0);
    db?.close();
  }
}
