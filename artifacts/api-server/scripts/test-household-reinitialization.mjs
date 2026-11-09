import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHttpInvitationSession } from "./invitation-test-helpers.mjs";

const directory = await mkdtemp(join(tmpdir(), "home-ledger-reinitialize-"));
const dataPath = join(directory, "ledger.sqlite");
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));

const child = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: "production",
    APP_VARIANT: "",
    HOME: directory,
    XDG_DATA_HOME: directory,
    BUDGET_DB_PATH: dataPath,
    HOST: "127.0.0.1",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });
let db;
const base = `http://127.0.0.1:${port}/api`;

async function request(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { "x-device-token": token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const deadline = Date.now() + 10_000;
  while (true) {
    if (child.exitCode !== null) throw new Error(`Server exited:\n${logs}`);
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start:\n${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const setup = await request("/household/setup", {
    householdName: "Old home", displayName: "Master", currency: "USD", deviceId: "old-master", deviceName: "Master phone",
  });
  assert.equal(setup.status, 201);
  const oldToken = setup.body.deviceToken;
  const member = await createHttpInvitationSession(
    request, setup.body, { displayName: "Member" }, "old-member", "Member phone",
  );
  const pending = await request("/household/invitations", { displayName: "Pending" }, oldToken);
  assert.equal(pending.status, 201);

  db = new DatabaseSync(dataPath);
  const oldGroupId = db.prepare("SELECT id FROM groups").get().id;
  db.prepare(`INSERT INTO transactions(id,group_id,kind,account_id,amount_minor,currency,category_id,note,occurred_at,created_by_user_id,status,operation_id)
    VALUES('old-transaction',?,'expense','shared-main',100,'USD','income','test','2026-09-01',?,'posted','old-operation')`)
    .run(oldGroupId, setup.body.user.id);
  db.prepare("INSERT INTO allocation_shares(transaction_id,user_id,basis_points,amount_minor) VALUES('old-transaction',?,10000,100)")
    .run(setup.body.user.id);

  const input = {
    householdName: "New home", displayName: "New master", currency: "EUR",
    deviceId: "new-master", deviceName: "New phone", confirmation: "REINITIALIZE HOUSEHOLD",
  };
  assert.equal((await request("/household/reinitialize", input, member.deviceToken)).status, 403);
  assert.equal((await request("/household/reinitialize", { ...input, confirmation: "wrong" }, oldToken)).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 1);

  const reset = await request("/household/reinitialize", input, oldToken);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.state.baseCurrency, "EUR");
  assert.equal(reset.body.user.role, "master");
  assert.equal((await request("/bootstrap", undefined, oldToken)).status, 401);
  assert.equal((await request("/bootstrap", undefined, member.deviceToken)).status, 401);
  assert.equal((await request("/bootstrap", undefined, reset.body.deviceToken)).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM groups").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM groups WHERE id=?").get(oldGroupId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM device_sessions").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM allocation_shares").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE group_id=?").get(oldGroupId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM household_invitations WHERE group_id=?").get(oldGroupId).count, 0);
  console.log("Household reinitialization: guarded, atomic, currency updated, old data and sessions removed");
} finally {
  db?.close();
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(directory, { recursive: true, force: true });
}