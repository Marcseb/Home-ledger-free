import type { Transaction } from '@workspace/api-client-react';

type IncomeTransaction = Pick<Transaction,
  'kind' | 'status' | 'accountId' | 'destinationAccountId' | 'createdByUserId' | 'amountMinor' | 'linkedExpenseTransactionId'
>;

export function isSharedIncomeInflow(
  transaction: Pick<IncomeTransaction, 'kind' | 'status' | 'accountId' | 'destinationAccountId' | 'linkedExpenseTransactionId'>,
  sharedAccountIds: ReadonlySet<string>,
): boolean {
  if (transaction.status !== 'posted') return false;
  if (transaction.linkedExpenseTransactionId) return false; // Purchase funding is not an additional income/contribution.
  if (transaction.kind === 'income') return sharedAccountIds.has(transaction.accountId);
  // All Shared accounts are visible. A source outside this set is personal,
  // including a source concealed by the API for another member's privacy.
  return transaction.kind === 'transfer'
    && Boolean(transaction.destinationAccountId && sharedAccountIds.has(transaction.destinationAccountId))
    && !sharedAccountIds.has(transaction.accountId);
}

export function sumSharedIncomeByMember(
  transactions: readonly IncomeTransaction[],
  sharedAccountIds: ReadonlySet<string>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (!isSharedIncomeInflow(transaction, sharedAccountIds)) continue;
    // The server requires personal-account transfers to be created by their
    // owner, so the contributor remains identifiable even with a hidden source.
    totals.set(
      transaction.createdByUserId,
      (totals.get(transaction.createdByUserId) ?? 0) + transaction.amountMinor,
    );
  }
  return totals;
}