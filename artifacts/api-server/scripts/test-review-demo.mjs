import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { translateLedgerSql } from "../src/lib/postgres-sql.ts";

if (process.env.NODE_ENV === "production") throw new Error("Run this test against development only");
assert.equal(translateLedgerSql("SELECT '?' note WHERE id=?"), "SELECT '?' note WHERE id=$1");
assert.equal(translateLedgerSql("SELECT id FROM categories WHERE name=? COLLATE NOCASE"),
  "SELECT id FROM categories WHERE LOWER(name) = LOWER($1)");
assert.match(translateLedgerSql("INSERT INTO sync_events(group_id) VALUES(?)"), /RETURNING sequence$/);
assert.match(translateLedgerSql("BEGIN IMMEDIATE"), /^BEGIN; SELECT pg_advisory_xact_lock/);

const schema = `home_ledger_review_demo_test_${randomBytes(5).toString("hex")}`;
const code = randomBytes(10).toString("hex").toUpperCase();
const directory = await mkdtemp(join(tmpdir(), "home-ledger-review-test-"));
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
await database.connect();
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
let child;
let output = "";

async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}

async function start(extraEnv = {}) {
  child = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: "production", APP_VARIANT: "review-demo", PORT: String(port),
      REVIEWER_DEMO_ACCESS_CODE: code, HOME_LEDGER_REVIEW_SCHEMA: schema,
      BUDGET_DB_PATH: join(directory, "must-not-exist.sqlite"),
      XDG_CONFIG_HOME: join(directory, "config"),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Review service exited: ${output.slice(-5000)}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Review service did not become ready: ${output.slice(-5000)}`);
}

async function request(path, method = "GET", body, token) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "x-device-token": token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  await database.query(`CREATE SCHEMA ${schema}`);
  const tables = await database.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='home_ledger_review_demo' AND table_type='BASE TABLE'",
  );
  assert.equal(tables.rows.length, 20, "Provision the development review schema, including budget items and payer-attribution metadata, first");
  for (const { table_name: name } of tables.rows) {
    assert.match(name, /^[a-z_]+$/);
    await database.query(`CREATE TABLE ${schema}.${name} (LIKE home_ledger_review_demo.${name} INCLUDING ALL)`);
  }
  await database.query(`CREATE SEQUENCE ${schema}.test_sync_sequence`);
  await database.query(`ALTER TABLE ${schema}.sync_events ALTER COLUMN sequence SET DEFAULT nextval('${schema}.test_sync_sequence')`);
  await start();

  assert.equal((await request("/healthz")).body.storage, "postgresql");
  assert.equal((await request("/bootstrap")).status, 401);
  assert.equal((await request("/demo/reset", "POST", {})).status, 404);
  const invalid = await request("/pairing/invitations/redeem", "POST", {
    invitationCode: "0".repeat(20), deviceId: randomUUID(), deviceName: "Invalid",
  });
  assert.equal(invalid.status, 400);
  const pair = async (name) => {
    const result = await request("/pairing/invitations/redeem", "POST", {
      invitationCode: code, deviceId: randomUUID(), deviceName: name,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const first = await pair("Free reviewer device");
  const second = await pair("Full reviewer device");
  assert.notEqual(first.deviceToken, second.deviceToken);
  assert.equal(first.state.groupId, second.state.groupId);
  assert.equal(first.state.acceleratedTest, false);
  assert.equal(first.state.transactions.length, 3);
  const identity = (await request("/ping")).body.id;
  assert.equal((await request("/ping")).body.variant, "production");
  const dashboard = await request("/dashboard", "GET", undefined, first.deviceToken);
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
  const backup = await request("/backups/status", "GET", undefined, first.deviceToken);
  assert.equal(backup.body.reviewDemo, true);
  assert.equal(backup.body.lastSuccessfulAt, null);
  assert.equal((await request("/backups/export", "POST", {}, first.deviceToken)).status, 409);
  const shared = first.state.accounts.find((account) => account.kind === "shared");
  const personal = first.state.accounts.find((account) =>
    account.kind === "personal" && account.ownerUserId === first.user.id);
  assert.ok(personal, "reviewer should have a personal account for payer attribution");
  const transaction = {
    id: randomUUID(), kind: "expense", accountId: shared.id, destinationAccountId: null,
    amountMinor: 1275, currency: "EUR", categoryId: "groceries", note: "Persisted demo purchase",
    occurredAt: new Date().toISOString(), createdByUserId: first.user.id,
    status: "posted", reversesTransactionId: null, allocationShares: [],
    personalPayerAccountId: personal.id,
  };
  const operation = {
    operationId: randomUUID(), deviceId: "review-test", clientCreatedAt: new Date().toISOString(),
    type: "transaction.create", payload: { transaction },
  };
  const synced = await request("/sync", "POST", { cursor: 0, operations: [operation] }, first.deviceToken);
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.acknowledgements[0].status, "applied", JSON.stringify(synced.body));
  assert.ok(synced.body.acknowledgements[0].serverSequence > 0);
  await request("/sync", "POST", { cursor: 0, operations: [operation] }, first.deviceToken);
  const other = await request("/bootstrap", "GET", undefined, second.deviceToken);
  assert.equal(other.body.transactions.filter((item) => item.id === transaction.id).length, 1);
  const otherTransaction = other.body.transactions.find((item) => item.id === transaction.id);
  assert.equal(otherTransaction.personalPayerAccountId,
    first.user.id === second.user.id ? personal.id : "hidden-personal-account");
  const correction = await request(`/transactions/${transaction.id}/correction`, "POST", {
    operationId: randomUUID(), amountMinor: 1500, categoryId: transaction.categoryId,
    occurredAt: transaction.occurredAt, note: "Corrected demo purchase",
  }, first.deviceToken);
  assert.equal(correction.status, 200, JSON.stringify(correction.body));
  const correctedTransaction = correction.body.transactions.find((item) => item.note === "Corrected demo purchase");
  assert.equal(correctedTransaction.personalPayerAccountId, personal.id,
    "correction should retain payer attribution");
  const category = await request("/categories", "POST",
    { name: "Test category", scope: "shared", color: "#E67E5F" }, first.deviceToken);
  assert.ok(category.status < 300, JSON.stringify(category.body));
  assert.equal((await request("/categories", "POST",
    { name: "test CATEGORY", scope: "shared", color: "#E67E5F" }, first.deviceToken)).status, 400);

  const beforeRestart = await request("/bootstrap", "GET", undefined, second.deviceToken);
  await stop();
  await start();
  const afterRestart = await request("/bootstrap", "GET", undefined, second.deviceToken);
  assert.equal(afterRestart.status, 200, JSON.stringify(afterRestart.body));
  assert.deepEqual(afterRestart.body.transactions, beforeRestart.body.transactions);
  assert.equal(afterRestart.body.serverSequence, beforeRestart.body.serverSequence);
  assert.equal((await request("/ping")).body.id, identity);
  assert.equal(existsSync(join(directory, "must-not-exist.sqlite")), false);
  for (let attempt = 0; attempt < 21; attempt++) {
    await request("/pairing/invitations/redeem", "POST", {
      invitationCode: "0".repeat(20), deviceId: randomUUID(), deviceName: "Invalid",
    });
  }
  assert.equal((await pairRateLimited()).status, 429);
  await stop();
  const resetEnvironment = { REVIEWER_DEMO_RESET_GENERATION: randomUUID() };
  await start(resetEnvironment);
  assert.equal((await request("/bootstrap", "GET", undefined, first.deviceToken)).status, 401);
  const resetDevice = await pair("Reviewer after operator reset");
  assert.equal(resetDevice.state.transactions.length, 3);
  assert.equal((await request("/ping")).body.id, identity);
  await stop();
  await start(resetEnvironment);
  assert.equal((await request("/bootstrap", "GET", undefined, resetDevice.deviceToken)).status, 200);
  console.log("PASS: reviewer authorization, isolated sessions, sync, idempotency, corrections, category matching, restart persistence, stable identity, disabled backup/public reset, operator-only reset generation, rate limit, no SQLite access");
} finally {
  await stop();
  await database.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await database.end();
  await rm(directory, { recursive: true, force: true });
}

function pairRateLimited() {
  return request("/pairing/invitations/redeem", "POST", {
    invitationCode: code, deviceId: randomUUID(), deviceName: "Rate limited",
  });
}
