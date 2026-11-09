import assert from 'node:assert/strict';
import test from 'node:test';
import { categorySpendingBudgetRows } from './category-spending-budget.ts';

const month = '2026-10';
const categories = [
  { id: 'food', name: 'Food', scope: 'shared', color: 'green' },
  { id: 'gifts', name: 'Gifts', scope: 'shared', color: 'blue' },
  { id: 'utilities', name: 'Utilities', scope: 'shared', color: 'orange' },
  { id: 'empty', name: 'Empty', scope: 'shared', color: 'red' },
  { id: 'mine', name: 'Mine', scope: 'personal', ownerUserId: 'me' },
  { id: 'other', name: 'Other', scope: 'personal', ownerUserId: 'other' },
];
const expense = (categoryId, amountMinor, overrides = {}) => ({
  categoryId, amountMinor, kind: 'expense', status: 'posted', occurredAt: '2026-10-15', ...overrides,
});
const budget = (categoryId, overrides = {}) => ({
  categoryId, month, enabled: true, limitMinor: 10000, rolloverMinor: 0,
  spentMinor: 0, percentUsed: 0, status: 'normal', ...overrides,
});

test('union includes spending without budgets and budgets without spending; never truncates categories', () => {
  const rows = categorySpendingBudgetRows(categories, [expense('food', 12000), expense('gifts', 2000)], [
    budget('food', { spentMinor: 12000, percentUsed: 120, status: 'over' }), budget('utilities'),
  ], month, true, 'me');
  assert.deepEqual(rows.map((row) => row.categoryId), ['food', 'gifts', 'utilities']);
  assert.equal(rows[0].budget.percentUsed, 120);
  assert.equal(rows[1].budget, undefined);
  assert.equal(rows[2].amountMinor, 0);
  const all = categorySpendingBudgetRows(categories, [], categories.map((category) => budget(category.id)), month, true);
  assert.equal(all.length, 4);
  assert.equal(categorySpendingBudgetRows([...categories, { id: 'extra', name: 'Extra', scope: 'shared' }], [], [...categories.map((category) => budget(category.id)), budget('extra')], month, true).length, 5);
});

test('only current posted expenses and enabled current budgets participate', () => {
  const rows = categorySpendingBudgetRows(categories, [
    expense('food', 300), expense('food', 100, { status: 'reversed' }),
    expense('food', 200, { kind: 'reversal' }), expense('food', 500, { kind: 'income' }),
    expense('gifts', 400, { occurredAt: '2026-09-30' }),
  ], [budget('empty', { enabled: false }), budget('utilities', { month: '2026-09' })], month, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountMinor, 300);
});

test('shared and personal ownership remain isolated, including budget-only rows', () => {
  const budgets = categories.map((category) => budget(category.id));
  const transactions = categories.map((category) => expense(category.id, 100));
  assert.deepEqual(categorySpendingBudgetRows(categories, transactions, budgets, month, false, 'me').map((row) => row.categoryId), ['mine']);
  assert.deepEqual(categorySpendingBudgetRows(categories, [], budgets, month, false, 'other').map((row) => row.categoryId), ['other']);
  assert.equal(categorySpendingBudgetRows(categories, transactions, budgets, month, false).length, 0);
});

test('filtered-account spending does not overwrite category-wide authoritative budget usage', () => {
  const rows = categorySpendingBudgetRows(categories, [expense('mine', 500)], [
    budget('mine', { spentMinor: 10500, percentUsed: 105, status: 'over' }),
  ], month, false, 'me');
  assert.equal(rows[0].amountMinor, 500);
  assert.equal(rows[0].budget.spentMinor, 10500);
  assert.equal(rows[0].budget.status, 'over');
});

test('no expenses and no enabled budgets yields an empty card', () => {
  assert.deepEqual(categorySpendingBudgetRows(categories, [], [], month, true), []);
});