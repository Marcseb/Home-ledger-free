import type { Transaction } from '@workspace/api-client-react';

export type PersonalBankEstimate = {
  balanceMinor: number;
  allocationsMinor: number;
  sharedPurchasesMinor: number;
  estimateMinor: number;
};

export function personalBankEstimate(input: {
  accounts: Array<{ id: string; balanceMinor: number }>;
  sharedAccountIds: ReadonlySet<string>;
  transactions: readonly Transaction[];
  asOfDate: string;
}): PersonalBankEstimate {
  const selected = new Map(input.accounts.map((account) => [account.id, account]));
  const personalAccountIds = new Set(selected.keys());
  const eligible = input.transactions.filter((transaction) =>
    transaction.status === 'posted' && transaction.occurredAt.slice(0, 10) <= input.asOfDate,
  );
  const allocationsMinor = eligible.reduce((sum, transaction) =>
    transaction.kind === 'transfer'
      && personalAccountIds.has(transaction.accountId)
      && Boolean(transaction.destinationAccountId && input.sharedAccountIds.has(transaction.destinationAccountId))
      ? sum + transaction.amountMinor : sum, 0);
  const sharedPurchasesMinor = eligible.reduce((sum, transaction) =>
    transaction.kind === 'expense'
      && input.sharedAccountIds.has(transaction.accountId)
      && Boolean(transaction.personalPayerAccountId && personalAccountIds.has(transaction.personalPayerAccountId))
      ? sum + transaction.amountMinor : sum, 0);
  const balanceMinor = [...selected.values()].reduce((sum, account) => sum + account.balanceMinor, 0);
  return {
    balanceMinor,
    allocationsMinor,
    sharedPurchasesMinor,
    estimateMinor: balanceMinor + allocationsMinor - sharedPurchasesMinor,
  };
}
