import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createHttpInvitationSession } from "./invitation-test-helpers.mjs";

const directory = await mkdtemp(join(tmpdir(), "home-ledger-contribution-cancel-"));
const dataPath = join(directory, "ledger.sqlite");
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const child = spawn(process.execPath, ["./dist/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, NODE_ENV: "test", APP_VARIANT: "", BUDGET_DB_PATH: dataPath, HOST: "127.0.0.1", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });
const base = `http://127.0.0.1:${port}/api`;
let db;
const request = async (path, body, token, method = body === undefined ? "GET" : "POST") => {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", ...(token ? { "x-device-token": token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
const ok = async (...args) => {
  const result = await request(...args);
  assert(result.status >= 200 && result.status < 300, JSON.stringify(result));
  return result.body;
};
const goal = (state, name) => state.savingsGoals.find((item) => item.name === name);
const cancelPath = (goalId, contributionId) => `/savings-goals/${goalId}/contributions/${contributionId}/cancellation`;
const balances = (state) => state.accounts.map(({ id, balanceMinor }) => ({ id, balanceMinor }));
const counts = () => ({
  transactions: db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n,
  audit: db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='savings-goal.contribution-cancelled'").get().n,
  sync: db.prepare("SELECT COUNT(*) AS n FROM sync_events WHERE type='savings-goal.contribution-cancelled'").get().n,
});

try {
  const deadline = Date.now() + 15_000;
  while (true) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const master = await ok("/household/setup", { householdName: "Cancellation QA", displayName: "Master", currency: "EUR", deviceId: "master", deviceName: "Master phone" });
  const member = await createHttpInvitationSession(request, master, { displayName: "Member" }, "member", "Member phone");
  const token = member.deviceToken;
  db = new DatabaseSync(dataPath, { readOnly: true });
  const savings = await ok("/accounts", { name: "Member savings" }, token);
  const dueDate = "2030-12-31";
  const create = (name, isShared, initialSavedMinor = 0, linkedAccountId = null) => ok("/savings-goals", {
    name, isShared, initialSavedMinor, linkedAccountId, targetMinor: 10000, dueDate, priority: "medium",
    accountId: isShared ? "shared-main" : `personal-${member.user.id}`, operationId: randomUUID(),
  }, isShared ? master.deviceToken : token);
  const shared = goal(await create("Shared", true), "Shared");
  const personal = goal(await create("Personal", false, 200, savings.id), "Personal");
  const progressOnly = goal(await create("Progress only", false, 100), "Progress only");
  const invited = await ok(`/savings-goals/${shared.id}/participants`, { userId: member.user.id, committedMinor: 5000, operationId: randomUUID() }, master.deviceToken);
  const participant = goal(invited, "Shared").participants.find((item) => item.userId === member.user.id);
  await ok(`/savings-goal-participants/${participant.id}`, { status: "accepted", personalGoalId: personal.id, operationId: randomUUID() }, token, "PATCH");
  const before = await ok(`/savings-goals/${personal.id}/contributions`, { amountMinor: 300, note: "Mirrored savings", operationId: randomUUID() }, token);
  const contribution = goal(before, "Personal").contributions.find((item) => item.note === "Mirrored savings");
  const path = cancelPath(shared.id, contribution.id);
  assert.equal((await request(path, { operationId: randomUUID() })).status, 401);
  assert.equal((await request(path, { operationId: randomUUID() }, master.deviceToken)).status, 403, "Master cannot cancel another contributor's entry");
  assert.equal((await request(cancelPath(progressOnly.id, contribution.id), { operationId: randomUUID() }, token)).status, 400);
  assert.equal((await request(path, { operationId: randomUUID(), returnFunds: true }, token)).status, 400, "Cancellation must never accept a fund-return instruction");
  assert.equal((await request(path, {}, token)).status, 400);
  const operationId = randomUUID();
  const initialCounts = counts();
  const after = await ok(path, { operationId }, token);
  assert.equal(goal(after, "Personal").currentMinor, 200);
  assert.equal(goal(after, "Shared").currentMinor, 0);
  assert(goal(after, "Personal").contributions.find((item) => item.id === contribution.id).reversedAt);
  assert(goal(after, "Shared").contributions.find((item) => item.id === contribution.id).reversedAt);
  assert.deepEqual(balances(after), balances(before), "Balances must not move");
  assert.deepEqual(after.transactions, before.transactions, "Posted transfers must be byte-for-byte unchanged");
  assert.deepEqual(counts(), { ...initialCounts, audit: initialCounts.audit + 1, sync: initialCounts.sync + 1 });
  const retry = await ok(path, { operationId }, token);
  const retryNewId = await ok(path, { operationId: randomUUID() }, token);
  assert.equal(goal(retry, "Personal").currentMinor, 200);
  assert.equal(goal(retryNewId, "Personal").currentMinor, 200);
  assert.deepEqual(counts(), { ...initialCounts, audit: initialCounts.audit + 1, sync: initialCounts.sync + 1 }, "Retries must not duplicate cancellation events");
  const reloaded = await ok("/bootstrap", undefined, token);
  assert.equal(goal(reloaded, "Personal").currentMinor, 200);
  assert.deepEqual(balances(reloaded), balances(before));
  const allocation = db.prepare("SELECT SUM(c.amount_minor) AS n FROM savings_goal_contributions c JOIN transactions t ON t.id=c.transaction_id WHERE c.reversed_at IS NULL AND t.destination_account_id=?").get(savings.id);
  assert.equal(allocation.n, 200, "Released funds no longer count as a savings allocation");
  const progressEntry = progressOnly.contributions[0];
  const beforeProgress = counts();
  const noProgress = await ok(cancelPath(progressOnly.id, progressEntry.id), { operationId: randomUUID() }, token);
  assert.equal(goal(noProgress, "Progress only").currentMinor, 0);
  assert.equal(counts().transactions, beforeProgress.transactions, "Progress-only cancellation creates no transaction");
  const directShared = await ok(`/savings-goals/${shared.id}/contributions`, { amountMinor: 75, operationId: randomUUID() }, token);
  const directEntry = goal(directShared, "Shared").contributions.find((item) => item.goalId === shared.id);
  assert.equal(goal(await ok(cancelPath(shared.id, directEntry.id), { operationId: randomUUID() }, token), "Shared").currentMinor, 0);
  await ok(`/transactions/${contribution.transactionId}/cancellation`, { operationId: randomUUID() }, token);
  assert.equal(goal(await ok("/bootstrap", undefined, token), "Personal").currentMinor, 200, "Later transfer cancellation must not decrement progress twice");
  const cancelledGoal = await ok(`/savings-goals/${personal.id}/cancellation`, { operationId: randomUUID(), returnFunds: false }, token);
  const remaining = goal(cancelledGoal, "Personal").contributions.find((item) => !item.reversedAt);
  assert.equal((await request(cancelPath(personal.id, remaining.id), { operationId: randomUUID() }, token)).status, 400, "Cancelled goals use owner settlement");
  console.log("PASS: contribution cancellation preserves balances and transfers, releases allocations, updates mirrored progress, enforces ownership, preserves history, and is idempotent.");
} finally {
  db?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve));
  await rm(directory, { recursive: true, force: true });
}
