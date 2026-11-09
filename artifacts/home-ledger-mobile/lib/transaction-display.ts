import type { Account, Transaction, User } from '@workspace/api-client-react';

export type TransactionDirection = 'in' | 'out';

export function getTransactionDirection(transaction: Transaction, accountId?: string, transactions: readonly Transaction[] = []): TransactionDirection {
  if (transaction.kind === 'reversal' && transaction.reversesTransactionId) {
    const original = transactions.find((item) => item.id === transaction.reversesTransactionId);
    if (original && original.kind !== 'reversal') return getTransactionDirection(original, accountId) === 'in' ? 'out' : 'in';
  }
  if (transaction.kind === 'income' || transaction.kind === 'reversal') return 'in';
  if (transaction.kind === 'expense') return 'out';
  return accountId && transaction.destinationAccountId === accountId ? 'in' : 'out';
}

export function getTransactionOwnerName(transaction: Transaction, accounts: Account[], users: User[]): string | undefined {
  const sourceAccount = accounts.find((account) => account.id === transaction.accountId);
  const ownerId = sourceAccount?.ownerUserId ?? transaction.createdByUserId;
  return users.find((user) => user.id === ownerId)?.displayName;
}

export function formatTransactionDate(occurredAt: string, locale?: string): string {
  return new Date(occurredAt).toLocaleDateString(locale, { timeZone: 'UTC' });
}

export function formatTransactionDateInput(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseTransactionDateInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.toISOString();
}