import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "home-ledger-current-balances-"));
process.env.NODE_ENV = "test";
process.env.APP_VARIANT = "production";
process.env.BUDGET_DB_PATH = join(directory, "isolated.sqlite");
const realDateNow = Date.now;
let currentTime = Date.parse("2026-10-06T10:00:00.000Z");
Date.now = () => currentTime;

try {
  const store = await import("../src/lib/budget-store.ts");
  const session = store.setupHousehold({
    householdName: "Date cutoff QA", displayName: "Fixture owner", currency: "EUR",
    deviceId: "date-fixture", deviceName: "Fixture",
  });
  const groupId = session.state.groupId;
  const userId = session.user.id;
  const main = session.state.accounts.find((account) => account.role === "main");
  const shared = session.state.accounts.find((account) => account.kind === "shared");
  const savings = store.createSavingsAccount(groupId, userId, "date-fixture", { name: "Fixture savings" });
  const category = store.createCategory(groupId, userId, "date-fixture", {
    name: "Fixture expense", scope: "personal", color: "#118855",
  }).categories.find((item) => item.name === "Fixture expense");
  assert(main && shared && savings && category);
  const create = (id, kind, accountId, amountMinor, occurredAt, destinationAccountId = null) => {
    const result = store.sync(groupId, userId, "date-fixture", 0, [{
      operationId: `op-${id}`, deviceId: "date-fixture", clientCreatedAt: new Date(currentTime).toISOString(),
      type: "transaction.create", payload: { transaction: {
        id, kind, accountId, destinationAccountId, amountMinor, occurredAt, currency: "EUR",
        categoryId: kind === "income" ? "income" : kind === "transfer" ? "transfer" : category.id,
        note: `Fixture ${id}`, createdByUserId: userId, status: "posted",
        reversesTransactionId: null, allocationShares: [],
      } },
    }]);
    assert.equal(result.acknowledgements[0].status, "applied", result.acknowledgements[0].error);
  };
  const state = () => store.getState(groupId, userId);
  const balances = () => Object.fromEntries(state().accounts.map((account) => [account.id, account.balanceMinor]));
  const verify = (expectedMain, expectedSavings, expectedShared) => {
    const actual = balances();
    assert.equal(actual[main.id], expectedMain);
    assert.equal(actual[savings.id], expectedSavings);
    assert.equal(actual[shared.id], expectedShared);
    const dashboard = store.dashboard(groupId, userId);
    for (const account of dashboard.accountBalances) assert.equal(account.balanceMinor, actual[account.accountId]);
    assert.equal(dashboard.personalBalanceMinor, expectedMain);
    assert.equal(dashboard.sharedBalanceMinor, expectedShared);
  };
  create("opening", "income", main.id, 152790, "2026-10-01T00:00:00Z");
  create("saved", "transfer", main.id, 82790, "2026-10-04T00:00:00Z", savings.id);
  create("shared-opening", "income", shared.id, 10000, "2026-10-01T00:00:00Z");
  create("cancelled-october", "transfer", main.id, 70000, "2026-10-04T00:00:00Z", savings.id);
  store.cancelTransaction(groupId, userId, "date-fixture", "cancelled-october", { operationId: "cancel-october" });
  create("november-transfer", "transfer", main.id, 70000, "2026-11-01T12:00:00Z", savings.id);
  create("future-income", "income", main.id, 20000, "2026-10-07T23:59:59Z");
  create("future-expense", "expense", main.id, 10000, "2026-10-08T12:00:00Z");
  create("future-shared-transfer", "transfer", shared.id, 10000, "2026-11-01T12:00:00Z", main.id);
  create("cancelled-future", "transfer", main.id, 43000, "2026-11-01T00:00:00Z", savings.id);
  store.cancelTransaction(groupId, userId, "date-fixture", "cancelled-future", { operationId: "cancel-future" });
  verify(70000, 82790, 10000);
  const before = state().transactions;
  assert.equal(before.find((item) => item.id === "november-transfer").status, "posted");
  assert.equal(before.find((item) => item.id === "cancelled-october").status, "reversed");
  // Later stored hours on a due date must not delay a calendar-date entry.
  currentTime = Date.parse("2026-10-07T00:00:00Z");
  verify(90000, 82790, 10000);
  currentTime = Date.parse("2026-10-08T00:00:00Z");
  verify(80000, 82790, 10000);
  currentTime = Date.parse("2026-10-31T23:59:59Z");
  verify(80000, 82790, 10000);
  currentTime = Date.parse("2026-11-01T00:00:00Z");
  verify(20000, 152790, 0);
  verify(20000, 152790, 0); // No second application on refresh.
  assert.deepEqual(state().transactions, before, "Reading a date-based balance must not rewrite or create activity");
  console.log("Current-balance date QA passed: EUR700 discrepancy, both transfer legs, future income/expense, Shared, dashboard parity, reversals, UTC midnight, and unchanged records.");
} finally {
  Date.now = realDateNow;
  rmSync(directory, { recursive: true, force: true });
}
