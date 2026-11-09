import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBalanceHistory } from './balance-history.ts';

const now = new Date('2026-09-26T12:00:00.000Z');
const entry = (kind, accountId, amountMinor, occurredAt, extra = {}) => ({
  kind, accountId, amountMinor, occurredAt, status: 'posted', ...extra,
});

test('daily closing balances carry forward and internal transfers preserve the aggregate', () => {
  const accounts = [
    { id: 'main', name: 'Main', balanceMinor: 5000 },
    { id: 'savings', name: 'Savings', balanceMinor: 2000 },
  ];
  const transactions = [
    entry('expense', 'savings', 500, '2026-09-22T09:00:00Z'),
    entry('transfer', 'main', 1000, '2026-09-08T11:00:00Z', { destinationAccountId: 'savings' }),
    entry('income', 'main', 3000, '2026-09-01T07:00:00Z'),
  ];
  const points = buildBalanceHistory(accounts, transactions, 'day', now);
  assert.equal(points.length, 30);
  assert.deepEqual(points.find((point) => point.startDate === '2026-08-28')?.balances, { main: 3000, savings: 1500 });
  assert.equal(points.find((point) => point.startDate === '2026-08-28')?.unverifiedStart, true);
  assert.deepEqual(points.find((point) => point.startDate === '2026-09-01')?.balances, { main: 6000, savings: 1500 });
  assert.deepEqual(points.find((point) => point.startDate === '2026-09-08')?.balances, { main: 5000, savings: 2500 });
  assert.equal(points.find((point) => point.startDate === '2026-09-08')?.totalMinor, 7500);
  assert.deepEqual(points.at(-1)?.balances, { main: 5000, savings: 2000 });
  assert.equal(points.at(-1)?.unverifiedStart, false);
});

test('reversed originals and reversal rows never change history; replacements use their own date', () => {
  const points = buildBalanceHistory(
    [{ id: 'main', name: 'Main', balanceMinor: 4300 }],
    [
      entry('income', 'main', 3000, '2026-09-01T07:00:00Z'),
      entry('expense', 'main', 1000, '2026-09-03T07:00:00Z', { status: 'reversed' }),
      entry('reversal', 'main', 1000, '2026-09-20T07:00:00Z'),
      entry('expense', 'main', 700, '2026-09-20T07:00:00Z'),
      entry('transfer', 'other-user-account', 400, '2026-09-22T07:00:00Z'),
    ],
    'day',
    now,
  );
  assert.equal(points.find((point) => point.startDate === '2026-09-03')?.totalMinor, 5000);
  assert.equal(points.find((point) => point.startDate === '2026-09-20')?.totalMinor, 4300);
});

test('a future-dated posted entry is excluded until its period while the opening remains correct', () => {
  const points = buildBalanceHistory(
    [{ id: 'main', name: 'Main', balanceMinor: 5000 }],
    [entry('income', 'main', 1000, '2026-10-01T00:00:00Z')],
    'month',
    now,
  );
  assert.equal(points.at(-1)?.totalMinor, 5000);
  assert.equal(points.at(-1)?.startDate, '2026-09-01');
  assert.equal(points.at(-1)?.currentPeriod, true);
});

test('current closing includes later times on today’s UTC ledger date', () => {
  const points = buildBalanceHistory(
    [{ id: 'savings', name: 'Savings', balanceMinor: 82790 }],
    [entry('transfer', 'main', 70000, '2026-09-26T23:59:00Z', { destinationAccountId: 'savings' })],
    'day',
    now,
  );
  assert.equal(points.at(-1).totalMinor, 82790);
  assert.equal(points.at(-2).totalMinor, 12790);
});

test('future transfer is not removed twice and takes effect on its UTC date in every interval', () => {
  const future = entry('transfer', 'main', 70000, '2026-11-01T12:00:00Z', { destinationAccountId: 'savings' });
  for (const interval of ['day', 'week', 'month']) {
    const october = buildBalanceHistory([{ id: 'savings', name: 'Savings', balanceMinor: 82790 }], [future], interval, new Date('2026-10-06T10:00:00Z'));
    assert.equal(october.at(-1).totalMinor, 82790);
    const november = buildBalanceHistory([{ id: 'savings', name: 'Savings', balanceMinor: 152790 }], [future], interval, new Date('2026-11-01T00:00:00Z'));
    assert.equal(november.at(-1).totalMinor, 152790);
    assert.equal(november.at(-2).totalMinor, 82790);
  }
});

test('weekly points start Monday and monthly points end at calendar month boundaries', () => {
  const accounts = [{ id: 'main', name: 'Main', balanceMinor: -250 }];
  const weekly = buildBalanceHistory(accounts, [], 'week', now);
  const monthly = buildBalanceHistory(accounts, [], 'month', now);
  assert.equal(weekly.length, 12);
  assert.equal(weekly.at(-1)?.startDate, '2026-09-21');
  assert.equal(weekly.at(-2)?.endDate, '2026-09-20');
  assert.equal(monthly.length, 12);
  assert.equal(monthly.at(-1)?.startDate, '2026-09-01');
  assert.equal(monthly.at(-2)?.endDate, '2026-08-31');
  assert.equal(monthly.at(-1)?.totalMinor, -250);
  assert.equal(monthly[0].unverifiedStart, true);
  assert.equal(monthly.at(-1)?.unverifiedStart, false);
  assert.equal(buildBalanceHistory([], [], 'day', now).length, 0);
});

test('an opening-only account retains its authoritative balance while earlier account existence is unverified', () => {
  const points = buildBalanceHistory(
    [{ id: 'new', name: 'New account', balanceMinor: 12875 }],
    [],
    'day',
    now,
  );
  assert.equal(points.length, 30);
  assert.equal(points[0].totalMinor, 12875);
  assert.equal(points[0].unverifiedStart, true);
  assert.equal(points.at(-1)?.totalMinor, 12875);
  assert.equal(points.at(-1)?.unverifiedStart, false);
});