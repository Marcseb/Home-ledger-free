import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";

process.env.NODE_ENV = "test";
process.env.APP_VARIANT = "accelerated-test";
const databasePath = `/tmp/home-ledger-clock-qa-${process.pid}.sqlite`;
process.env.BUDGET_DB_PATH = databasePath;

const store = await import("../src/lib/budget-store.ts");
const { resetDemo, getBusinessClockStatus, advanceBusinessClock, createRecurringRule, getState } = store;
const { bootstrapDemoMaster } = await import("./invitation-test-helpers.mjs");
resetDemo();
const master = bootstrapDemoMaster(store, "clock-master", "QA");
const before = getBusinessClockStatus();
assert.equal(before.acceleratedTest, true);
assert.throws(
  () => advanceBusinessClock("day", () => { throw new Error("materialization failed"); }),
  /materialization failed/,
);
assert.equal(Math.abs(new Date(getBusinessClockStatus().serverNow).getTime() - new Date(before.serverNow).getTime()) < 100, true);

const ruleDate = new Date(new Date(before.serverNow).getTime() + 24 * 60 * 60 * 1000).toISOString();
createRecurringRule(master.state.groupId, master.user.id, "clock-master", {
  cadence: "weekly",
  nextRunAt: ruleDate,
  assignedUserId: null,
  endCondition: "occurrences",
  remainingOccurrences: 1,
  transactionTemplate: {
    kind: "expense",
    accountId: "shared-main",
    amountMinor: 100,
    currency: "USD",
    categoryId: "housing",
    note: "Clock QA",
  },
});

const advanced = advanceBusinessClock("day", () => store.processDueRecurringRules(master.state.groupId));
assert.equal(new Date(advanced.serverNow).getTime() >= new Date(ruleDate).getTime(), true);
assert.equal(advanced.createdRecurringTransactions, 1);
const state = getState(master.state.groupId, master.user.id);
assert.equal(
  Math.abs(new Date(state.serverNow).getTime() - new Date(getBusinessClockStatus().serverNow).getTime()) < 100,
  true,
);
assert.equal(state.transactions.some((transaction) => transaction.note === "Clock QA"), true);
const second = advanceBusinessClock("day", () => store.processDueRecurringRules(master.state.groupId));
assert.equal(new Date(second.serverNow).getTime() - new Date(advanced.serverNow).getTime() >= 24 * 60 * 60 * 1000 - 100, true);

const inspectDb = new DatabaseSync(databasePath);
assert.notEqual(inspectDb.prepare("SELECT value FROM runtime_state WHERE key='business_clock_offset_ms'").get().value, "0");
inspectDb.close();

const productionProbe = spawnSync(process.execPath, ["--experimental-strip-types", "-e", `
  process.env.NODE_ENV = "test";
  process.env.APP_VARIANT = "production";
  process.env.BUDGET_DB_PATH = ${JSON.stringify(databasePath)};
  const store = await import("./src/lib/budget-store.ts");
  if (store.getBusinessClockStatus().acceleratedTest) process.exit(1);
`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(productionProbe.status, 0, productionProbe.stderr);

const productionIsolationProbe = spawnSync(process.execPath, ["--experimental-strip-types", "-e", `
  process.env.NODE_ENV = "production";
  process.env.APP_VARIANT = "accelerated-test";
  process.env.BUDGET_DB_PATH = ${JSON.stringify(databasePath)};
  process.env.BUDGET_BACKUP_DIR = ${JSON.stringify(`${databasePath}-backups`)};
  await import("./src/lib/budget-store.ts");
`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.notEqual(productionIsolationProbe.status, 0, "accelerated production mode must reject normal explicit database paths");

const productionPortIsolationProbe = spawnSync(process.execPath, ["--experimental-strip-types", "-e", `
  process.env.NODE_ENV = "production";
  process.env.APP_VARIANT = "accelerated-test";
  process.env.HOME = ${JSON.stringify(`/tmp/home-ledger-port-isolation-qa-${process.pid}`)};
  process.env.PORT = "5000";
  delete process.env.BUDGET_DB_PATH;
  delete process.env.BUDGET_BACKUP_DIR;
  await import("./dist/index.mjs");
`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.notEqual(productionPortIsolationProbe.status, 0, "direct accelerated production startup must reject port 5000");
assert.match(productionPortIsolationProbe.stderr, /cannot use the production port 5000/);

const httpProbe = spawnSync(process.execPath, ["--experimental-strip-types", "-e", `
  process.env.NODE_ENV = "production";
  process.env.APP_VARIANT = "production";
  process.env.HOME = ${JSON.stringify(`/tmp/home-ledger-http-qa-${process.pid}`)};
  process.env.PORT = "${46000 + (process.pid % 1000)}";
  await import("./dist/index.mjs");
  setTimeout(async () => {
    const response = await fetch("http://127.0.0.1:" + process.env.PORT + "/api/test-clock");
    process.exit(response.status === 404 ? 0 : 1);
  }, 150);
`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(httpProbe.status, 0, httpProbe.stderr);
console.log("Test clock QA passed: variant gate, persisted advance, recurring materialization, and production behavior.");