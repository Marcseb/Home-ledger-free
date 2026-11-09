import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { retireExpenseFunding } from "../src/lib/shared-expense-funding.ts";
import { inviteHouseholdMember } from "./invitation-test-helpers.mjs";

const directory = await mkdtemp(join(tmpdir(), "home-ledger-shared-only-"));
process.env.NODE_ENV = "test";
process.env.APP_VARIANT = "accelerated-test";
process.env.BUDGET_DB_PATH = join(directory, "ledger.sqlite");
process.env.BUDGET_BACKUP_DIR = join(directory, "backups");
process.env.XDG_CONFIG_HOME = join(directory, "config");
let database;
try {
  const store = await import("../src/lib/budget-store.ts");
  const a = store.setupHousehold({ householdName: "Adjustment tests", displayName: "A", currency: "EUR", deviceId: "a", deviceName: "A phone" });
  const b = inviteHouseholdMember(store, a, "a", "B", "b", "B phone");
  const group = a.state.groupId;
  store.resetLedger(group, a.user.id, "a");
  const mainA = store.getState(group, a.user.id).accounts.find((x) => x.role === "main").id;
  const mainB = store.getState(group, b.user.id).accounts.find((x) => x.role === "main").id;
  const shared = store.getState(group, a.user.id).accounts.find((x) => x.kind === "shared").id;
  const categoryId = store.createCategory(group, a.user.id, "a", { name: "Groceries", scope: "shared", color: "#123456" })
    .categories.find((x) => x.name === "Groceries").id;
  const today = new Date().toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  const create = (user, accountId, amountMinor, extra = {}) => {
    const tx = { id: randomUUID(), kind: "expense", accountId, destinationAccountId: null, amountMinor,
      currency: "EUR", categoryId, note: "Purchase", occurredAt: today, createdByUserId: user.id,
      status: "posted", reversesTransactionId: null, allocationShares: [], ...extra };
    const operation = { operationId: randomUUID(), deviceId: user.id, clientCreatedAt: today, type: "transaction.create", payload: { transaction: tx } };
    return { tx, operation, result: store.sync(group, user.id, user.id, 0, [operation]) };
  };
  const apply = (x) => assert.equal(x.result.acknowledgements[0].status, "applied", JSON.stringify(x.result.acknowledgements));
  const balances = () => [
    store.getState(group, a.user.id).accounts.find((x) => x.id === mainA).balanceMinor,
    store.getState(group, b.user.id).accounts.find((x) => x.id === mainB).balanceMinor,
    store.getState(group, a.user.id).accounts.find((x) => x.id === shared).balanceMinor,
  ];
  apply(create(a.user, mainA, 100000, { kind: "income", categoryId: "income" }));
  apply(create(b.user, mainB, 80000, { kind: "income", categoryId: "income" }));
  apply(create(a.user, shared, 50000, { kind: "income", categoryId: "income" }));
  database = new DatabaseSync(process.env.BUDGET_DB_PATH);
  const legacy = (user, source, amount, date = today, id = randomUUID()) => {
    const x = create(user, shared, amount, { occurredAt: date, id });
    apply(x);
    database.prepare(`INSERT INTO transactions VALUES(?,?,'transfer',?,?,?,?, 'transfer',?,?,?,'posted',NULL,?)`)
      .run(`${x.tx.id}:funding`, group, source, shared, amount, "EUR", "Old automatic funding", date, user.id, randomUUID());
    database.prepare("INSERT INTO shared_expense_funding VALUES(?,?,?)").run(group, x.tx.id, `${x.tx.id}:funding`);
    return x;
  };
  const first = legacy(a.user, mainA, 12000);
  const second = legacy(b.user, mainB, 9000);
  const scheduled = legacy(a.user, mainA, 70000, future);
  const cancelled = legacy(a.user, mainA, 4000);
  store.cancelTransaction(group, a.user.id, "a", cancelled.tx.id, { operationId: randomUUID() });
  const settlement = create(a.user, mainA, 2000, { kind: "transfer", destinationAccountId: shared, categoryId: "transfer", note: "Monthly settlement" });
  apply(settlement);
  assert.deepEqual(balances(), [86000, 71000, 52000]);
  const shares = store.getState(group, a.user.id).transactions.find((x) => x.id === first.tx.id).allocationShares;
  const monthlyExpenses = store.dashboard(group, a.user.id).monthExpenseMinor;
  const startupCopy = join(directory, "startup.sqlite");
  database.exec(`VACUUM INTO '${startupCopy}'`);
  const verifyStartup = (path) => {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
      `import assert from 'node:assert/strict'; const s=await import(${JSON.stringify(new URL("../src/lib/budget-store.ts", import.meta.url).href)});
       const state=s.getState(${JSON.stringify(group)},${JSON.stringify(a.user.id)});
       assert.equal(state.accounts.find(x=>x.id===${JSON.stringify(mainA)}).balanceMinor,98000);
       assert.equal(state.accounts.find(x=>x.id===${JSON.stringify(shared)}).balanceMinor,31000);
       assert.equal(state.transactions.find(x=>x.id===${JSON.stringify(first.tx.id)}).paymentAccountId,null);`],
      { env: { ...process.env, BUDGET_DB_PATH: path }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  verifyStartup(startupCopy);
  assert.equal(retireExpenseFunding(database, today), 3);
  assert.deepEqual(balances(), [98000, 80000, 31000]);
  assert.equal(retireExpenseFunding(database, today), 0, "no double credit on retry");
  verifyStartup(process.env.BUDGET_DB_PATH);
  const state = store.getState(group, a.user.id);
  const expense = state.transactions.find((x) => x.id === first.tx.id);
  assert.equal(expense.status, "posted");
  assert.equal(expense.paymentAccountId, null);
  assert.deepEqual(expense.allocationShares, shares);
  assert.equal(store.dashboard(group, a.user.id).monthExpenseMinor, monthlyExpenses, "bars retain the real purchases exactly once");
  assert.equal(state.transactions.find((x) => x.id === settlement.tx.id).status, "posted", "ordinary settlement is untouched");
  const audits = state.transactions.filter((x) => x.isAudit);
  assert.ok(audits.length >= 6);
  const memberAdjustment = audits.find((x) => x.auditRelatedTransactionId === second.tx.id && x.kind === "reversal");
  assert.equal(memberAdjustment.accountId, "hidden-personal-account", "private source remains concealed");
  for (const entry of audits) {
    assert.throws(() => store.cancelTransaction(group, a.user.id, "a", entry.id, { operationId: randomUUID() }), /read-only/);
    assert.throws(() => store.correctTransaction(group, a.user.id, "a", entry.id,
      { operationId: randomUUID(), amountMinor: 100, categoryId: "transfer", note: "Changed" }), /read-only/);
    const reverse = store.sync(group, a.user.id, "a", 0, [{
      operationId: randomUUID(), deviceId: "a", clientCreatedAt: today, type: "transaction.reverse",
      payload: { transactionId: entry.id, reversalId: randomUUID(), occurredAt: today },
    }]);
    assert.equal(reverse.acknowledgements[0].status, "rejected");
  }
  assert.equal(create(a.user, shared, 100, { paymentAccountId: mainA }).result.acknowledgements[0].status, "rejected");
  const next = create(a.user, shared, 500);
  apply(next);
  assert.deepEqual(balances(), [98000, 80000, 30500]);
  assert.equal(store.sync(group, a.user.id, "a", 0, [next.operation]).acknowledgements[0].status, "duplicate");
  store.correctTransaction(group, a.user.id, "a", first.tx.id,
    { operationId: randomUUID(), amountMinor: 10000, categoryId, note: "Corrected purchase", paymentAccountId: null });
  assert.deepEqual(balances(), [98000, 80000, 32500], "correction no longer affects Main");
  store.cancelTransaction(group, b.user.id, "b", second.tx.id, { operationId: randomUUID() });
  assert.deepEqual(balances(), [98000, 80000, 41500], "cancellation restores only Shared");
  store.advanceBusinessClock("day");
  assert.deepEqual(balances(), [98000, 80000, -28500], "future purchase reaches Shared, never Main, on its date");
  assert.equal(database.prepare("SELECT count(*) AS n FROM audit_events WHERE action='shared-expense.funding-retired'").get().n, 3);
  const later = new Date(Date.now() + 3 * 86400000).toISOString();
  const earlyCancelledFunding = legacy(a.user, mainA, 70000, later);
  const oldFundingId = `${earlyCancelledFunding.tx.id}:funding`;
  database.prepare("UPDATE transactions SET status='reversed' WHERE id=?").run(oldFundingId);
  database.prepare("INSERT INTO transactions VALUES(?,?,'reversal',?,?,?,?, 'transfer',?,?,?,'posted',?,?)")
    .run(randomUUID(), group, mainA, shared, 70000, "EUR", "Old early cancellation", today, a.user.id, oldFundingId, randomUUID());
  assert.deepEqual(balances(), [98000, 80000, -28500], "an early reversal waits for the original entry's date");
  assert.equal(retireExpenseFunding(database, today), 0, "an already neutral future cancellation is not credited twice");
  const lateCancelledFunding = legacy(a.user, mainA, 70000, today);
  const lateFundingId = `${lateCancelledFunding.tx.id}:funding`;
  database.prepare("UPDATE transactions SET status='reversed' WHERE id=?").run(lateFundingId);
  database.prepare("INSERT INTO transactions VALUES(?,?,'reversal',?,?,?,?, 'transfer',?,?,?,'posted',?,?)")
    .run(randomUUID(), group, mainA, shared, 70000, "EUR", "Old late cancellation", later, a.user.id, lateFundingId, randomUUID());
  assert.deepEqual(balances(), [98000, 80000, -98500], "reversed funding is already excluded, regardless of its audit counter-entry's date");
  assert.equal(retireExpenseFunding(database, today), 0);
  const validPending = legacy(a.user, mainA, 100, today, "atomic-a-valid");
  const invalidPending = legacy(a.user, mainA, 100, today, "atomic-b-invalid");
  database.prepare("UPDATE transactions SET destination_account_id=? WHERE id=?")
    .run(mainB, `${invalidPending.tx.id}:funding`);
  const beforeAtomicFailure = balances();
  const beforeAuditCount = database.prepare("SELECT count(*) AS n FROM audit_events").get().n;
  assert.throws(() => retireExpenseFunding(database, today), /inconsistent/);
  assert.deepEqual(balances(), beforeAtomicFailure, "a failed batch never credits half the household");
  assert.equal(database.prepare("SELECT status FROM transactions WHERE id=?").get(`${validPending.tx.id}:funding`).status, "posted");
  assert.equal(database.prepare("SELECT count(*) AS n FROM audit_events").get().n, beforeAuditCount);
  console.log("Audited Shared-only adjustment passed: startup, repeat safety, cancelled/future purchases, privacy, read-only audit, queues and purchase lifecycle.");
  const beforePayerPurchase = balances();
  const beforePayerExpenseTotal = store.dashboard(group, a.user.id).monthExpenseMinor;
  const personallyPaid = create(a.user, shared, 1000, { personalPayerAccountId: mainA });
  apply(personallyPaid);
  assert.deepEqual(balances(), [beforePayerPurchase[0], beforePayerPurchase[1], beforePayerPurchase[2] - 1000],
    "payer attribution changes Shared only; it does not debit Personal");
  assert.equal(store.dashboard(group, a.user.id).monthExpenseMinor, beforePayerExpenseTotal + 1000,
    "the Shared purchase is counted once");
  assert.equal(store.getState(group, a.user.id).transactions.find((x) => x.id === personallyPaid.tx.id).personalPayerAccountId, mainA);
  assert.equal(store.getState(group, b.user.id).transactions.find((x) => x.id === personallyPaid.tx.id).personalPayerAccountId,
    "hidden-personal-account", "another member cannot identify the payer's personal account");
  assert.equal(create(a.user, shared, 1000, { personalPayerAccountId: mainB }).result.acknowledgements[0].status, "rejected",
    "a user cannot attribute a purchase to another member's personal account");
  const corrected = store.correctTransaction(group, a.user.id, "a", personallyPaid.tx.id, {
    operationId: randomUUID(), amountMinor: 800, categoryId, note: "Corrected personally paid purchase",
    personalPayerAccountId: mainA,
  });
  assert.equal(corrected.accounts.find((x) => x.id === mainA).balanceMinor, beforePayerPurchase[0]);
  assert.equal(corrected.accounts.find((x) => x.id === shared).balanceMinor, beforePayerPurchase[2] - 800);
  const replacement = corrected.transactions.find((x) => x.note === "Corrected personally paid purchase");
  assert.equal(replacement.personalPayerAccountId, mainA, "corrections retain payer attribution");
  const cancelledPayerPurchase = store.cancelTransaction(group, a.user.id, "a", replacement.id, { operationId: randomUUID() });
  assert.equal(cancelledPayerPurchase.accounts.find((x) => x.id === mainA).balanceMinor, beforePayerPurchase[0]);
  assert.equal(cancelledPayerPurchase.accounts.find((x) => x.id === shared).balanceMinor, beforePayerPurchase[2]);
} finally { database?.close(); await rm(directory, { recursive: true, force: true }); }
