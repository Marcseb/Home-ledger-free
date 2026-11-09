import type { SavingsGoal } from '@workspace/api-client-react';

/** Goal progress includes accepted personal-goal mirrors, without revealing their account endpoints. */
export function sharedGoalMonthlySummary(goals: readonly SavingsGoal[], now: Date) {
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  let contributionMinor = 0;
  let planMinor = 0;
  const counted = new Set<string>();
  for (const goal of goals.filter((item) => item.isShared && item.status !== 'cancelled')) {
    const contributions = [...new Map((goal.contributions ?? []).filter((item) => !item.reversedAt && !item.returnTransactionId)
      .map((item) => [item.id, item])).values()];
    const contributedThisMonth = contributions.filter((item) => item.occurredAt.startsWith(month) && item.occurredAt.slice(0, 10) <= today);
    for (const item of contributedThisMonth) {
      if (!counted.has(item.id)) { contributionMinor += item.amountMinor; counted.add(item.id); }
    }
    // Fix the month's suggested plan at opening progress, not at today's shrinking remainder.
    // Use the same remaining-period convention as the individual goal cards.
    const openingProgress = Math.max(0, goal.currentMinor - contributions
      .filter((item) => item.occurredAt.slice(0, 7) >= month).reduce((sum, item) => sum + item.amountMinor, 0));
    const due = new Date(`${goal.dueDate}T00:00:00Z`);
    const periods = Math.max(1, (due.getUTCFullYear() - now.getUTCFullYear()) * 12 + due.getUTCMonth() - now.getUTCMonth());
    planMinor += Math.ceil(Math.max(0, goal.targetMinor - openingProgress) / periods);
  }
  return { contributionMinor, planMinor };
}
