import assert from "node:assert/strict";
import { defaultPersonalPayerAccountId, projectPurchase, pendingLedgerTransactions, sharedOnlyOperations, isAuditEntry } from "../lib/shared-expense.ts";
import { balanceWithPendingEntries } from "../lib/current-balance.ts";
import { sharedGoalMonthlySummary } from "../lib/shared-monthly-summary.ts";
import { getTransactionDirection } from "../lib/transaction-display.ts";
const payerAccounts = [
  { id: "shared", kind: "shared", role: "shared" },
  { id: "main-b", kind: "personal", role: "main", ownerUserId: "b" },
  { id: "savings-a", kind: "personal", role: "savings", ownerUserId: "a" },
  { id: "old-main-a", kind: "personal", role: "main", ownerUserId: "a", archived: true },
  { id: "main-a", kind: "personal", role: "main", ownerUserId: "a", archived: false },
];
assert.equal(defaultPersonalPayerAccountId({ kind: "expense", accountId: "shared" }, payerAccounts, "a"), "main-a");
assert.equal(defaultPersonalPayerAccountId({ kind: "expense", accountId: "shared" }, payerAccounts, "b"), "main-b");
assert.equal(defaultPersonalPayerAccountId({ kind: "expense", accountId: "main-a" }, payerAccounts, "a"), null);
assert.equal(defaultPersonalPayerAccountId({ kind: "transfer", accountId: "shared" }, payerAccounts, "a"), null);
assert.equal(defaultPersonalPayerAccountId({ kind: "income", accountId: "shared" }, payerAccounts, "a"), null);
assert.equal(defaultPersonalPayerAccountId({ kind: "expense", accountId: "shared" }, payerAccounts, "unknown"), null);

const now = new Date("2026-10-09T12:00:00Z");
const expense = { id: "purchase", kind: "expense", status: "posted", accountId: "shared",
  destinationAccountId: null, amountMinor: 12000, paymentAccountId: "main-a", personalPayerAccountId: "main-a", createdByUserId: "a",
  currency: "EUR", categoryId: "groceries", note: "Groceries", occurredAt: now.toISOString(),
  reversesTransactionId: null, allocationShares: [] };
const operation = { operationId: "op", deviceId: "a", clientCreatedAt: now.toISOString(),
  type: "transaction.create", payload: { transaction: expense } };
const normalized = sharedOnlyOperations([operation]);
assert.equal(normalized[0].operationId, "op", "preserve deduplication identity of old queued purchases");
assert.equal(normalized[0].payload.transaction.paymentAccountId, null);
assert.equal(normalized[0].payload.transaction.personalPayerAccountId, "main-a", "payer attribution stays attached without creating a debit");
assert.equal(operation.payload.transaction.paymentAccountId, "main-a", "normalization never mutates the saved original");
assert.deepEqual(sharedOnlyOperations(normalized), normalized);
const entries = pendingLedgerTransactions([operation]);
assert.equal(entries.length, 1);
assert.equal(balanceWithPendingEntries(100000, "main-a", entries, now), 100000);
assert.equal(balanceWithPendingEntries(50000, "shared", entries, now), 38000);
assert.equal(balanceWithPendingEntries(80000, "main-b", entries, now), 80000);
assert.equal(projectPurchase({ ...expense, paymentAccountId: null }).length, 1);
const future = pendingLedgerTransactions([{ ...operation, payload: { transaction: { ...expense, occurredAt: "2026-11-01T00:00:00Z" } } }]);
assert.equal(balanceWithPendingEntries(50000, "shared", future, now), 50000);
const transfer = { ...expense, id: "settlement", kind: "transfer", accountId: "main-a", destinationAccountId: "shared", categoryId: "transfer", paymentAccountId: null };
assert.deepEqual(sharedOnlyOperations([{ ...operation, payload: { transaction: transfer } }])[0].payload.transaction, transfer);
assert.equal(isAuditEntry(expense), false);
const funding = { ...transfer, id: "funding", status: "reversed", isAudit: true };
const adjustment = { ...funding, id: "adjustment", kind: "reversal", status: "posted", reversesTransactionId: "funding" };
assert.equal(isAuditEntry(funding), true);
assert.equal(isAuditEntry(adjustment), true);
assert.equal(getTransactionDirection(adjustment, "main-a", [funding, adjustment]), "in");
assert.equal(getTransactionDirection(adjustment, "shared", [funding, adjustment]), "out");
assert.equal(balanceWithPendingEntries(100000, "main-a", [funding, adjustment], now), 100000);
assert.equal(balanceWithPendingEntries(50000, "shared", [funding, adjustment, ...entries], now), 38000);
assert.equal([expense, funding, adjustment].filter((tx) => !isAuditEntry(tx)).length, 1);
const contribution = { id: "mirror", amountMinor: 21000, occurredAt: now.toISOString(), reversedAt: null, returnTransactionId: null };
const goal = { id: "goal", isShared: true, status: "active", targetMinor: 120000, currentMinor: 21000,
  dueDate: "2027-02-01", contributions: [contribution, contribution] };
assert.deepEqual(sharedGoalMonthlySummary([goal], now), { contributionMinor: 21000, planMinor: 30000 });
assert.deepEqual(sharedGoalMonthlySummary([{ ...goal, currentMinor: 30000, contributions: [
  contribution, { ...contribution, id: "future", amountMinor: 9000, occurredAt: "2026-10-20T00:00:00Z" },
] }], now), { contributionMinor: 21000, planMinor: 30000 });
assert.deepEqual(sharedGoalMonthlySummary([{ ...goal, status: "cancelled" }], now), { contributionMinor: 0, planMinor: 0 });
console.log("Shared-only pending purchases, legacy queue normalization, audit visibility/directions and goal bars passed.");
