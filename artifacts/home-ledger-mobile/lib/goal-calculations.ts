import type { SavingsGoal } from '@workspace/api-client-react';

export function monthDiff(d1: Date, d2: Date) {
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
}

export function calculateGoalMetrics(goal: SavingsGoal, now = new Date()) {
  const dueDate = new Date(goal.dueDate + 'T12:00:00');

  const createdAtString = goal.createdAt || goal.dueDate;
  const createdDate = new Date(createdAtString + (createdAtString.includes('T') ? '' : 'T12:00:00'));

  const remainingMinor = Math.max(0, goal.targetMinor - goal.currentMinor);
  const isComplete = goal.currentMinor >= goal.targetMinor;

  const progress = Math.min(100, (goal.currentMinor / Math.max(1, goal.targetMinor)) * 100);

  const remainingPeriods = Math.max(1, monthDiff(now, dueDate));
  const requiredMonthlyMinor = isComplete ? 0 : Math.ceil(remainingMinor / remainingPeriods);

  const totalMonths = Math.max(1, monthDiff(createdDate, dueDate));
  const elapsedMonths = Math.max(0, monthDiff(createdDate, now));
  const expectedMinor = Math.min(goal.targetMinor, Math.floor((goal.targetMinor / totalMonths) * Math.min(elapsedMonths, totalMonths)));

  let status: 'Ahead' | 'On track' | 'Behind' | 'Complete' = 'On track';
  if (isComplete) {
    status = 'Complete';
  } else if (goal.currentMinor >= expectedMinor + (goal.targetMinor * 0.05)) {
    status = 'Ahead';
  } else if (goal.currentMinor < expectedMinor - (goal.targetMinor * 0.05)) {
    status = 'Behind';
  }

  return {
    remainingMinor,
    isComplete,
    progress,
    remainingPeriods,
    requiredMonthlyMinor,
    expectedMinor,
    status,
  };
}
