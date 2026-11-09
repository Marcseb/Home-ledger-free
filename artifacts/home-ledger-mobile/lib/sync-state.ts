import type { HouseholdState, SyncOperation } from '@workspace/api-client-react';
import { pendingLedgerTransactions } from './shared-expense';

/** Call after the last snapshot request, using the live queue, without awaiting before applying. */
export function reconcileSyncSnapshot(
  latestState: HouseholdState,
  liveOutbox: readonly SyncOperation[],
  completed: ReadonlySet<string>,
) {
  const remaining = liveOutbox.filter((operation) => !completed.has(operation.operationId));
  const transactions = new Map(latestState.transactions.map((transaction) => [transaction.id, transaction]));
  pendingLedgerTransactions(remaining).forEach((transaction) => transactions.set(transaction.id, transaction));
  return {
    remaining,
    nextState: {
      ...latestState,
      transactions: [...transactions.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    },
  };
}
