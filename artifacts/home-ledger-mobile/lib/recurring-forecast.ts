import type { RecurringRule } from '@workspace/api-client-react';

export type RecurringForecast = {
  ruleId: string;
  occurredAt: string;
  assignedUserId: string | null;
  transactionTemplate: RecurringRule['transactionTemplate'];
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function addMonths(date: Date, months: number, anchorDay: number): Date {
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(next);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
  lastDay.setUTCDate(0);
  next.setUTCDate(Math.min(anchorDay, lastDay.getUTCDate()));
  return next;
}

/** Preview unposted recurring occurrences without changing the ledger. */
export function projectRecurringForecasts(
  rules: readonly RecurringRule[],
  selectedMonth: string,
  visibleAccountIds: ReadonlySet<string>,
): RecurringForecast[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) return [];
  const monthStart = new Date(`${selectedMonth}-01T00:00:00.000Z`);
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const result: RecurringForecast[] = [];

  for (const rule of rules) {
    if (!rule.active || ![rule.transactionTemplate.accountId, rule.transactionTemplate.destinationAccountId]
      .some((id) => id ? visibleAccountIds.has(id) : false)) continue;

    let due = new Date(rule.nextRunAt);
    if (!Number.isFinite(due.getTime())) continue;
    const anchorDay = rule.anchorDay ?? due.getUTCDate();
    if (rule.cadence !== 'weekly' && rule.cadence !== 'monthly') {
      console.warn('Cannot preview a recurring rule with an unknown cadence', rule.id);
      continue;
    }
    if (rule.cadence === 'monthly'
      && (!Number.isInteger(rule.intervalMonths) || rule.intervalMonths < 1
        || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31)) {
      console.warn('Cannot preview a recurring rule with an invalid monthly schedule', rule.id);
      continue;
    }
    let skipped = 0;
    if (due < monthStart) {
      if (rule.cadence === 'weekly') {
        skipped = Math.ceil((monthStart.getTime() - due.getTime()) / WEEK_MS);
        due.setUTCDate(due.getUTCDate() + skipped * 7);
      } else {
        const monthsUntil = (monthStart.getUTCFullYear() - due.getUTCFullYear()) * 12
          + monthStart.getUTCMonth() - due.getUTCMonth();
        skipped = Math.ceil(monthsUntil / rule.intervalMonths);
        due = addMonths(due, skipped * rule.intervalMonths, anchorDay);
      }
    }

    const endDate = rule.endCondition === 'date' && rule.endAt ? rule.endAt.slice(0, 10) : null;
    for (let index = skipped; due < monthEnd; index++) {
      if (endDate !== null && due.toISOString().slice(0, 10) > endDate) break;
      if (rule.endCondition === 'occurrences' && index >= (rule.remainingOccurrences ?? 0)) break;
      result.push({
        ruleId: rule.id,
        occurredAt: due.toISOString(),
        assignedUserId: rule.assignedUserId,
        transactionTemplate: rule.transactionTemplate,
      });
      const next = rule.cadence === 'weekly'
        ? new Date(due.getTime() + WEEK_MS)
        : addMonths(due, rule.intervalMonths, anchorDay);
      if (!Number.isFinite(next.getTime()) || next <= due) {
        console.warn('Recurring forecast stopped because its schedule did not advance', rule.id);
        break;
      }
      due = next;
    }
  }
  return result;
}