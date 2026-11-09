import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

process.env.NODE_ENV = "test";
const databasePath = `/tmp/home-ledger-budget-qa-${process.pid}.sqlite`;
process.env.BUDGET_DB_PATH = databasePath;

// Simulate the pre-feature schema with duplicate monthly rows. Startup must
// consolidate it before creating the unique month/category index.
const legacyDb = new DatabaseSync(databasePath);
legacyDb.exec(`CREATE TABLE groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_currency TEXT NOT NULL,
  pairing_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, pairing_code_expires_at TEXT
);
CREATE TABLE budgets (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, category_id TEXT NOT NULL, month TEXT NOT NULL,
  limit_minor INTEGER NOT NULL, warning_percent INTEGER NOT NULL, rollover_minor INTEGER NOT NULL DEFAULT 0
)`);
legacyDb.prepare("INSERT INTO groups VALUES(?,?,?,?,?,?)").run("legacy-group", "Legacy QA", "USD", "999999", new Date().toISOString(), "2099-01-01T00:00:00.000Z");
legacyDb.prepare("INSERT INTO budgets VALUES(?,?,?,?,?,?,0)").run("legacy-1", "legacy-group", "legacy-category", "2026-01", 1000, 80);
legacyDb.prepare("INSERT INTO budgets VALUES(?,?,?,?,?,?,0)").run("legacy-2", "legacy-group", "legacy-category", "2026-01", 2000, 90);
legacyDb.close();

const store = await import("../src/lib/budget-store.ts");
const { resetDemo, sync, getState, createCategory, createBudget, updateBudget, cancelTransaction, correctTransaction, createRecurringRule, acknowledgeBudgetAlert } = store;
const { bootstrapDemoMaster, inviteExistingHouseholdUser } = await import("./invitation-test-helpers.mjs");
const fail = (message) => { throw new Error(`Budget QA failed: ${message}`); };
const expectError = (fn, text) => { try { fn(); fail(`expected error containing "${text}"`); } catch (error) { assert.match(error.message, new RegExp(text)); } };
const month = new Date().toISOString().slice(0, 7);
const operation = (transaction, deviceId, operationId = randomUUID()) => ({ operationId, deviceId, clientCreatedAt: new Date().toISOString(), type: "transaction.create", payload: { transaction } });
const tx = (id, categoryId, amountMinor, accountId = "shared-main", occurredAt = new Date().toISOString()) => ({
  id, kind: "expense", accountId, destinationAccountId: null, amountMinor, currency: "USD", categoryId,
  note: "Budget QA", occurredAt, createdByUserId: "qa", status: "posted", reversesTransactionId: null, allocationShares: [],
});
const migrationCheckDb = new DatabaseSync(databasePath);
assert.equal(migrationCheckDb.prepare("SELECT COUNT(*) count FROM budgets WHERE group_id='legacy-group' AND category_id='legacy-category' AND month='2026-01'").get().count, 1);
assert.throws(() => migrationCheckDb.prepare("INSERT INTO budgets(id,group_id,category_id,month,limit_minor,warning_percent,rollover_minor,enabled) VALUES(?,?,?,?,?,?,0,1)").run("legacy-3", "legacy-group", "legacy-category", "2026-01", 3000, 70));
migrationCheckDb.close();
resetDemo();
const master = bootstrapDemoMaster(store, "qa-master", "QA");
const memberIdFromSeed = master.state.users.find((user) => user.displayName === "Sam")?.id;
assert(memberIdFromSeed, "Demo fixture must contain Sam");
const member = inviteExistingHouseholdUser(store, master, "qa-master", memberIdFromSeed, "qa-member", "QA");
const masterId = master.user.id;
const memberId = member.user.id;
const category = "groceries";

// Shared budget management and visibility.
createBudget(master.state.groupId, masterId, "qa-master", { categoryId: category, limitMinor: 10000, warningPercent: 80, enabled: true });
expectError(() => createBudget(member.state.groupId, memberId, "qa-member", { categoryId: category, limitMinor: 10000, warningPercent: 80, enabled: true }), "Master role required");
assert.equal(getState(member.state.groupId, memberId).budgets.some((b) => b.categoryId === category), true);

// Exact warning, at-limit, over and duplicate-safe alerts.
sync(master.state.groupId, masterId, "qa-master", 0, [operation(tx("qa-warning", category, 8000), "qa-master")]);
let state = getState(master.state.groupId, masterId);
assert.equal(state.budgets.find((b) => b.categoryId === category && b.month === month).status, "warning");
assert.equal(state.budgetAlerts.filter((a) => a.categoryId === category && a.type === "warning").length, 1);
getState(master.state.groupId, masterId);
assert.equal(getState(master.state.groupId, masterId).budgetAlerts.filter((a) => a.categoryId === category && a.type === "warning").length, 1);
sync(master.state.groupId, masterId, "qa-master", 0, [operation(tx("qa-limit", category, 2000), "qa-master")]);
assert.equal(getState(master.state.groupId, masterId).budgets.find((b) => b.categoryId === category && b.month === month).status, "at_limit");
sync(master.state.groupId, masterId, "qa-master", 0, [operation(tx("qa-over", category, 1), "qa-master")]);
assert.equal(getState(master.state.groupId, masterId).budgets.find((b) => b.categoryId === category && b.month === month).status, "over");
assert.equal(getState(master.state.groupId, masterId).budgetAlerts.filter((a) => a.categoryId === category && a.type === "over").length, 1);

