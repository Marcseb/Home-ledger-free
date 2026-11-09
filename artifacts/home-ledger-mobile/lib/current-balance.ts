import type { HistoryTransaction } from './balance-history';

/** Financial schedules and activity use UTC ledger days, not appointment times. */
export function utcLedgerDate(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

export function isFutureLedgerEntry(occurredAt: string, now: Date): boolean {
  return utcLedgerDate(occurredAt) > utcLedgerDate(now);
}

export function balanceWithPendingEntries(
  balanceMinor: number, accountId: string, pending: HistoryTransaction[], now: Date,
): number {
  return pending.reduce((sum, entry) => {
    if (entry.status !== 'posted' || entry.kind === 'reversal' || isFutureLedgerEntry(entry.occurredAt, now)) return sum;
    if (entry.kind === 'income' && entry.accountId === accountId) return sum + entry.amountMinor;
    if (entry.kind === 'expense' && entry.accountId === accountId) return sum - entry.amountMinor;
    if (entry.kind === 'transfer') {
      if (entry.accountId === accountId) return sum - entry.amountMinor;
      if (entry.destinationAccountId === accountId) return sum + entry.amountMinor;
    }
    return sum;
  }, balanceMinor);
}
