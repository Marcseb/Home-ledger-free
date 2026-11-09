import assert from 'node:assert/strict';
import test from 'node:test';
import { personalBankEstimate } from './personal-bank-estimate.ts';

const tx = (overrides = {}) => ({
  id: 'tx', kind: 'expense', accountId: 'shared', destinationAccountId: null,
  amountMinor: 9000, currency: 'EUR', categoryId: 'groceries', note: 'Groceries',
  occurredAt: '2026-11-03T10:00:00.000Z', createdByUserId: 'a', status: 'posted',
  reversesTransactionId: null, allocationShares: [], ...overrides,
});

test('estimate adds back app-only Shared allocations and subtracts tagged purchases once', () => {
  const result = personalBankEstimate({
    accounts: [{ id: 'a-main', balanceMinor: 85000 }],
    sharedAccountIds: new Set(['shared']),
    transactions: [
      tx({ id: 'allocation', kind: 'transfer', accountId: 'a-main', destinationAccountId: 'shared', amountMinor: 35000 }),
      tx({ id: 'paid-shared', personalPayerAccountId: 'a-main', amountMinor: 9000 }),
      tx({ id: 'other-payer', personalPayerAccountId: 'b-main', amountMinor: 4000 }),
      tx({ id: 'future', personalPayerAccountId: 'a-main', amountMinor: 3000, occurredAt: '2026-12-03T10:00:00.000Z' }),
      tx({ id: 'reversed', personalPayerAccountId: 'a-main', amountMinor: 2000, status: 'reversed' }),
    ],
    asOfDate: '2026-11-05',
  });
  assert.deepEqual(result, {
    balanceMinor: 85000, allocationsMinor: 35000, sharedPurchasesMinor: 9000, estimateMinor: 111000,
  });
});

test('personal paid mirrors and purchases do not alter Shared transaction totals or user estimates', () => {
  const expense = tx({ personalPayerAccountId: 'a-main' });
  const result = personalBankEstimate({
    accounts: [{ id: 'b-main', balanceMinor: 65000 }],
    sharedAccountIds: new Set(['shared']),
    transactions: [expense],
    asOfDate: '2026-11-05',
  });
  assert.equal(expense.accountId, 'shared');
  assert.equal(result.sharedPurchasesMinor, 0);
  assert.equal(result.estimateMinor, 65000);
});
