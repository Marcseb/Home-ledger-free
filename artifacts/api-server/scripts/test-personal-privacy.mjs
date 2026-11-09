import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHttpInvitationSession } from "./invitation-test-helpers.mjs";

const directory = await mkdtemp(join(tmpdir(), "home-ledger-personal-privacy-"));
const dataPath = join(directory, "ledger.sqlite");
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const child = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env, NODE_ENV: "production", APP_VARIANT: "",
    HOME: directory, XDG_DATA_HOME: directory, BUDGET_DB_PATH: dataPath,
    HOST: "127.0.0.1", PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });
const base = `http://127.0.0.1:${port}/api`;
let db;

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
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start:\n${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const setup = await request("/household/setup", {
    householdName: "Household", displayName: "Master", currency: "USD",
    deviceId: "master-device", deviceName: "Master phone",
  });
  assert.equal(setup.status, 201);
  const member = await createHttpInvitationSession(
    request, setup.body, { displayName: "Member" }, "member-device", "Member phone",
  );
  const masterId = setup.body.user.id;
  const memberId = member.user.id;
  const masterAccount = `personal-${masterId}`;
  const memberAccount = `personal-${memberId}`;
  assert.deepEqual(new Set(member.state.accounts.map((a) => a.id)), new Set(["shared-main", memberAccount]));

  db = new DatabaseSync(dataPath);
  const groupId = setup.body.state.groupId;
  for (const [id, owner] of [["master-savings", masterId], ["member-savings", memberId]]) {
    db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role) VALUES(?,?,'Private savings','personal',?,'USD',3500,'savings')")
      .run(id, groupId, owner);
  }
  function transaction(id, accountId, destinationId, kind, creator, amount) {
    db.prepare(`INSERT INTO transactions(id,group_id,kind,account_id,destination_account_id,amount_minor,currency,category_id,note,occurred_at,created_by_user_id,status,operation_id)
      VALUES(?,?,?,?,?,?,'USD',?,?,?,?,'posted',?)`)
      .run(id, groupId, kind, accountId, destinationId, amount, kind === "transfer" ? "transfer" : "income",
        `note-${id}`, "2026-09-26T12:00:00.000Z", creator, `operation-${id}`);
    db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,'transaction.create',?,?)")
      .run(groupId, `operation-${id}`, id, "2026-09-26T12:00:00.000Z");
  }
  transaction("master-income", masterAccount, null, "income", masterId, 1000);
  transaction("member-income", memberAccount, null, "income", memberId, 2000);
  transaction("member-savings-transfer", memberAccount, "member-savings", "transfer", memberId, 300);
  transaction("master-savings-transfer", masterAccount, "master-savings", "transfer", masterId, 400);
  transaction("shared-income", "shared-main", null, "income", masterId, 500);
  transaction("member-to-shared", memberAccount, "shared-main", "transfer", memberId, 150);
  transaction("master-to-shared", masterAccount, "shared-main", "transfer", masterId, 250);
  transaction("shared-to-member", "shared-main", memberAccount, "transfer", memberId, 100);
  transaction("master-last-private", masterAccount, null, "income", masterId, 100);
  for (const [id, accountId] of [["master-rule", masterAccount], ["member-rule", memberAccount], ["shared-rule", "shared-main"]]) {
    db.prepare(`INSERT INTO recurring_rules(id,group_id,cadence,next_run_at,transaction_template_json,active)
      VALUES(?,?,'monthly','2030-01-01T00:00:00.000Z',?,1)`)
      .run(id, groupId, JSON.stringify({ kind: "income", accountId, amountMinor: 100, currency: "USD", categoryId: "income", note: id }));
  }
  for (const [token, account, owner] of [
    [setup.body.deviceToken, masterAccount, "master"],
    [member.deviceToken, memberAccount, "member"],
  ]) {
    const created = await request("/savings-goals", {
      name: `${owner} private goal`, targetMinor: 5000, initialSavedMinor: 0,
      isShared: false, accountId: account, dueDate: "2030-01-01", priority: "medium",
      operationId: `${owner}-private-goal-created`,
    }, token);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const goal = created.body.savingsGoals.find((item) => item.name === `${owner} private goal`);
    assert(goal);
    const contributed = await request(`/savings-goals/${goal.id}/contributions`, {
      amountMinor: 125, note: "private contribution", operationId: `${owner}-private-goal-contributed`,
    }, token);
    assert.equal(contributed.status, 200, JSON.stringify(contributed.body));
  }
  for (const [token, own, other, ownSavings, otherSavings, ownIncome, otherIncome, ownTransfer, otherTransfer, ownRule, otherRule, owner, otherOwner] of [
    [setup.body.deviceToken, masterAccount, memberAccount, "master-savings", "member-savings", "master-income", "member-income", "master-savings-transfer", "member-savings-transfer", "master-rule", "member-rule", "master", "member"],
    [member.deviceToken, memberAccount, masterAccount, "member-savings", "master-savings", "member-income", "master-income", "member-savings-transfer", "master-savings-transfer", "member-rule", "master-rule", "member", "master"],
  ]) {
    const bootstrap = await request("/bootstrap", undefined, token);
    assert.equal(bootstrap.status, 200);
    const state = bootstrap.body;
    assert(!JSON.stringify(state).includes(other), "bootstrap exposed another member's personal account ID");
    assert(!JSON.stringify(state).includes(otherSavings), "bootstrap exposed another member's savings account ID");
    assert.deepEqual(new Set(state.accounts.map((a) => a.id)), new Set(["shared-main", own, ownSavings]));
    assert.equal(state.accounts.find((a) => a.id === ownSavings).balanceMinor, ownSavings === "master-savings" ? 3900 : 3800);
    assert.equal(state.accounts.some((a) => a.id === otherSavings || a.id === other), false);
    const txIds = new Set(state.transactions.map((t) => t.id));
    for (const id of [ownIncome, ownTransfer, "shared-income", "member-to-shared", "master-to-shared", "shared-to-member"]) assert(txIds.has(id), `missing ${id}`);
    for (const id of [otherIncome, otherTransfer]) assert(!txIds.has(id), `exposed ${id}`);
    assert.equal(txIds.has("master-last-private"), own === masterAccount);
    assert.deepEqual(new Set(state.recurringRules.map((r) => r.id)), new Set([ownRule, "shared-rule"]));
    assert(!state.recurringRules.some((r) => r.id === otherRule));
    const synced = await request("/sync", { cursor: 0, operations: [] }, token);
    assert.equal(synced.status, 200);
    assert.deepEqual(new Set(synced.body.events.map((e) => e.transaction?.id).filter(Boolean)), txIds);
    const eventIds = new Set(synced.body.events.map((e) => e.operationId));
    for (const id of [`${owner}-private-goal-created`, `${owner}-private-goal-contributed`]) assert(eventIds.has(id), `missing own event ${id}`);
    for (const id of [`${otherOwner}-private-goal-created`, `${otherOwner}-private-goal-contributed`]) assert(!eventIds.has(id), `exposed private event ${id}`);
    assert(!JSON.stringify(synced.body).includes(other), "sync exposed another member's personal account ID");
    assert(!JSON.stringify(synced.body).includes(otherSavings), "sync exposed another member's savings account ID");
    assert.equal(synced.body.cursor, 13);
    assert.deepEqual((await request("/sync", { cursor: synced.body.cursor, operations: [] }, token)).body.events, []);
    const dashboard = await request("/dashboard", undefined, token);
    assert.equal(dashboard.status, 200);
    assert(!dashboard.body.accountBalances.some((a) => a.accountId === other || a.accountId === otherSavings));
    assert.equal(dashboard.body.accountBalances.find((a) => a.accountId === "shared-main").balanceMinor, 800);
  }
  assert.equal((await request("/bootstrap")).status, 401);
  console.log("Personal privacy: master/member bootstrap, sync, shared transfers, recurring rules, dashboard");
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