// Cancellation and correction recalculate authoritative spending.
cancelTransaction(master.state.groupId, masterId, "qa-master", "qa-over", { operationId: "qa-cancel" });
assert.equal(getState(master.state.groupId, masterId).budgets.find((b) => b.categoryId === category && b.month === month).spentMinor, 10000);
correctTransaction(master.state.groupId, masterId, "qa-master", "qa-limit", { operationId: "qa-correction", amountMinor: 1000, categoryId: category, note: "Corrected" });
assert.equal(getState(master.state.groupId, masterId).budgets.find((b) => b.categoryId === category && b.month === month).spentMinor, 9000);
cancelTransaction(master.state.groupId, masterId, "qa-master", "qa-warning", { operationId: "qa-cancel-warning" });
state = getState(master.state.groupId, masterId);
assert.equal(state.budgets.find((b) => b.categoryId === category && b.month === month).status, "normal");
const durableWarning = state.budgetAlerts.find((a) => a.categoryId === category && a.type === "warning");
assert.ok(durableWarning, "warning alert must persist after spending falls below the threshold");
acknowledgeBudgetAlert(master.state.groupId, masterId, "qa-master", durableWarning.id);
assert.equal(getState(master.state.groupId, masterId).budgetAlerts.some((a) => a.id === durableWarning.id), false);

// Personal privacy and ownership.
const personalState = createCategory(master.state.groupId, masterId, "qa-master", { name: "Private QA", scope: "personal", color: "#123456" });
const personal = personalState.categories.find((c) => c.name === "Private QA");
expectError(() => createBudget(member.state.groupId, memberId, "qa-member", { categoryId: personal.id, limitMinor: 1000, warningPercent: 80, enabled: true }), "personal budget");
createBudget(master.state.groupId, masterId, "qa-master", { categoryId: personal.id, limitMinor: 1000, warningPercent: 80, enabled: true });
assert.equal(getState(member.state.groupId, memberId).budgets.some((b) => b.categoryId === personal.id), false);

// Historical month counting and immutable past snapshot. Seed a snapshot that
// represents the configuration that actually existed in that prior month.
const previousMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15)).toISOString();
const inspectDb = new DatabaseSync(databasePath);
inspectDb.prepare("INSERT INTO budgets(id,group_id,category_id,month,limit_minor,warning_percent,rollover_minor,enabled) VALUES(?,?,?,?,?,?,0,1)")
  .run(randomUUID(), master.state.groupId, category, previousMonth.slice(0, 7), 12000, 75);
sync(master.state.groupId, masterId, "qa-master", 0, [operation(tx("qa-history", category, 500, "shared-main", previousMonth), "qa-master")]);
const history = getState(master.state.groupId, masterId).budgets.find((b) => b.categoryId === category && b.month === previousMonth.slice(0, 7));
assert.equal(history?.spentMinor, 500);
assert.equal(history?.limitMinor, 12000);
// Current row remains the authoritative configuration; updating it must not alter any prior row.
const before = getState(master.state.groupId, masterId).budgets.filter((b) => b.categoryId === category).map((b) => ({ month: b.month, limitMinor: b.limitMinor }));
updateBudget(master.state.groupId, masterId, "qa-master", category, { categoryId: category, limitMinor: 20000, warningPercent: 90, enabled: true });
const after = getState(master.state.groupId, masterId).budgets.filter((b) => b.categoryId === category).filter((b) => b.month !== month);
assert.deepEqual(after.map((b) => ({ month: b.month, limitMinor: b.limitMinor })), before.filter((b) => b.month !== month));

// Lazy carry-forward copies the latest prior configuration, but never copies
// a newer configuration backward into a month before it existed.
const carryState = createCategory(master.state.groupId, masterId, "qa-master", { name: "Carry QA", scope: "personal", color: "#654321" });
const carryCategory = carryState.categories.find((c) => c.name === "Carry QA");
inspectDb.prepare("INSERT INTO budgets(id,group_id,category_id,month,limit_minor,warning_percent,rollover_minor,enabled) VALUES(?,?,?,?,?,?,0,1)")
  .run(randomUUID(), master.state.groupId, carryCategory.id, previousMonth.slice(0, 7), 7000, 70);
const carried = getState(master.state.groupId, masterId).budgets.find((b) => b.categoryId === carryCategory.id && b.month === month);
assert.equal(carried?.limitMinor, 7000);
assert.equal(carried?.warningPercent, 70);

// Due recurring expenses are posted before state/budget calculation.
createBudget(master.state.groupId, masterId, "qa-master", { categoryId: "housing", limitMinor: 5000, warningPercent: 80, enabled: true });
createRecurringRule(master.state.groupId, masterId, "qa-master", {
  cadence: "monthly",
  intervalMonths: 1,
  nextRunAt: new Date(Date.now() - 60_000).toISOString(),
  assignedUserId: null,
  endCondition: "occurrences",
  endAt: null,
  remainingOccurrences: 1,
  transactionTemplate: {
    kind: "expense",
    accountId: "shared-main",
    amountMinor: 4000,
    currency: "USD",
    categoryId: "housing",
    note: "Recurring budget QA",
  },
});
const recurringBudget = getState(master.state.groupId, masterId).budgets.find((b) => b.categoryId === "housing" && b.month === month);
assert.equal(recurringBudget?.spentMinor, 4000);
assert.equal(recurringBudget?.status, "warning");

// Future-dated activity must not materialize or return a future budget month.
const futureMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 2, 15)).toISOString();
sync(master.state.groupId, masterId, "qa-master", 0, [operation(tx("qa-future", "housing", 100, "shared-main", futureMonth), "qa-master")]);
assert.equal(getState(master.state.groupId, masterId).budgets.some((b) => b.month === futureMonth.slice(0, 7)), false);

inspectDb.close();
console.log("Budget QA passed: permissions, statuses, dedupe, corrections/cancellation, privacy, history, carry-forward, and recurring expenses.");