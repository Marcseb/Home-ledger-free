import assert from 'node:assert/strict';
import test from 'node:test';
import { balanceWithPendingEntries, isFutureLedgerEntry } from './current-balance.ts';

const now = new Date('2026-10-06T10:00:00Z');
const entry = (kind, amountMinor, occurredAt, extra = {}) => ({
  kind, amountMinor, occurredAt, accountId: 'main', status: 'posted', ...extra,
});

test('pending future income, expense and transfer affect neither account until their ledger date', () => {
  const pending = [
    entry('transfer', 70000, '2026-11-01T12:00:00Z', { destinationAccountId: 'savings' }),
    entry('income', 40000, '2026-11-01T00:00:00Z'),
    entry('expense', 30000, '2026-11-01T00:00:00Z'),
  ];
  assert.equal(balanceWithPendingEntries(82790, 'savings', pending, now), 82790);
  assert.equal(balanceWithPendingEntries(100000, 'main', pending, now), 100000);
  const november = new Date('2026-11-01T00:00:00Z');
  assert.equal(balanceWithPendingEntries(82790, 'savings', pending, november), 152790);
  assert.equal(balanceWithPendingEntries(100000, 'main', pending, november), 40000);
});

test('pending current-day entries apply both transfer legs once; cancelled and reversal rows do not apply', () => {
  const pending = [
    entry('income', 10000, '2026-10-06T23:59:59Z'),
    entry('expense', 1000, '2026-10-06T12:00:00Z'),
    entry('transfer', 70000, '2026-10-06T12:00:00Z', { destinationAccountId: 'savings' }),
    entry('transfer', 70000, '2026-10-04T12:00:00Z', { destinationAccountId: 'savings', status: 'reversed' }),
    entry('reversal', 70000, '2026-10-06T00:00:00Z', { destinationAccountId: 'savings' }),
  ];
  assert.equal(balanceWithPendingEntries(82790, 'savings', pending, now), 152790);
  assert.equal(balanceWithPendingEntries(100000, 'main', pending, now), 39000);
});

test('ledger cutoff uses UTC dates, including timestamp offsets', () => {
  assert.equal(isFutureLedgerEntry('2026-10-07T00:30:00+02:00', now), false);
  assert.equal(isFutureLedgerEntry('2026-10-06T23:30:00-02:00', now), true);
  assert.throws(() => isFutureLedgerEntry('invalid', now));
});
