import type { SavingsGoal, Transaction, User } from '@workspace/api-client-react';

export function buildGoalContributorProgress(goal: SavingsGoal, users: Pick<User, 'id' | 'displayName'>[]) {
  const amounts = new Map<string, number>();
  const participants = new Map((goal.participants ?? []).map((participant) => [participant.userId, participant]));
  for (const participant of participants.values()) {
    if (participant.status === 'accepted') amounts.set(participant.userId, 0);
  }
  if (!goal.isShared && goal.ownerUserId) amounts.set(goal.ownerUserId, 0);
  const seen = new Set<string>();
  for (const contribution of goal.contributions) {
    if (seen.has(contribution.id) || contribution.reversedAt || contribution.returnTransactionId) continue;
    seen.add(contribution.id);
    amounts.set(contribution.contributedByUserId,
      (amounts.get(contribution.contributedByUserId) ?? 0) + contribution.amountMinor);
  }
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  return [...amounts].map(([userId, contributedMinor]) => {
    const participant = participants.get(userId);
    const plannedMinor = !goal.isShared && userId === goal.ownerUserId
      ? goal.targetMinor
      : participant?.status === 'accepted' ? participant.committedMinor : null;
    const commitmentMinor = plannedMinor && plannedMinor > 0 ? plannedMinor : null;
    return {
      userId,
      displayName: names.get(userId) ?? participant?.displayName ?? null,
      contributedMinor,
      commitmentMinor,
      progress: commitmentMinor ? contributedMinor / commitmentMinor * 100 : null,
    };
  });
}

export interface SavingsOverviewData {
  reservedMinor: number;
  savedThisMonthMinor: number;
  goals: SavingsGoal[];
}

export function buildSavingsOverview({
  goals, transactions, accountIds, shared, ownerUserId, selectedAccountId, month,
}: {
  goals: SavingsGoal[];
  transactions: Transaction[];
  accountIds: ReadonlySet<string>;
  shared: boolean;
  ownerUserId?: string;
  selectedAccountId?: string;
  month: string;
}): SavingsOverviewData {
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const allocations = new Map<string, { amountMinor: number; occurredAt: string; goalId: string; accountId: string }>();
  for (const goal of goals) {
    for (const contribution of goal.contributions) {
      if (contribution.reversedAt || contribution.returnTransactionId) continue;
      const transaction = contribution.transactionId ? transactionById.get(contribution.transactionId) : undefined;
      // A mirrored entry belongs to its source goal, not to the Shared goal's
      // account. Missing private transfers/source goals must never imply cash.
      const sourceGoal = goalById.get(contribution.goalId);
      const accountId = contribution.transactionId
        ? transaction?.destinationAccountId
        : sourceGoal?.accountId;
      if (!accountId || !accountIds.has(accountId)) continue;
      // Personal and Shared views can contain the same contribution record.
      allocations.set(contribution.id, {
        amountMinor: contribution.amountMinor, occurredAt: contribution.occurredAt,
        goalId: contribution.goalId, accountId,
      });
    }
  }
  const amounts = [...allocations.values()];
  const scopedGoals = goals.filter((goal) => {
    if (goal.status === 'cancelled') return false;
    if (shared) return goal.isShared;
    if (goal.isShared || goal.ownerUserId !== ownerUserId) return false;
    return !selectedAccountId
      || (goal.linkedAccountId ?? goal.accountId) === selectedAccountId
      || amounts.some((allocation) => allocation.goalId === goal.id && allocation.accountId === selectedAccountId);
  }).sort((a, b) => (
    Number(a.currentMinor >= a.targetMinor) - Number(b.currentMinor >= b.targetMinor)
    || a.dueDate.localeCompare(b.dueDate)
    || a.name.localeCompare(b.name)
  ));
  return {
    reservedMinor: amounts.reduce((sum, item) => sum + item.amountMinor, 0),
    savedThisMonthMinor: amounts.filter((item) => item.occurredAt.startsWith(month))
      .reduce((sum, item) => sum + item.amountMinor, 0),
    goals: scopedGoals,
  };
}

export function accountMoneySegments(balanceMinor: number, reservedMinor: number) {
  const availableMinor = balanceMinor - reservedMinor;
  return {
    availableMinor,
    availablePercent: balanceMinor > 0 ? Math.max(0, availableMinor) / balanceMinor * 100 : 0,
    reservedPercent: balanceMinor > 0 ? Math.min(balanceMinor, reservedMinor) / balanceMinor * 100 : 0,
    shortfallMinor: Math.max(0, -availableMinor),
  };
}
