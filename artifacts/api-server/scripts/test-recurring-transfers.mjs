import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "home-ledger-recurring-transfer-"));
process.env.NODE_ENV = "test";
process.env.APP_VARIANT = "accelerated-test";
process.env.BUDGET_DB_PATH = join(directory, "ledger.sqlite");

try {
  const store = await import("../src/lib/budget-store.ts");
  const { inviteHouseholdMember } = await import("./invitation-test-helpers.mjs");
  const { setupHousehold, createSavingsAccount, createRecurringRule, updateRecurringRule, updateSavingsAccount, advanceBusinessClock, getBusinessClockStatus, getState, processDueRecurringRules } = store;
  const master = setupHousehold({ householdName: "Recurring QA", displayName: "Master", currency: "USD", deviceId: "recurring-master", deviceName: "Master phone" });
  const member = inviteHouseholdMember(store, master, "recurring-master", "Member", "recurring-member", "Member phone");
  const groupId = master.state.groupId;
  const masterMain = getState(groupId, master.user.id).accounts.find((a) => a.role === "main");
  const memberMain = getState(groupId, member.user.id).accounts.find((a) => a.role === "main");
  assert(masterMain && memberMain);
  const masterSavings = createSavingsAccount(groupId, master.user.id, "recurring-master", { name: "Master savings" });
  const memberSavings = createSavingsAccount(groupId, member.user.id, "recurring-member", { name: "Member savings" });
  const secondSavings = createSavingsAccount(groupId, master.user.id, "recurring-master", { name: "Other savings" });
  const tomorrow = new Date(getBusinessClockStatus().serverNow);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(12, 0, 0, 0);
  const firstDate = tomorrow.toISOString();
  const template = (from, to, amountMinor, note) => ({
    kind: "transfer", accountId: from, destinationAccountId: to,
    amountMinor, currency: master.state.baseCurrency, categoryId: "transfer", note,
  });
  const schedule = (from, to, amountMinor, note) => ({
    cadence: "weekly", nextRunAt: firstDate, endCondition: "occurrences", remainingOccurrences: 1,
    transactionTemplate: template(from, to, amountMinor, note),
  });
  const masterBefore = getState(groupId, master.user.id).accounts;
  const memberBefore = getState(groupId, member.user.id).accounts;
  createRecurringRule(groupId, master.user.id, "recurring-master", schedule(masterMain.id, masterSavings.id, 700, "Master save"));
  const returnRule = createRecurringRule(groupId, master.user.id, "recurring-master", schedule(masterSavings.id, masterMain.id, 200, "Master return"));
  const edited = updateRecurringRule(groupId, master.user.id, "recurring-master", returnRule.id, {
    transactionTemplate: template(masterSavings.id, masterMain.id, 250, "Master return edited"),
  });
  assert.equal(edited.transactionTemplate.destinationAccountId, masterMain.id);
  createRecurringRule(groupId, member.user.id, "recurring-member", schedule(memberMain.id, memberSavings.id, 500, "Member save"));
  createRecurringRule(groupId, member.user.id, "recurring-member", schedule(memberSavings.id, memberMain.id, 100, "Member return"));

  assert.throws(() => createRecurringRule(groupId, member.user.id, "recurring-member",
    schedule(masterMain.id, memberSavings.id, 100, "Cross user")), /own personal accounts|account you can use/);
  assert.throws(() => createRecurringRule(groupId, master.user.id, "recurring-master",
    schedule("shared-main", masterSavings.id, 100, "Shared savings")), /Savings accounts cannot transfer directly|Main and Savings/);
  assert.throws(() => createRecurringRule(groupId, master.user.id, "recurring-master",
    schedule(masterSavings.id, secondSavings.id, 100, "Savings to savings")), /Main and Savings/);
  assert.throws(() => createRecurringRule(groupId, master.user.id, "recurring-master",
    schedule(masterMain.id, masterMain.id, 100, "Same account")), /different source and destination/);
  assert.throws(() => createRecurringRule(groupId, master.user.id, "recurring-master",
    { ...schedule(masterMain.id, masterSavings.id, 100, "No destination"), transactionTemplate: { ...template(masterMain.id, masterSavings.id, 100, "No destination"), destinationAccountId: null } }), /destination/);

  const archivedRule = createRecurringRule(groupId, master.user.id, "recurring-master",
    schedule(masterMain.id, secondSavings.id, 100, "Cannot archive active destination"));
  assert.throws(() => updateSavingsAccount(groupId, master.user.id, "recurring-master", secondSavings.id, { archived: true }),
    /Pause or remove recurring entries/);
  updateRecurringRule(groupId, master.user.id, "recurring-master", archivedRule.id, { active: false });
  updateSavingsAccount(groupId, master.user.id, "recurring-master", secondSavings.id, { archived: true });
  assert.throws(() => updateRecurringRule(groupId, master.user.id, "recurring-master", archivedRule.id, { active: true }),
    /Archived accounts/);

  const advanced = advanceBusinessClock("day", () => processDueRecurringRules(groupId));
  assert.equal(advanced.createdRecurringTransactions, 4);
  assert.equal(processDueRecurringRules(groupId), 0, "due rules must not post twice");
  const masterAfter = getState(groupId, master.user.id);
  const memberAfter = getState(groupId, member.user.id);
  const masterTransactions = masterAfter.transactions.filter((tx) => tx.note.startsWith("Master save") || tx.note.startsWith("Master return"));
  const memberTransactions = memberAfter.transactions.filter((tx) => tx.note.startsWith("Member save") || tx.note.startsWith("Member return"));
  assert.equal(masterTransactions.length, 2);
  assert.equal(memberTransactions.length, 2);
  assert(masterTransactions.every((tx) => tx.kind === "transfer" && tx.categoryId === "transfer" && tx.destinationAccountId));
  assert(memberTransactions.every((tx) => tx.kind === "transfer" && tx.categoryId === "transfer" && tx.destinationAccountId));
  assert(!memberAfter.transactions.some((tx) => tx.note.startsWith("Master save") || tx.note.startsWith("Master return")),
    "member must not see the master's personal transfers");
  const balance = (accounts, id) => accounts.find((a) => a.id === id).balanceMinor;
  assert.equal(balance(masterAfter.accounts, masterMain.id), balance(masterBefore, masterMain.id) - 450);
  assert.equal(balance(masterAfter.accounts, masterSavings.id), balance(masterBefore, masterSavings.id) + 450);
  assert.equal(balance(memberAfter.accounts, memberMain.id), balance(memberBefore, memberMain.id) - 400);
  assert.equal(balance(memberAfter.accounts, memberSavings.id), balance(memberBefore, memberSavings.id) + 400);
  console.log("Recurring transfer QA passed: both directions, both roles, privacy, balance, limits, and idempotency.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}