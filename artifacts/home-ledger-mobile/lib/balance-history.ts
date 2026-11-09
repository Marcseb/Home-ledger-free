export type HistoryInterval = 'day' | 'week' | 'month';

export type HistoryAccount = {
  id: string;
  name: string;
  balanceMinor: number;
};

export type HistoryTransaction = {
  kind: 'income' | 'expense' | 'transfer' | 'reversal';
  accountId: string;
  destinationAccountId?: string | null;
  amountMinor: number;
  occurredAt: string;
  status: 'posted' | 'reversed';
};

export type BalanceHistoryPoint = {
  startDate: string;
  endDate: string;
  closingAt: string;
  currentPeriod: boolean;
  unverifiedStart: boolean;
  balances: Record<string, number>;
  totalMinor: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS: Record<HistoryInterval, number> = { day: 30, week: 12, month: 12 };
const utcLedgerDate = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);

function periodStart(time: number, interval: HistoryInterval): number {
  const date = new Date(time);
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (interval === 'day') return day;
  if (interval === 'week') return day - ((date.getUTCDay() + 6) % 7) * DAY_MS;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function shiftPeriod(start: number, interval: HistoryInterval, offset: number): number {
  if (interval === 'day') return start + offset * DAY_MS;
  if (interval === 'week') return start + offset * 7 * DAY_MS;
  const date = new Date(start);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1);
}

function transactionChanges(transaction: HistoryTransaction, balances: Map<string, number>, factor: number): void {
  const change = transaction.amountMinor * factor;
  if (transaction.kind === 'income' && balances.has(transaction.accountId)) {
    balances.set(transaction.accountId, balances.get(transaction.accountId)! + change);
  } else if (transaction.kind === 'expense' && balances.has(transaction.accountId)) {
    balances.set(transaction.accountId, balances.get(transaction.accountId)! - change);
  } else if (transaction.kind === 'transfer') {
    if (balances.has(transaction.accountId)) {
      balances.set(transaction.accountId, balances.get(transaction.accountId)! - change);
    }
    if (transaction.destinationAccountId && balances.has(transaction.destinationAccountId)) {
      balances.set(transaction.destinationAccountId, balances.get(transaction.destinationAccountId)! + change);
    }
  }
}

/**
 * Restates each period's closing balance from the current authoritative account
 * balances and the ledger's posted economic entries. Corrections/cancellations
 * have already marked their originals reversed; reversal rows never affect
 * balances. Current balances exclude future ledger dates, and history uses the
 * same date-only cutoff. Weeks begin on Monday and boundaries use UTC.
 */
export function buildBalanceHistory(
  accounts: HistoryAccount[],
  transactions: HistoryTransaction[],
  interval: HistoryInterval,
  now: Date,
): BalanceHistoryPoint[] {
  if (!accounts.length) return [];
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Invalid balance history date');
  const currentDate = utcLedgerDate(now);

  const balances = new Map(accounts.map((account) => [account.id, account.balanceMinor]));
  const posted = transactions
    .filter((transaction) => transaction.status === 'posted' && transaction.kind !== 'reversal')
    .filter((transaction) => balances.has(transaction.accountId)
      || (transaction.destinationAccountId ? balances.has(transaction.destinationAccountId) : false))
    .map((transaction) => {
      const at = Date.parse(transaction.occurredAt);
      if (!Number.isFinite(at)) throw new Error('Invalid transaction date in balance history');
      return { transaction, at, ledgerDate: utcLedgerDate(transaction.occurredAt) };
    })
    .filter(({ ledgerDate }) => ledgerDate <= currentDate)
    .sort((a, b) => a.at - b.at);
  const firstActivity = new Map(accounts.map((account) => [account.id, Number.POSITIVE_INFINITY]));
  posted.forEach(({ transaction, at }) => {
    if (firstActivity.has(transaction.accountId)) {
      firstActivity.set(transaction.accountId, Math.min(firstActivity.get(transaction.accountId)!, at));
    }
    if (transaction.kind === 'transfer' && transaction.destinationAccountId && firstActivity.has(transaction.destinationAccountId)) {
      firstActivity.set(transaction.destinationAccountId, Math.min(firstActivity.get(transaction.destinationAccountId)!, at));
    }
  });

  // The authoritative balance already excludes future dates. Only subtract
  // entries effective by today, otherwise future money would be removed twice.
  posted.forEach(({ transaction }) => transactionChanges(transaction, balances, -1));

  const currentStart = periodStart(nowMs, interval);
  const count = PERIODS[interval];
  let cursor = 0;
  return Array.from({ length: count }, (_, index) => {
    const start = shiftPeriod(currentStart, interval, index - count + 1);
    const end = shiftPeriod(start, interval, 1) - 1;
    const cutoff = Math.min(end, nowMs);
    const cutoffDate = utcLedgerDate(new Date(cutoff));
    while (cursor < posted.length && posted[cursor].ledgerDate <= cutoffDate) {
      transactionChanges(posted[cursor].transaction, balances, 1);
      cursor += 1;
    }
    const closing = Object.fromEntries(balances);
    return {
      startDate: new Date(start).toISOString().slice(0, 10),
      endDate: new Date(end).toISOString().slice(0, 10),
      closingAt: new Date(cutoff).toISOString(),
      currentPeriod: index === count - 1,
      // A current balance is known, but there is no account creation date in
      // the API to prove the account existed before its first recorded entry.
      unverifiedStart: index !== count - 1 && accounts.some((account) => cutoff < firstActivity.get(account.id)!),
      balances: closing,
      totalMinor: Object.values(closing).reduce((sum, amount) => sum + amount, 0),
    };
  });
}