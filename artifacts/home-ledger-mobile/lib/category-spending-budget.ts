import type { Budget, Category, Transaction } from '@workspace/api-client-react';

export function categorySpendingBudgetRows(
  categories: Category[],
  transactions: Transaction[],
  budgets: Budget[],
  month: string,
  shared: boolean,
  userId?: string,
) {
  const activeBudgets = new Map(budgets.filter((budget) => budget.enabled && budget.month === month)
    .map((budget) => [budget.categoryId, budget]));
  const spending = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.kind !== 'expense' || transaction.status !== 'posted' || !transaction.occurredAt.startsWith(month) || !transaction.categoryId) continue;
    spending.set(transaction.categoryId, (spending.get(transaction.categoryId) ?? 0) + transaction.amountMinor);
  }
  return categories
    .filter((category) => shared ? category.scope === 'shared' : category.scope === 'personal' && category.ownerUserId === userId)
    .map((category) => ({
      categoryId: category.id,
      name: category.name,
      color: category.color,
      amountMinor: spending.get(category.id) ?? 0,
      budget: activeBudgets.get(category.id),
    }))
    .filter((category) => category.amountMinor > 0 || category.budget)
    .sort((a, b) => b.amountMinor - a.amountMinor);
}