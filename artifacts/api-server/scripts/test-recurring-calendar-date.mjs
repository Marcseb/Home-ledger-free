import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = mkdtempSync(join(tmpdir(), "home-ledger-recurring-date-"));
const databasePath = join(directory, "ledger.sqlite");
process.env.NODE_ENV = "test";
process.env.APP_VARIANT = "production";
process.env.BUDGET_DB_PATH = databasePath;
const realDateNow = Date.now;
let currentTime = realDateNow();
Date.now = () => currentTime;

try {
  const store = await import("../src/lib/budget-store.ts");
  const { inviteHouseholdMember } = await import("./invitation-test-helpers.mjs");
  const master = store.setupHousehold({
    householdName: "Calendar QA", displayName: "Master", currency: "EUR",
    deviceId: "calendar-master", deviceName: "Master phone",
  });
  const member = inviteHouseholdMember(store, master, "calendar-master", "Member", "calendar-member", "Member phone");
  const groupId = master.state.groupId;
  const masterState = store.getState(groupId, master.user.id);
  const memberState = store.getState(groupId, member.user.id);
  const shared = masterState.accounts.find((account) => account.kind === "shared");
  const personal = masterState.accounts.find((account) => account.role === "main");
  const memberMain = memberState.accounts.find((account) => account.role === "main");
  assert(shared && personal && memberMain);
  currentTime = Date.parse("2026-09-30T23:59:59.000Z");
  const sharedCategory = store.createCategory(groupId, master.user.id, "calendar-master", { name: "Calendar shared", scope: "shared", color: "#118855" })
    .categories.find((category) => category.name === "Calendar shared");
  const personalCategory = store.createCategory(groupId, master.user.id, "calendar-master", { name: "Calendar personal", scope: "personal", color: "#118855" })
    .categories.find((category) => category.name === "Calendar personal");
  assert(sharedCategory && personalCategory);
  const template = (kind, accountId, amountMinor, note) => ({
    kind, accountId, amountMinor, note, currency: "EUR",
    categoryId: kind === "income" ? "income" : accountId === shared.id ? sharedCategory.id : personalCategory.id,
  });
  const monthly = store.createRecurringRule(groupId, master.user.id, "calendar-master", {
    cadence: "monthly", nextRunAt: "2026-10-01T10:00:00.000Z",
    assignedUserId: member.user.id,
    transactionTemplate: template("expense", shared.id, 1000, "Calendar shared bill"),
  });
  store.createRecurringRule(groupId, master.user.id, "calendar-master", {
    cadence: "monthly", nextRunAt: "2026-10-01T12:00:00.000Z",
    endCondition: "date", endAt: "2026-10-01T00:00:00.000Z",
    transactionTemplate: template("expense", personal.id, 200, "Calendar last-day bill"),
  });
  store.createRecurringRule(groupId, member.user.id, "calendar-member", {
    cadence: "weekly", nextRunAt: "2026-10-01T23:00:00.000Z",
    endCondition: "occurrences", remainingOccurrences: 1,
    transactionTemplate: template("income", memberMain.id, 500, "Calendar income"),
  });
  const future = store.createRecurringRule(groupId, master.user.id, "calendar-master", {
    cadence: "weekly", nextRunAt: "2026-10-02T00:00:00.000Z",
    transactionTemplate: template("expense", shared.id, 900, "Calendar tomorrow"),
  });
  const paused = store.createRecurringRule(groupId, master.user.id, "calendar-master", {
    cadence: "monthly", nextRunAt: "2026-10-01T12:00:00.000Z",
    transactionTemplate: template("expense", shared.id, 900, "Calendar paused"),
  });
  store.updateRecurringRule(groupId, master.user.id, "calendar-master", paused.id, { active: false });
  assert.equal(store.processDueRecurringRules(groupId), 0, "tomorrow's calendar date must remain scheduled");

  currentTime = Date.parse("2026-10-01T00:00:00.000Z");
  // A normal mobile state refresh must post today's occurrences, even before their stored noon/late time.
  const posted = store.getState(groupId, master.user.id);
  const memberPosted = store.getState(groupId, member.user.id);
  const bill = posted.transactions.find((transaction) => transaction.note === "Calendar shared bill");
  assert(bill && bill.kind === "expense" && bill.status === "posted");
  assert.equal(bill.createdByUserId, member.user.id, "assigned ownership must be retained");
  assert.equal(bill.occurredAt, "2026-10-01T00:00:00.000Z", "posted calendar-date activity must already affect today's balance history");
  const balance = (state, id) => state.accounts.find((account) => account.id === id).balanceMinor;
  assert.equal(balance(posted, shared.id), balance(masterState, shared.id) - 1000);
  assert.equal(balance(posted, personal.id), balance(masterState, personal.id) - 200);
  assert.equal(balance(memberPosted, memberMain.id), balance(memberState, memberMain.id) + 500);
  assert(!memberPosted.transactions.some((transaction) => transaction.note === "Calendar last-day bill"));
  assert(!posted.transactions.some((transaction) => transaction.note === "Calendar income"));
  assert(!posted.transactions.some((transaction) => ["Calendar tomorrow", "Calendar paused"].includes(transaction.note)));
  assert.equal(posted.recurringRules.find((rule) => rule.id === monthly.id).nextRunAt, "2026-11-01T10:00:00.000Z");
  assert.equal(posted.recurringRules.find((rule) => rule.id === future.id).nextRunAt, "2026-10-02T00:00:00.000Z");
  assert.equal(store.processDueRecurringRules(groupId), 0, "repeated polling must not post duplicates");
  assert.equal(posted.recurringRules.find((rule) => rule.transactionTemplate.note === "Calendar last-day bill").active, false);
  assert.equal(memberPosted.recurringRules.find((rule) => rule.transactionTemplate.note === "Calendar income").active, false);

  // Preserve compatibility with an old operation key if a saved rule pointer needs catching up.
  const inspect = new DatabaseSync(databasePath);
  assert.equal(inspect.prepare("SELECT operation_id FROM transactions WHERE id=?").get(bill.id).operation_id,
    `recurring:${monthly.id}:2026-10-01T10:00:00.000Z`);
  inspect.prepare("UPDATE recurring_rules SET next_run_at=? WHERE id=?")
    .run("2026-10-01T10:00:00.000Z", monthly.id);
  assert.equal(store.processDueRecurringRules(groupId), 0, "an existing legacy operation key must not post again");
  currentTime = Date.parse("2026-12-01T00:00:00.000Z");
  store.getState(groupId, master.user.id);
  const occurrences = inspect.prepare("SELECT occurred_at FROM transactions WHERE note=? ORDER BY occurred_at").all("Calendar shared bill");
  assert.deepEqual(occurrences.map((transaction) => transaction.occurred_at.slice(0, 10)), ["2026-10-01", "2026-11-01", "2026-12-01"]);
  assert.equal(store.processDueRecurringRules(groupId), 0, "catch-up must also be idempotent");
  inspect.close();
  console.log("Recurring calendar-date QA passed: midnight, legacy noon, expenses/income, limits, balances, ownership, privacy, catch-up, and idempotency.");
} finally {
  Date.now = realDateNow;
  rmSync(directory, { recursive: true, force: true });
}