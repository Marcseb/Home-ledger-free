import { randomUUID } from "node:crypto";
import type { SyncDatabase } from "./sync-database.ts";

type Expense = {
  id: string;
  kind: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  note: string;
  occurredAt: string;
  createdByUserId: string;
};

export function initializeExpenseFunding(db: SyncDatabase) {
  // Additive migration: old archives and existing transactions remain valid.
  db.exec(`CREATE TABLE IF NOT EXISTS shared_expense_funding (
    group_id TEXT NOT NULL,
    expense_transaction_id TEXT PRIMARY KEY,
    funding_transaction_id TEXT NOT NULL UNIQUE
  ); CREATE INDEX IF NOT EXISTS idx_expense_funding_group ON shared_expense_funding(group_id);
  CREATE TABLE IF NOT EXISTS shared_expense_payers (
    group_id TEXT NOT NULL,
    expense_transaction_id TEXT PRIMARY KEY,
    personal_account_id TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_expense_payers_group ON shared_expense_payers(group_id);`);
}

export function personalPayerAccountId(db: SyncDatabase, groupId: string, expenseId: string) {
  return (db.prepare(`SELECT personal_account_id FROM shared_expense_payers
    WHERE group_id=? AND expense_transaction_id=?`).get(groupId, expenseId) as
    { personal_account_id: string } | undefined)?.personal_account_id ?? null;
}

export function validatePersonalPayerAccount(
  db: SyncDatabase,
  groupId: string,
  ownerUserId: string,
  expense: Pick<Expense, "kind" | "accountId" | "currency">,
  payerAccountId: string | null | undefined,
) {
  if (!payerAccountId) return;
  if (expense.kind !== "expense") throw new Error("Only Shared expenses can record a personal payer");
  const shared = db.prepare("SELECT kind FROM accounts WHERE id=? AND group_id=?")
    .get(expense.accountId, groupId) as { kind: string } | undefined;
  const payer = db.prepare(`SELECT kind,owner_user_id,currency,archived_at FROM accounts
    WHERE id=? AND group_id=?`).get(payerAccountId, groupId) as
    { kind: string; owner_user_id: string | null; currency: string; archived_at: string | null } | undefined;
  if (shared?.kind !== "shared" || !payer || payer.kind !== "personal"
    || payer.owner_user_id !== ownerUserId || payer.currency !== expense.currency || payer.archived_at) {
    throw new Error("Choose your own active personal account for this Shared expense");
  }
}

export function setPersonalPayerAccountId(
  db: SyncDatabase, groupId: string, expenseId: string, payerAccountId: string | null | undefined,
) {
  db.prepare("DELETE FROM shared_expense_payers WHERE group_id=? AND expense_transaction_id=?")
    .run(groupId, expenseId);
  if (payerAccountId) {
    db.prepare("INSERT INTO shared_expense_payers(group_id,expense_transaction_id,personal_account_id) VALUES(?,?,?)")
      .run(groupId, expenseId, payerAccountId);
  }
}

export function expenseFunding(db: SyncDatabase, groupId: string, expenseId: string) {
  return db.prepare(`SELECT t.* FROM shared_expense_funding f
    JOIN transactions t ON t.id=f.funding_transaction_id AND t.group_id=f.group_id
    WHERE f.group_id=? AND f.expense_transaction_id=? AND t.status='posted'`).get(groupId, expenseId) as
    { id: string; account_id: string; destination_account_id: string; status: string } | undefined;
}

export function fundedExpenseId(db: SyncDatabase, groupId: string, fundingId: string) {
  return (db.prepare(`SELECT expense_transaction_id FROM shared_expense_funding
    WHERE group_id=? AND funding_transaction_id=?`).get(groupId, fundingId) as
    { expense_transaction_id: string } | undefined)?.expense_transaction_id;
}

export function validateExpensePayment(
  db: SyncDatabase, groupId: string, ownerUserId: string, expense: Pick<Expense, "kind" | "accountId" | "currency">,
  paymentAccountId: string | null | undefined,
) {
  if (paymentAccountId === null || paymentAccountId === undefined) return;
  throw new Error("Paid from is no longer supported. Update the mobile app and record the purchase against Shared; record settlement separately.");
}

/** Retire only automatic purchase funding, not ordinary transfers or goal contributions.
 * All entries retain their original ledger date; the audit records when this adjustment ran.
 * The original transfer and its inverse remain in history and backups. */
export function retireExpenseFunding(db: SyncDatabase, adjustedAt: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const funding = db.prepare(`SELECT t.*, f.expense_transaction_id,
        e.account_id AS expense_account_id, e.kind AS expense_kind
      FROM shared_expense_funding f
      JOIN transactions t ON t.id=f.funding_transaction_id AND t.group_id=f.group_id
      LEFT JOIN transactions e ON e.id=f.expense_transaction_id AND e.group_id=f.group_id
      WHERE t.status='posted'
      ORDER BY f.group_id,f.expense_transaction_id`).all() as Array<{
        id: string; group_id: string; account_id: string; destination_account_id: string;
        amount_minor: number; currency: string; occurred_at: string; created_by_user_id: string;
        kind: string; status: string; expense_transaction_id: string; expense_account_id: string; expense_kind: string;
      }>;
    let adjusted = 0;
    for (const original of funding) {
      if (original.kind !== "transfer" || original.expense_kind !== "expense"
        || original.destination_account_id !== original.expense_account_id) {
        throw new Error("Cannot retire inconsistent automatic purchase funding");
      }
      const reversalId = `${original.id}:shared-only`;
      const operationId = `shared-only:${original.group_id}:${original.id}`;
      db.prepare("UPDATE transactions SET status='reversed' WHERE id=? AND group_id=? AND status='posted'")
        .run(original.id, original.group_id);
      db.prepare(`INSERT INTO transactions(
        id,group_id,kind,account_id,destination_account_id,amount_minor,currency,category_id,note,
        occurred_at,created_by_user_id,status,reverses_transaction_id,operation_id
      ) VALUES(?,?,'reversal',?,?,?,?, 'transfer',?,?,?,'posted',?,?)`).run(
        reversalId, original.group_id, original.account_id, original.destination_account_id,
        original.amount_minor, original.currency, "Personal funding adjustment — purchase charged to Shared",
        original.occurred_at, original.created_by_user_id, original.id, operationId,
      );
      db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,?,?)")
        .run(original.group_id, operationId, "transaction.reverse", reversalId, adjustedAt);
      db.prepare("INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)").run(
        randomUUID(), original.group_id, null, null, "shared-expense.funding-retired", "transaction",
        original.expense_transaction_id, JSON.stringify({
          fundingTransactionId: original.id, adjustmentTransactionId: reversalId,
          amountMinor: original.amount_minor, ledgerDate: original.occurred_at, policy: "shared-only",
        }), adjustedAt,
      );
      adjusted++;
    }
    db.exec("COMMIT");
    return adjusted;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Compatibility shim: new server versions never create automatic funding. */
export function insertExpenseFunding(
  db: SyncDatabase, groupId: string, expense: Expense, operationId: string, paymentAccountId: string | null | undefined,
) {
  if (!paymentAccountId) return null;
  validateExpensePayment(db, groupId, expense.createdByUserId, expense, paymentAccountId);
  return null;
}
