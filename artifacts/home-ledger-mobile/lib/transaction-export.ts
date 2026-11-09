import type { Account, Category, Transaction, User } from '@workspace/api-client-react';

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function amountText(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

function dateText(value: Date | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function buildTransactionCsv({
  transactions,
  accounts,
  categories,
  users,
}: {
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  categories: readonly Category[];
  users: readonly Pick<User, 'id' | 'displayName'>[];
}): string {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const userNames = new Map(users.map((user) => [user.id, user.displayName]));
  const rows: unknown[][] = [[
    'Transaction ID', 'Date (UTC)', 'Type', 'Account', 'Destination account',
    'Category', 'Amount', 'Currency', 'Status', 'Note', 'Allocation shares',
    'Audit entry', 'Reverses transaction ID',
  ]];
  const ordered = [...transactions].sort((a, b) => dateText(a.occurredAt).localeCompare(dateText(b.occurredAt)) || a.id.localeCompare(b.id));
  for (const transaction of ordered) {
    const allocations = (transaction.allocationShares ?? [])
      .map((share) => `${userNames.get(share.userId) ?? 'Former member'}: ${amountText(share.amountMinor)}`)
      .join('; ');
    rows.push([
      transaction.id,
      dateText(transaction.occurredAt),
      transaction.kind,
      accountNames.get(transaction.accountId) ?? '',
      transaction.destinationAccountId ? accountNames.get(transaction.destinationAccountId) ?? '' : '',
      categoryNames.get(transaction.categoryId) ?? '',
      amountText(transaction.amountMinor),
      transaction.currency,
      transaction.status,
      transaction.note,
      allocations,
      transaction.isAudit ? 'yes' : 'no',
      transaction.reversesTransactionId ?? '',
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function buildHtmlLedgerReport({
  title,
  householdName,
  periodLabel,
  scopeLabel,
  generatedLabel,
  generatedAt,
  currency,
  income,
  expenses,
  net,
  transactionCount,
  categoryRows,
  budgetRows,
  memberRows,
  comparison,
  budgetNote,
  labels,
}: {
  title: string;
  householdName: string;
  periodLabel: string;
  scopeLabel: string;
  generatedLabel: string;
  generatedAt: string;
  currency: string;
  income: string;
  expenses: string;
  net: string;
  transactionCount: number;
  categoryRows: { name: string; amount: string }[];
  budgetRows: {
    name: string;
    budget: string;
    spent: string;
    remaining: string;
    budgetMinor: number | null;
    spentMinor: number;
    overBudget: boolean;
  }[];
  memberRows: { name: string; amount: string }[];
  comparison: {
    currentPeriod: string;
    previousPeriod: string;
    rows: {
      name: string;
      current: string;
      previous: string;
      change: string;
      currentMinor: number;
      previousMinor: number;
      changeMinor: number;
    }[];
  } | null;
  budgetNote: string;
  labels: {
    income: string;
    expenses: string;
    net: string;
    entries: string;
    categories: string;
    members: string;
    amount: string;
    noEntries: string;
    footer: string;
    budgetVsActual: string;
    budget: string;
    spent: string;
    remainingOrOver: string;
    noBudgetSet: string;
    budgetDiagram: string;
    periodComparison: string;
    previousPeriod: string;
    currentPeriod: string;
    change: string;
    comparisonDiagram: string;
    noPreviousPeriod: string;
  };
}): string {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
  const table = (heading: string, rows: { name: string; amount: string }[]) => `
    <section><h2>${escape(heading)}</h2>${rows.length
      ? `<table><thead><tr><th>${escape(heading)}</th><th class="money">${escape(labels.amount)}</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escape(row.name)}</td><td class="money">${escape(row.amount)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted">${escape(labels.noEntries)}</p>`}</section>`;
  const barWidth = (amount: number, maximum: number) =>
    `${Math.max(0, Math.min(100, maximum > 0 ? (Math.abs(amount) / maximum) * 100 : 0)).toFixed(1)}%`;
  const maximumBudget = Math.max(0, ...budgetRows.flatMap((row) => [row.budgetMinor ?? 0, row.spentMinor]));
  const budgetDiagram = budgetRows.length ? `
    <details class="diagram">
      <summary>${escape(labels.budgetDiagram)}</summary>
      <div class="diagram-body" aria-hidden="true">
        <div class="legend"><span><i class="legend-budget"></i>${escape(labels.budget)}</span><span><i class="legend-spent"></i>${escape(labels.spent)}</span></div>
        ${budgetRows.map((row) => `<div class="chart-row">
          <strong>${escape(row.name)}</strong>
          <div class="series"><span>${escape(labels.budget)}</span>${row.budgetMinor === null
            ? `<span class="muted">${escape(labels.noBudgetSet)}</span>`
            : `<div class="track"><div class="bar budget" style="width:${barWidth(row.budgetMinor, maximumBudget)}"></div></div><span class="money">${escape(row.budget)}</span>`}</div>
          <div class="series"><span>${escape(labels.spent)}</span><div class="track"><div class="bar ${row.overBudget ? 'over' : 'spent'}" style="width:${barWidth(row.spentMinor, maximumBudget)}"></div></div><span class="money">${escape(row.spent)}</span></div>
        </div>`).join('')}
      </div>
    </details>` : '';
  const budgetSection = `
    <section><h2>${escape(labels.budgetVsActual)}</h2>
      <p class="muted">${escape(budgetNote)}</p>
      ${budgetRows.length ? `<table><thead><tr><th>${escape(labels.budgetVsActual)}</th><th class="money">${escape(labels.budget)}</th><th class="money">${escape(labels.spent)}</th><th class="money">${escape(labels.remainingOrOver)}</th></tr></thead><tbody>${budgetRows.map((row) => `<tr><td>${escape(row.name)}</td><td class="money">${escape(row.budget)}</td><td class="money">${escape(row.spent)}</td><td class="money ${row.overBudget ? 'over-text' : ''}">${escape(row.remaining)}</td></tr>`).join('')}</tbody></table>${budgetDiagram}`
        : `<p class="muted">${escape(labels.noEntries)}</p>`}
    </section>`;
  const comparisonTable = comparison?.rows.length
    ? `<div class="table-wrap"><table class="comparison-table"><thead><tr><th>${escape(labels.periodComparison)}</th><th class="money">${escape(comparison.previousPeriod)}</th><th class="money">${escape(comparison.currentPeriod)}</th><th class="money">${escape(labels.change)}</th></tr></thead><tbody>${comparison.rows.map((row) => `<tr><td>${escape(row.name)}</td><td class="money">${escape(row.previous)}</td><td class="money">${escape(row.current)}</td><td class="money ${row.changeMinor < 0 ? 'over-text' : ''}">${escape(row.change)}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="muted">${escape(labels.noPreviousPeriod)}</p>`;
  const comparisonDiagram = comparison?.rows.length ? (() => {
    const maximum = Math.max(0, ...comparison.rows.flatMap((row) => [Math.abs(row.currentMinor), Math.abs(row.previousMinor)]));
    return `<details class="diagram"><summary>${escape(labels.comparisonDiagram)}</summary><div class="diagram-body" aria-hidden="true">
      <div class="legend"><span><i class="legend-previous"></i>${escape(labels.previousPeriod)}</span><span><i class="legend-current"></i>${escape(labels.currentPeriod)}</span></div>
      ${comparison.rows.map((row) => `<div class="chart-row"><strong>${escape(row.name)}</strong>
        <div class="series"><span>${escape(labels.previousPeriod)}</span><div class="track"><div class="bar ${row.previousMinor < 0 ? 'over' : 'previous'}" style="width:${barWidth(row.previousMinor, maximum)}"></div></div><span class="money">${escape(row.previous)}</span></div>
        <div class="series"><span>${escape(labels.currentPeriod)}</span><div class="track"><div class="bar ${row.currentMinor < 0 ? 'over' : 'current'}" style="width:${barWidth(row.currentMinor, maximum)}"></div></div><span class="money">${escape(row.current)}</span></div>
      </div>`).join('')}
    </div></details>`;
  })() : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
  <style>
    :root{color-scheme:light;font-family:Inter,Arial,sans-serif;color:#18241e;background:#f5f7f5}
    body{margin:0;padding:24px}.page{max-width:760px;margin:0 auto;background:#fff;border:1px solid #d9e2dc;border-radius:16px;padding:28px}
    h1{font-size:28px;margin:0 0 5px}h2{font-size:17px;margin:24px 0 10px}.muted{color:#63736a}
    .meta{line-height:1.6;color:#63736a}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:20px 0}
    .tile{border:1px solid #d9e2dc;border-radius:12px;padding:13px}.tile span{display:block;color:#63736a;font-size:12px}.tile strong{display:block;margin-top:7px;font-size:18px}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #e5ebe7}th{color:#63736a;font-size:12px;font-weight:600}.money{text-align:right;font-variant-numeric:tabular-nums}
    .table-wrap{overflow-x:auto}.comparison-table{font-size:12px}.comparison-table th,.comparison-table td{padding:8px 5px}
    .diagram{border:1px solid #d9e2dc;border-radius:10px;margin-top:12px}.diagram summary{cursor:pointer;padding:12px;font-weight:600;color:#33443a}
    .diagram-body{padding:0 12px 12px}.legend{display:flex;gap:16px;flex-wrap:wrap;color:#63736a;font-size:12px;margin:8px 0 12px}
    .legend span{display:inline-flex;align-items:center;gap:6px}.legend i{display:inline-block;width:11px;height:11px;border-radius:3px;background:#7890a0}
    .legend .legend-budget,.bar.budget{background:#829eac}.legend .legend-spent,.bar.spent{background:#79ae92}
    .legend .legend-previous,.bar.previous{background:#829eac}.legend .legend-current,.bar.current{background:#79ae92}
    .bar.over{background:#c95f55}.chart-row{padding:10px 0;border-bottom:1px solid #e5ebe7}
    .chart-row>strong{display:block;margin-bottom:7px}.series{display:grid;grid-template-columns:76px minmax(40px,1fr) max-content;align-items:center;gap:8px;font-size:11px;margin-top:5px}
    .track{height:8px;border-radius:5px;background:#edf1ee;overflow:hidden}.bar{height:100%;border-radius:5px}.over-text{color:#a83c34}
    .footer{margin-top:24px;color:#63736a;font-size:11px}
    @media(max-width:520px){body{padding:8px}.page{padding:18px}.summary{grid-template-columns:1fr}.tile{display:flex;align-items:center;justify-content:space-between}.tile strong{margin:0}.series{grid-template-columns:65px minmax(24px,1fr) max-content;gap:5px}.comparison-table th,.comparison-table td{padding:6px 3px;font-size:10px}}
    @page{margin:14mm}
    @media print{body{padding:0;background:#fff}.page{border:0;border-radius:0;max-width:none;padding:0}.summary{break-inside:avoid}h2{break-after:avoid-page}tr{break-inside:avoid}.diagram{display:block;break-inside:avoid}.diagram>summary{display:none}.diagram>.diagram-body{display:block!important}.table-wrap{overflow:visible}}
  </style></head><body><main class="page">
    <h1>${escape(title)}</h1><div class="meta">${escape(householdName)} · ${escape(scopeLabel)}<br>${escape(periodLabel)}<br>${escape(generatedLabel)}: ${escape(generatedAt)}</div>
    <div class="summary">
      <div class="tile"><span>${escape(labels.income)}</span><strong>${escape(income)}</strong></div>
      <div class="tile"><span>${escape(labels.expenses)}</span><strong>${escape(expenses)}</strong></div>
      <div class="tile"><span>${escape(labels.net)}</span><strong>${escape(net)}</strong></div>
    </div>
    <p class="muted">${transactionCount} ${escape(labels.entries)} · ${escape(currency)}</p>
    ${table(labels.categories, categoryRows)}
    ${budgetSection}
    <section><h2>${escape(labels.periodComparison)}</h2>${comparisonTable}${comparisonDiagram}</section>
    ${memberRows.length ? table(labels.members, memberRows) : ''}
    <p class="footer">${escape(labels.footer)}</p>
  </main></body></html>`;
}
