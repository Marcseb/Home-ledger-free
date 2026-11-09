import assert from 'node:assert/strict';
import test from 'node:test';
import { isSharedIncomeInflow, sumSharedIncomeByMember } from './member-income.ts';

const sharedIds = new Set(['shared', 'shared-other']);
const transfer = (creator, source, destination, amountMinor, status = 'posted') => ({
  kind: 'transfer', status, accountId: source, destinationAccountId: destination,
  createdByUserId: creator, amountMinor,
});

test('both members contributions appear on either phone despite private source redaction', () => {
  for (const viewer of ['A', 'B']) {
    const transactions = [
      transfer('A', viewer === 'A' ? 'personal-A' : 'hidden-personal-account', 'shared', 12000),
      transfer('B', viewer === 'B' ? 'personal-B' : 'hidden-personal-account', 'shared', 23000),
    ];
    const inflows = transactions.filter((transaction) => isSharedIncomeInflow(transaction, sharedIds));
    const totals = sumSharedIncomeByMember(transactions, sharedIds);
    assert.deepEqual([...totals], [['A', 12000], ['B', 23000]]);
    assert.equal(inflows.reduce((sum, transaction) => sum + transaction.amountMinor, 0), 35000);
    assert.equal([...totals.values()].reduce((sum, amount) => sum + amount, 0), 35000);
  }
});

test('outgoing, personal-only, internal Shared and cancelled transfers are excluded', () => {
  const transactions = [
    transfer('A', 'personal-A', 'shared', 100),
    transfer('B', 'hidden-personal-account', 'shared-other', 200),
    transfer('A', 'shared', 'personal-A', 300),
    transfer('B', 'shared', null, 400),
    transfer('A', 'personal-A', 'savings-A', 500),
    transfer('A', 'shared', 'shared-other', 600),
    transfer('B', 'hidden-personal-account', 'shared', 700, 'reversed'),
  ];
  assert.deepEqual([...sumSharedIncomeByMember(transactions, sharedIds)], [['A', 100], ['B', 200]]);
});

test('posted direct Shared income keeps its existing creator attribution', () => {
  const income = (accountId, status, amountMinor) => ({
    kind: 'income', accountId, status, destinationAccountId: null, createdByUserId: 'A', amountMinor,
  });
  const transactions = [
    income('shared', 'posted', 150),
    income('personal-A', 'posted', 200),
    income('shared', 'reversed', 300),
    { ...income('shared', 'posted', 400), kind: 'expense' },
    { ...income('shared', 'posted', 500), kind: 'reversal' },
  ];
  assert.deepEqual([...sumSharedIncomeByMember(transactions, sharedIds)], [['A', 150]]);
});