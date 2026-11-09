import type { SyncOperation, Transaction } from '@workspace/api-client-react';

/** The sole linked personal account is Main; savings and other users never qualify. */
export function defaultPersonalPayerAccountId(
  transaction: Pick<Transaction, 'kind' | 'accountId'>,
  accounts: readonly {
    id: string; kind: string; role?: string; ownerUserId?: string | null; archived?: boolean;
  }[],
  userId: string,
): string | null {
  if (transaction.kind !== 'expense'
    || !accounts.some((account) => account.id === transaction.accountId && account.kind === 'shared')) return null;
  return accounts.find((account) => account.kind === 'personal' && account.role === 'main'
    && account.ownerUserId === userId && !account.archived)?.id ?? null;
}

/** Legacy funding fields are discarded; personal payer attribution never changes ledger balances. */
export function projectPurchase(transaction: Transaction): Transaction[] {
  return [transaction.kind === 'expense'
    ? { ...transaction, paymentAccountId: null, fundingTransactionId: null } : transaction];
}

export function sharedOnlyOperations(operations: readonly SyncOperation[]): SyncOperation[] {
  return operations.map((operation) => operation.type === 'transaction.create' && 'transaction' in operation.payload
    ? { ...operation, payload: { transaction: projectPurchase(operation.payload.transaction)[0] } } : operation);
}

export function isAuditEntry(transaction: Transaction) {
  return Boolean(transaction.isAudit || transaction.linkedExpenseTransactionId
    || transaction.kind === 'reversal' || transaction.status === 'reversed');
}

export function pendingLedgerTransactions(operations: readonly SyncOperation[]): Transaction[] {
  return operations.flatMap((operation) =>
    operation.type === 'transaction.create' && 'transaction' in operation.payload
      ? projectPurchase(operation.payload.transaction) : []);
}

export function managedPurchase(transaction: Transaction, transactions: readonly Transaction[]): Transaction {
  return transaction.linkedExpenseTransactionId
    ? transactions.find((item) => item.id === transaction.linkedExpenseTransactionId) ?? transaction
    : transaction;
}
