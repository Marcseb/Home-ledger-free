import type { Transaction } from '@workspace/api-client-react';

export function sumExpenseSharesByMember(
  transactions: readonly Pick<Transaction, 'kind' | 'allocationShares'>[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.kind !== 'expense') continue;
    for (const share of transaction.allocationShares) {
      totals.set(share.userId, (totals.get(share.userId) ?? 0) + share.amountMinor);
    }
  }
  return totals;
}

export function sumPostedExpenseAmounts(
  transactions: readonly Pick<Transaction, 'kind' | 'status' | 'amountMinor'>[],
): number {
  return transactions.reduce(
    (total, transaction) => transaction.status === 'posted' && transaction.kind === 'expense'
      ? total + transaction.amountMinor
      : total,
    0,
  );
}

export function sumPostedExpenseSharesByMember(
  transactions: readonly Pick<Transaction, 'kind' | 'status' | 'allocationShares'>[],
): Map<string, number> {
  return sumExpenseSharesByMember(transactions.filter((transaction) => transaction.status === 'posted'));
}

export function sumExpenseAmountsByEntryCreator(
  transactions: readonly Pick<Transaction, 'kind' | 'createdByUserId' | 'amountMinor'>[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.kind !== 'expense') continue;
    totals.set(
      transaction.createdByUserId,
      (totals.get(transaction.createdByUserId) ?? 0) + transaction.amountMinor,
    );
  }
  return totals;
}

export function sumPostedExpenseAmountsByEntryCreator(
  transactions: readonly Pick<Transaction, 'kind' | 'status' | 'createdByUserId' | 'amountMinor'>[],
): Map<string, number> {
  return sumExpenseAmountsByEntryCreator(
    transactions.filter((transaction) => transaction.status === 'posted'),
  );
}