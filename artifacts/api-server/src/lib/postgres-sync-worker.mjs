import pg from "pg";
import { parentPort, workerData } from "node:worker_threads";

const { Client, types } = pg;
const sharedBuffer = workerData.sharedBuffer;
const control = new Int32Array(sharedBuffer, 0, 2);
const payload = new Uint8Array(sharedBuffer, 8);
const encoder = new TextEncoder();

types.setTypeParser(types.builtins.INT8, (value) => Number(value));
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

const client = new Client({
  connectionString: workerData.connectionString,
  options: `-c search_path=${workerData.schema}`,
  application_name: "home-ledger-review-demo",
});

function respond(value, status = 1) {
  const encoded = encoder.encode(JSON.stringify(value));
  if (encoded.byteLength > payload.byteLength) {
    const tooLarge = encoder.encode(JSON.stringify({
      error: {
        message: "PostgreSQL query result exceeded the review adapter response limit",
        code: "RESULT_TOO_LARGE",
      },
    }));
    payload.set(tooLarge.subarray(0, payload.byteLength));
    Atomics.store(control, 1, Math.min(tooLarge.byteLength, payload.byteLength));
    Atomics.store(control, 0, 2);
    Atomics.notify(control, 0);
    return;
  }
  payload.set(encoded);
  Atomics.store(control, 1, encoded.byteLength);
  Atomics.store(control, 0, status);
  Atomics.notify(control, 0);
}

try {
  await client.connect();
  respond({ ready: true }, 1);
} catch (error) {
  respond({ error: { message: error instanceof Error ? error.message : "PostgreSQL connection failed" } }, 2);
}

parentPort?.on("message", async ({ sql, params }) => {
  try {
    const result = await client.query(sql, params);
    const first = Array.isArray(result) ? result.at(-1) : result;
    respond({
      rows: first?.rows ?? [],
      rowCount: first?.rowCount ?? 0,
    });
  } catch (error) {
    respond({
      error: {
        message: error instanceof Error ? error.message : "PostgreSQL query failed",
        code: error && typeof error === "object" && "code" in error ? error.code : undefined,
      },
    }, 2);
  }
});

parentPort?.on("close", () => {
  void client.end();
});
