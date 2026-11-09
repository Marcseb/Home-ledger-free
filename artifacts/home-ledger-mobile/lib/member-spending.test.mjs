import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sumExpenseAmountsByEntryCreator,
  sumExpenseSharesByMember,
  sumPostedExpenseAmounts,
  sumPostedExpenseAmountsByEntryCreator,
  sumPostedExpenseSharesByMember,
} from './member-spending.ts';

test('household expense breakdown uses recorded shares instead of the entry creator', () => {
  const transactions = [
    { kind: 'expense', createdByUserId: 'sam', amountMinor: 10000, allocationShares: [
      { userId: 'alex', basisPoints: 6000, amountMinor: 6000 },
      { userId: 'sam', basisPoints: 4000, amountMinor: 4000 },
    ] },
    { kind: 'expense', createdByUserId: 'alex', amountMinor: 101, allocationShares: [
      { userId: 'alex', basisPoints: 5000, amountMinor: 51 },
      { userId: 'sam', basisPoints: 5000, amountMinor: 50 },
    ] },
    { kind: 'transfer', amountMinor: 900, allocationShares: [{ userId: 'alex', basisPoints: 10000, amountMinor: 900 }] },
  ];
  const totals = sumExpenseSharesByMember(transactions);
  assert.equal(totals.get('alex'), 6051);
  assert.equal(totals.get('sam'), 4050);
  assert.equal([...totals.values()].reduce((sum, amount) => sum + amount, 0), 10101);
  const entered = sumExpenseAmountsByEntryCreator(transactions);
  assert.equal((entered.get('sam') ?? 0) - (totals.get('sam') ?? 0), 5950);
  assert.equal((entered.get('alex') ?? 0) - (totals.get('alex') ?? 0), -5950);
});

test('effective shared expense amounts are attributed to the entry creator', () => {
  const transactions = [
    { kind: 'expense', createdByUserId: 'sam', amountMinor: 10000, allocationShares: [] },
    { kind: 'expense', createdByUserId: 'alex', amountMinor: 101, allocationShares: [] },
    { kind: 'transfer', createdByUserId: 'alex', amountMinor: 900, allocationShares: [] },
  ];
  const totals = sumExpenseAmountsByEntryCreator(transactions);
  assert.equal(totals.get('alex'), 101);
  assert.equal(totals.get('sam'), 10000);
  assert.equal([...totals.values()].reduce((sum, amount) => sum + amount, 0), 10101);
});

test('activity totals match posted monthly expense totals and saved household shares', () => {
  const transactions = [
    { kind: 'expense', status: 'posted', createdByUserId: 'sam', amountMinor: 10000, allocationShares: [
      { userId: 'alex', basisPoints: 6000, amountMinor: 6000 },
      { userId: 'sam', basisPoints: 4000, amountMinor: 4000 },
    ] },
    { kind: 'expense', status: 'reversed', createdByUserId: 'alex', amountMinor: 3000, allocationShares: [
      { userId: 'alex', basisPoints: 10000, amountMinor: 3000 },
    ] },
    { kind: 'income', status: 'posted', amountMinor: 5000, allocationShares: [] },
    { kind: 'transfer', status: 'posted', amountMinor: 2000, allocationShares: [] },
  ];

  const total = sumPostedExpenseAmounts(transactions);
  const shares = sumPostedExpenseSharesByMember(transactions);
  const entered = sumPostedExpenseAmountsByEntryCreator(transactions);

  assert.equal(total, 10000);
  assert.deepEqual([...shares.entries()].sort(), [['alex', 6000], ['sam', 4000]]);
  assert.deepEqual([...entered.entries()], [['sam', 10000]]);
  assert.equal((entered.get('sam') ?? 0) - (shares.get('sam') ?? 0), 6000, 'entered amount above share is a settlement credit');
  assert.equal((entered.get('alex') ?? 0) - (shares.get('alex') ?? 0), -6000, 'share above entered amount is a settlement debit');
  assert.equal([...shares.values()].reduce((sum, amount) => sum + amount, 0), total);
});