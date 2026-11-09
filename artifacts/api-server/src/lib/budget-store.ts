import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
// @ts-ignore Node's strip-types test scripts need explicit TypeScript extensions.
import { resolveDatabasePath } from "./database-path.ts";
// @ts-ignore Node's strip-types scripts use explicit TypeScript extensions.
import { PostgresSyncDatabase } from "./postgres-sync-database.ts";
// @ts-ignore Node's strip-types scripts use explicit TypeScript extensions.
import type { SyncDatabase } from "./sync-database.ts";
// @ts-ignore Node's strip-types test scripts need explicit TypeScript extensions.
import { cleanupRestoreOrphans, runEncryptedBackup } from "./recovery.ts";
// @ts-ignore Node's strip-types scripts use explicit TypeScript extensions.
// @ts-ignore Node's strip-types scripts use explicit TypeScript extensions.
import { initializeExpenseFunding, expenseFunding, fundedExpenseId, insertExpenseFunding, personalPayerAccountId, setPersonalPayerAccountId, validateExpensePayment, validatePersonalPayerAccount, retireExpenseFunding } from "./shared-expense-funding.ts";

export type LedgerTransaction = {
  id: string;
  kind: "income" | "expense" | "transfer" | "reversal";
  accountId: string;
  destinationAccountId: string | null;
  amountMinor: number;
  currency: string;
  categoryId: string;
  note: string;
  occurredAt: string;
  createdByUserId: string;
  status: "posted" | "reversed";
  reversesTransactionId: string | null;
  paymentAccountId?: string | null;
  personalPayerAccountId?: string | null;
  fundingTransactionId?: string | null;
  linkedExpenseTransactionId?: string | null;
  isAudit?: boolean;
  auditRelatedTransactionId?: string | null;
  allocationShares: Array<{ userId: string; basisPoints: number; amountMinor: number }>;
};

export type RecurringRuleInput = {
  cadence: "weekly" | "monthly";
  intervalMonths?: number;
  nextRunAt: string;
  assignedUserId?: string | null;
  endCondition?: "never" | "date" | "occurrences";
  endAt?: string | null;
  remainingOccurrences?: number | null;
  transactionTemplate: {
    kind: "income" | "expense" | "transfer";
    accountId: string;
    destinationAccountId?: string | null;
    amountMinor: number;
    currency: string;
    categoryId: string;
    note: string;
  };
};

export type TransactionCorrectionInput = {
  operationId?: string;
  amountMinor?: number;
  categoryId?: string;
  note?: string;
  occurredAt?: string;
  paymentAccountId?: string | null;
  personalPayerAccountId?: string | null;
};

export type TransactionCancellationInput = { operationId?: string };
export type SavingsGoalCancellationInput = {
  operationId?: string;
  returnFunds?: boolean;
};
export type SavingsGoalSettlementInput = { operationId?: string; returnFunds?: boolean };
export type SavingsGoalContributionCancellationInput = { operationId?: string };
export type HouseholdReinitializationInput = {
  householdName?: string;
  displayName?: string;
  currency?: string;
  deviceId?: string;
  deviceName?: string;
  confirmation?: string;
};

const reviewerDemoMode = process.env["APP_VARIANT"] === "review-demo";
const dataPath = reviewerDemoMode ? null : resolveDatabasePath();
const runtime = process.env["NODE_ENV"]?.trim();
const acceleratedTestEnabled = process.env["APP_VARIANT"] === "accelerated-test";
if (reviewerDemoMode) {
  const accessCode = process.env["REVIEWER_DEMO_ACCESS_CODE"]?.trim();
  if (runtime === "production" && !/^[a-f0-9]{20}$/i.test(accessCode ?? "")) {
    throw new Error("Set REVIEWER_DEMO_ACCESS_CODE to a 20-character hexadecimal code before starting the reviewer demo");
  }
} else {
  cleanupRestoreOrphans(dataPath!);
  mkdirSync(dirname(dataPath!), { recursive: true });
}
const db = (reviewerDemoMode
  ? new PostgresSyncDatabase(
      process.env["DATABASE_URL"] ?? "",
      process.env["HOME_LEDGER_REVIEW_SCHEMA"]?.trim() || "home_ledger_review_demo",
    )
  : new DatabaseSync(dataPath!)) as unknown as SyncDatabase;
if (!reviewerDemoMode) {
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
  initializeExpenseFunding(db);
}
const pairingCodeTtlMinutes = positiveNumber(process.env["PAIRING_CODE_TTL_MINUTES"], 10);
const sessionTtlDays = positiveNumber(process.env["SESSION_TTL_DAYS"], 30);

function positiveNumber(rawValue: string | undefined, fallback: number) {
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function expiresIn(milliseconds: number) {
  return new Date(Date.now() + milliseconds).toISOString();
}

function newPairingCode() {
  return String(randomInt(100000, 1000000));
}

if (reviewerDemoMode) {
  // PostgreSQL tables are provisioned from the Drizzle schema. Never run the
  // household's SQLite DDL or migrations against the hosted review database.
  db.prepare("SELECT id FROM groups LIMIT 0").all();
} else {
db.exec(`
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_currency TEXT NOT NULL,
  pairing_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  pairing_code_expires_at TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, display_name TEXT NOT NULL,
  role TEXT NOT NULL, default_share_bps INTEGER NOT NULL,
  password_salt TEXT, password_hash TEXT, active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(group_id) REFERENCES groups(id)
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  owner_user_id TEXT, currency TEXT NOT NULL, opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'main', archived_at TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, owner_user_id TEXT,
  name TEXT NOT NULL, scope TEXT NOT NULL, color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, kind TEXT NOT NULL, account_id TEXT NOT NULL,
  destination_account_id TEXT, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
  category_id TEXT NOT NULL, note TEXT NOT NULL, occurred_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL, status TEXT NOT NULL,
  reverses_transaction_id TEXT, operation_id TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS allocation_shares (
  transaction_id TEXT NOT NULL, user_id TEXT NOT NULL, basis_points INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL, PRIMARY KEY(transaction_id, user_id)
);
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, category_id TEXT NOT NULL, month TEXT NOT NULL,
  limit_minor INTEGER NOT NULL, warning_percent INTEGER NOT NULL, rollover_minor INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS budget_alerts (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, category_id TEXT NOT NULL, month TEXT NOT NULL,
  alert_type TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged_at TEXT,
  UNIQUE(group_id, category_id, month, alert_type)
);
CREATE TABLE IF NOT EXISTS savings_goals (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, owner_user_id TEXT, name TEXT NOT NULL,
  target_minor INTEGER NOT NULL, current_minor INTEGER NOT NULL DEFAULT 0, is_shared INTEGER NOT NULL DEFAULT 0,
   account_id TEXT, linked_account_id TEXT, due_date TEXT, priority TEXT, created_at TEXT,
   status TEXT NOT NULL DEFAULT 'active', cancelled_at TEXT, cancelled_by_user_id TEXT
);
CREATE TABLE IF NOT EXISTS savings_goal_participants (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, shared_goal_id TEXT NOT NULL,
  user_id TEXT NOT NULL, personal_goal_id TEXT, committed_minor INTEGER NOT NULL CHECK(committed_minor > 0),
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(shared_goal_id, user_id)
);
CREATE TABLE IF NOT EXISTS savings_goal_contributions (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, goal_id TEXT NOT NULL,
  contributed_by_user_id TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  note TEXT, occurred_at TEXT NOT NULL, transaction_id TEXT, reversed_at TEXT, shared_goal_id TEXT,
  return_transaction_id TEXT
);
CREATE TABLE IF NOT EXISTS recurring_rules (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, cadence TEXT NOT NULL, next_run_at TEXT NOT NULL,
  transaction_template_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT, anchor_day INTEGER, assigned_user_id TEXT,
  interval_months INTEGER NOT NULL DEFAULT 1,
  end_condition TEXT NOT NULL DEFAULT 'never', end_at TEXT, remaining_occurrences INTEGER
);
CREATE TABLE IF NOT EXISTS device_sessions (
  device_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  token_hash TEXT NOT NULL, refresh_token_hash TEXT, expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS household_invitations (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, creator_user_id TEXT NOT NULL,
  display_name TEXT, user_id TEXT, authorized_role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  status TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'http'
);
CREATE TABLE IF NOT EXISTS sync_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL, transaction_id TEXT, occurred_at TEXT NOT NULL, actor_user_id TEXT
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, actor_user_id TEXT, device_id TEXT,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_group_sequence ON sync_events(group_id, sequence);
CREATE INDEX IF NOT EXISTS idx_transactions_group_date ON transactions(group_id, occurred_at);
`);
if (!rows<{ name: string }>("PRAGMA table_info(sync_events)").some((column) => column.name === "actor_user_id")) {
  db.exec("ALTER TABLE sync_events ADD COLUMN actor_user_id TEXT");
}

const groupColumns = rows<{ name: string }>("PRAGMA table_info(groups)");
if (!groupColumns.some((column) => column.name === "pairing_code_expires_at")) {
  db.exec("ALTER TABLE groups ADD COLUMN pairing_code_expires_at TEXT");
}
db.prepare("UPDATE groups SET pairing_code_expires_at=? WHERE pairing_code_expires_at IS NULL")
  .run(expiresIn(pairingCodeTtlMinutes * 60 * 1000));
const recurringRuleColumns = rows<{ name: string }>("PRAGMA table_info(recurring_rules)");
if (!recurringRuleColumns.some((column) => column.name === "created_by_user_id")) {
  db.exec("ALTER TABLE recurring_rules ADD COLUMN created_by_user_id TEXT");
}
if (!recurringRuleColumns.some((column) => column.name === "anchor_day")) {
  db.exec("ALTER TABLE recurring_rules ADD COLUMN anchor_day INTEGER");
}
if (!recurringRuleColumns.some((column) => column.name === "assigned_user_id")) {
  db.exec("ALTER TABLE recurring_rules ADD COLUMN assigned_user_id TEXT");
}
if (!recurringRuleColumns.some((column) => column.name === "interval_months")) {
  db.exec("ALTER TABLE recurring_rules ADD COLUMN interval_months INTEGER NOT NULL DEFAULT 1");
}
if (!recurringRuleColumns.some((column) => column.name === "end_condition")) {
  db.exec("ALTER TABLE recurring_rules ADD COLUMN end_condition TEXT NOT NULL DEFAULT 'never'");
}
if (!recurringRuleColumns.some((column) => column.name === "end_at")) {
  db.exec("ALTER TABLE recurring_rules ADD COLUMN end_at TEXT");
}
if (!recurringRuleColumns.some((column) => column.name === "remaining_occurrences")) {
  db.exec("ALTER TABLE recurring_rules ADD COLUMN remaining_occurrences INTEGER");
}
const userColumns = rows<{ name: string }>("PRAGMA table_info(users)");
if (!userColumns.some((column) => column.name === "active")) {
  db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
}
const categoryColumns = rows<{ name: string }>("PRAGMA table_info(categories)");
if (!categoryColumns.some((column) => column.name === "archived_at")) {
  db.exec("ALTER TABLE categories ADD COLUMN archived_at TEXT");
}
if (!categoryColumns.some((column) => column.name === "is_system")) {
  db.exec("ALTER TABLE categories ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0");
}
db.prepare("UPDATE categories SET is_system=1 WHERE id IN ('income','transfer')").run();
const budgetColumns = rows<{ name: string }>("PRAGMA table_info(budgets)");
if (!budgetColumns.some((column) => column.name === "enabled")) {
  db.exec("ALTER TABLE budgets ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
}
db.exec(`DELETE FROM budgets
  WHERE rowid NOT IN (
    SELECT MAX(rowid) FROM budgets GROUP BY group_id,category_id,month
  )`);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_group_category_month ON budgets(group_id,category_id,month)");
db.exec("CREATE INDEX IF NOT EXISTS idx_budget_alerts_group_month ON budget_alerts(group_id,month)");
const savingsGoalColumns = rows<{ name: string }>("PRAGMA table_info(savings_goals)");
for (const [name, definition] of [["account_id", "TEXT"], ["linked_account_id", "TEXT"], ["due_date", "TEXT"], ["priority", "TEXT"], ["created_at", "TEXT"], ["status", "TEXT NOT NULL DEFAULT 'active'"], ["cancelled_at", "TEXT"], ["cancelled_by_user_id", "TEXT"]] as const) {
  if (!savingsGoalColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE savings_goals ADD COLUMN ${name} ${definition}`);
}
const contributionColumns = rows<{ name: string }>("PRAGMA table_info(savings_goal_contributions)");
for (const [name, definition] of [["transaction_id", "TEXT"], ["reversed_at", "TEXT"], ["shared_goal_id", "TEXT"], ["return_transaction_id", "TEXT"]] as const) {
  if (!contributionColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE savings_goal_contributions ADD COLUMN ${name} ${definition}`);
}
db.prepare("UPDATE savings_goals SET status='active' WHERE status IS NULL OR status=''").run();
db.exec("DROP INDEX IF EXISTS idx_savings_goals_linked_account");
const accountColumns = rows<{ name: string }>("PRAGMA table_info(accounts)");
if (!accountColumns.some((column) => column.name === "role")) db.exec("ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'main'");
if (!accountColumns.some((column) => column.name === "archived_at")) db.exec("ALTER TABLE accounts ADD COLUMN archived_at TEXT");
db.prepare("UPDATE accounts SET role=CASE WHEN kind='shared' THEN 'shared' ELSE 'main' END WHERE role IS NULL OR role='main' AND kind='shared'").run();
const legacyGoalDueDate = new Date();
legacyGoalDueDate.setUTCFullYear(legacyGoalDueDate.getUTCFullYear() + 1);
db.prepare("UPDATE savings_goals SET due_date=COALESCE(due_date,?), priority=COALESCE(priority,'medium'), created_at=COALESCE(created_at,?)")
  .run(legacyGoalDueDate.toISOString().slice(0, 10), new Date().toISOString());
db.prepare(`INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor)
  SELECT 'personal-' || users.id,users.group_id,users.display_name || ' personal','personal',users.id,groups.base_currency,0
  FROM users JOIN groups ON groups.id=users.group_id
  WHERE users.active=1 AND NOT EXISTS (
    SELECT 1 FROM accounts WHERE accounts.group_id=users.group_id AND accounts.kind='personal' AND accounts.owner_user_id=users.id
  )`).run();
db.prepare(`UPDATE savings_goals SET account_id=CASE WHEN is_shared=1
  THEN (SELECT id FROM accounts WHERE accounts.group_id=savings_goals.group_id AND accounts.kind='shared' AND accounts.archived_at IS NULL LIMIT 1)
  ELSE (SELECT id FROM accounts WHERE accounts.group_id=savings_goals.group_id AND accounts.owner_user_id=savings_goals.owner_user_id AND accounts.kind='personal' AND accounts.role='main' AND accounts.archived_at IS NULL LIMIT 1)
  END WHERE account_id IS NULL OR account_id=''`).run();
}

db.prepare("INSERT OR IGNORE INTO runtime_state(key,value) VALUES('business_clock_offset_ms','0')").run();
const realNow = () => new Date().toISOString();
const businessClockOffset = () => Number(row<{ value: string }>("SELECT value FROM runtime_state WHERE key='business_clock_offset_ms'")?.value ?? "0");
const now = () => new Date(Date.now() + (acceleratedTestEnabled ? businessClockOffset() : 0)).toISOString();
export const businessMonth = () => now().slice(0, 7);

export function getBusinessClockStatus() {
  return { acceleratedTest: acceleratedTestEnabled, serverNow: now(), offsetMs: acceleratedTestEnabled ? businessClockOffset() : 0 };
}

let clockAdvanceTransaction = false;
export function advanceBusinessClock(unit: "day" | "week" | "month", materialize?: () => number) {
  if (!acceleratedTestEnabled) throw new Error("Accelerated test clock is unavailable");
  const current = new Date(now());
  if (unit === "month") {
    const day = current.getUTCDate();
    current.setUTCDate(1);
    current.setUTCMonth(current.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate();
    current.setUTCDate(Math.min(day, lastDay));
  } else {
    current.setUTCDate(current.getUTCDate() + (unit === "week" ? 7 : 1));
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE runtime_state SET value=? WHERE key='business_clock_offset_ms'").run(String(current.getTime() - Date.now()));
    let createdRecurringTransactions = 0;
    clockAdvanceTransaction = true;
    try {
      createdRecurringTransactions = materialize?.() ?? 0;
    } finally {
      clockAdvanceTransaction = false;
    }
    db.exec("COMMIT");
    return { ...getBusinessClockStatus(), createdRecurringTransactions };
  } catch (error) {
    clockAdvanceTransaction = false;
    db.exec("ROLLBACK");
    throw error;
  }
}
const tokenHash = (token: string) =>
  Buffer.from(token).toString("base64url");

function row<T>(statement: string, ...params: Array<string | number>): T | undefined {
  return db.prepare(statement).get(...params) as T | undefined;
}
function rows<T>(statement: string, ...params: Array<string | number>): T[] {
  return db.prepare(statement).all(...params) as T[];
}

function recordGoalSyncEvent(groupId: string, operationId: string, type: string, transactionId: string | null, actorUserId: string) {
  db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at,actor_user_id) VALUES(?,?,?,?,?,?)")
    .run(groupId, operationId, type, transactionId, now(), actorUserId);
}

export function resetDemo() {
        if (!clockAdvanceTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE runtime_state SET value='0' WHERE key='business_clock_offset_ms'").run();
    for (const table of ["shared_expense_funding", "shared_expense_payers", "household_invitations", "audit_events", "budget_alerts", "sync_events", "allocation_shares", "transactions", "recurring_rules", "budgets", "savings_goal_contributions", "savings_goal_participants", "savings_goals", "device_sessions", "categories", "accounts", "users", "groups"]) {
      db.exec(`DELETE FROM ${table}`);
    }
    const groupId = randomUUID();
    const masterId = randomUUID();
    const memberId = randomUUID();
    const pairingCode = newPairingCode();
    const createdAt = now();
    const pairingCodeExpiresAt = expiresIn(pairingCodeTtlMinutes * 60 * 1000);
    db.prepare("INSERT INTO groups(id,name,base_currency,pairing_code,created_at,pairing_code_expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(groupId, "Home Ledger", "USD", pairingCode, createdAt, pairingCodeExpiresAt);
    db.prepare("INSERT INTO users(id, group_id, display_name, role, default_share_bps) VALUES (?, ?, ?, ?, ?)").run(masterId, groupId, "Alex", "master", 6000);
    db.prepare("INSERT INTO users(id, group_id, display_name, role, default_share_bps) VALUES (?, ?, ?, ?, ?)").run(memberId, groupId, "Sam", "member", 4000);
    db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role,archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)").run("shared-main", groupId, "Household", "shared", null, "USD", 125000, "shared");
    db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role,archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)").run(`personal-${masterId}`, groupId, "Alex personal", "personal", masterId, "USD", 42000, "main");
    db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role,archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)").run(`personal-${memberId}`, groupId, "Sam personal", "personal", memberId, "USD", 0, "main");
    const categories = [["groceries", "Groceries", "#E67E5F", 0], ["housing", "Housing", "#6C8AE4", 0], ["income", "Income", "#45A675", 1], ["transfer", "Transfer", "#8C78B8", 1]] as const;
    for (const [id, name, color, system] of categories) {
      db.prepare("INSERT INTO categories(id,group_id,owner_user_id,name,scope,color,archived_at,is_system) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)").run(id, groupId, null, name, "shared", color, system);
    }
    db.prepare("INSERT INTO budgets(id,group_id,category_id,month,limit_minor,warning_percent,rollover_minor,enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)").run(randomUUID(), groupId, "groceries", createdAt.slice(0, 7), 60000, 80, 0);
    db.prepare("INSERT INTO savings_goals(id,group_id,owner_user_id,name,target_minor,current_minor,is_shared,account_id,due_date,priority,created_at) VALUES (?, ?, NULL, ?, ?, 0, 1, ?, ?, ?, ?)")
      .run(randomUUID(), groupId, "Alex's birthday party", 60000, "shared-main", "2027-02-28", "high", createdAt);
    db.prepare("INSERT INTO savings_goals(id,group_id,owner_user_id,name,target_minor,current_minor,is_shared,account_id,due_date,priority,created_at) VALUES (?, ?, NULL, ?, ?, 0, 1, ?, ?, ?, ?)")
      .run(randomUUID(), groupId, "Ireland trip", 350000, "shared-main", "2027-07-31", "medium", createdAt);
    db.exec("COMMIT");
    return { pairingCode, pairingCodeExpiresAt, serverName: "Home Ledger PC" };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function ensureDemo() {
  if (reviewerDemoMode) seedReviewerDemoHousehold();
  if (!row("SELECT id FROM groups LIMIT 1")) {
    if (runtime === "development" && process.env["ALLOW_DEMO_RESET"] === "true") return resetDemo();
    return { pairingCode: null, pairingCodeExpiresAt: null, serverName: "Home Ledger PC" };
  }
  const group = row<{ id: string; pairing_code: string; pairing_code_expires_at: string }>(
    "SELECT id,pairing_code,pairing_code_expires_at FROM groups LIMIT 1",
  )!;
  if (Date.parse(group.pairing_code_expires_at) <= Date.now()) {
    const pairingCode = newPairingCode();
    const pairingCodeExpiresAt = expiresIn(pairingCodeTtlMinutes * 60 * 1000);
    db.prepare("UPDATE groups SET pairing_code=?,pairing_code_expires_at=? WHERE id=?")
      .run(pairingCode, pairingCodeExpiresAt, group.id);
    return { pairingCode, pairingCodeExpiresAt, serverName: "Home Ledger PC" };
  }
  return { pairingCode: group.pairing_code, pairingCodeExpiresAt: group.pairing_code_expires_at, serverName: "Home Ledger PC" };
}

function seedReviewerDemoHousehold() {
  const resetGeneration = process.env["REVIEWER_DEMO_RESET_GENERATION"]?.trim();
  if (resetGeneration && !/^[a-z0-9_-]{1,80}$/i.test(resetGeneration)) {
    throw new Error("Invalid reviewer reset generation");
  }
  const previousGeneration = row<{ value: string }>(
    "SELECT value FROM runtime_state WHERE key='review_reset_generation'",
  )?.value;
  const resetRequested = Boolean(resetGeneration && resetGeneration !== previousGeneration);
  if (row("SELECT id FROM groups LIMIT 1") && !resetRequested) return;
  const seedableTables = [
    "users", "accounts", "categories", "transactions", "allocation_shares", "budgets",
    "budget_alerts", "savings_goals", "savings_goal_participants", "savings_goal_contributions",
    "recurring_rules", "device_sessions", "household_invitations", "sync_events", "audit_events",
    "shared_expense_funding", "shared_expense_payers",
  ];
  const hasPartialData = seedableTables.some((table) =>
    Number(row<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count ?? 0) > 0,
  );
  if (hasPartialData && !resetRequested) {
    throw new Error("Reviewer demo database has data but no household; refusing to overwrite it");
  }

  resetDemo();
  db.prepare("INSERT OR IGNORE INTO runtime_state(key,value) VALUES('business_clock_offset_ms','0')").run();
  const groupId = row<{ id: string }>("SELECT id FROM groups LIMIT 1")!.id;
  const master = row<{ id: string }>("SELECT id FROM users WHERE group_id=? AND role='master' LIMIT 1", groupId)!;
  const member = row<{ id: string }>("SELECT id FROM users WHERE group_id=? AND role='member' LIMIT 1", groupId)!;
  db.prepare("UPDATE groups SET name=?,base_currency=? WHERE id=?").run("Home Ledger Play Demo", "EUR", groupId);
  db.prepare("UPDATE accounts SET currency='EUR' WHERE group_id=?").run(groupId);

  const today = new Date();
  const addDays = (days: number) => new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const demoTransactions = [
    { id: "review-demo-grocery", amount: 6845, category: "groceries", note: "Weekly groceries · demo", daysAgo: 2 },
    { id: "review-demo-housing", amount: 42000, category: "housing", note: "Household utilities · demo", daysAgo: 8 },
    { id: "review-demo-income", amount: 320000, category: "income", note: "Monthly income · demo", daysAgo: 12 },
  ] as const;

  for (const transaction of demoTransactions) {
    const occurredAt = addDays(transaction.daysAgo);
    db.prepare(`INSERT INTO transactions(
      id,group_id,kind,account_id,destination_account_id,amount_minor,currency,category_id,note,
      occurred_at,created_by_user_id,status,reverses_transaction_id,operation_id
    ) VALUES(?,? ,?, ?,NULL,?,'EUR',?,?,?,?,'posted',NULL,?)`).run(
      transaction.id,
      groupId,
      transaction.category === "income" ? "income" : "expense",
      "shared-main",
      transaction.amount,
      transaction.category,
      transaction.note,
      occurredAt,
      master.id,
      `review-demo:${transaction.id}`,
    );
    if (transaction.category !== "income") {
      const masterShare = Math.round(transaction.amount * 0.6);
      db.prepare("INSERT INTO allocation_shares(transaction_id,user_id,basis_points,amount_minor) VALUES(?,?,6000,?)")
        .run(transaction.id, master.id, masterShare);
      db.prepare("INSERT INTO allocation_shares(transaction_id,user_id,basis_points,amount_minor) VALUES(?,?,4000,?)")
        .run(transaction.id, member.id, transaction.amount - masterShare);
    }
  }
  if (resetGeneration) {
    db.prepare(`INSERT INTO runtime_state(key,value) VALUES('review_reset_generation',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(resetGeneration);
  }
}

export function setupHousehold(input: {
  householdName?: string;
  displayName?: string;
  currency?: string;
  deviceId?: string;
  deviceName?: string;
}) {
  const name = input?.householdName?.trim();
  const displayName = input?.displayName?.trim();
  const currency = input?.currency?.trim().toUpperCase();
  if (!name || name.length > 80 || !displayName || displayName.length > 80 ||
      !["EUR", "USD", "GBP"].includes(currency ?? "") || !input?.deviceId?.trim() || !input?.deviceName?.trim()) {
    throw new Error("Household name, display name, EUR/USD/GBP currency, device ID, and device name are required");
  }
  const selectedCurrency = currency!;
  if (row("SELECT id FROM groups LIMIT 1")) throw new Error("Household setup has already been completed");
  const groupId = randomUUID();
  const userId = randomUUID();
  const createdAt = now();
  const token = randomBytes(32).toString("base64url");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO groups(id,name,base_currency,pairing_code,created_at,pairing_code_expires_at) VALUES(?,?,?,?,?,?)")
      .run(groupId, name, selectedCurrency, newPairingCode(), createdAt, expiresIn(pairingCodeTtlMinutes * 60 * 1000));
    db.prepare("INSERT INTO users(id,group_id,display_name,role,default_share_bps) VALUES(?,?,?,'master',10000)")
      .run(userId, groupId, displayName);
    db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role,archived_at) VALUES(?,?,?,?,?,?,0,'main',NULL)")
      .run(`personal-${userId}`, groupId, `${displayName} personal`, "personal", userId, selectedCurrency);
    db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role,archived_at) VALUES(?,?,?,?,?,?,0,'shared',NULL)")
      .run("shared-main", groupId, "Household", "shared", null, selectedCurrency);
    for (const [id, category, color, system] of [["income", "Income", "#45A675", 1], ["transfer", "Transfer", "#8C78B8", 1]] as const) {
      db.prepare("INSERT INTO categories(id,group_id,owner_user_id,name,scope,color,is_system) VALUES(?,?,NULL,?,'shared',?,?)")
        .run(id, groupId, category, color, system);
    }
    db.prepare("INSERT INTO device_sessions(device_id,user_id,name,token_hash,expires_at,last_seen_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)")
      .run(input.deviceId.trim(), userId, input.deviceName.trim(), tokenHash(token), expiresIn(sessionTtlDays * 24 * 60 * 60 * 1000), realNow());
    audit(groupId, userId, input.deviceId.trim(), "household.created", "group", groupId, { currency: selectedCurrency });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { deviceToken: token, user: getUser(userId), state: getState(groupId, userId) };
}

export function reinitializeHousehold(groupId: string, actorUserId: string, input: HouseholdReinitializationInput) {
  const actor = row<{ role: string; active: number }>("SELECT role,active FROM users WHERE id=? AND group_id=?", actorUserId, groupId);
  if (!actor?.active || actor.role !== "master") throw new Error("Master role required");
  const name = input?.householdName?.trim();
  const displayName = input?.displayName?.trim();
  const currency = input?.currency?.trim().toUpperCase();
  if (input?.confirmation !== "REINITIALIZE HOUSEHOLD" || !name || name.length > 80 || !displayName ||
      displayName.length > 80 || !["EUR", "USD", "GBP"].includes(currency ?? "") ||
      !input?.deviceId?.trim() || !input?.deviceName?.trim()) {
    throw new Error("Confirmation phrase, household name, display name, EUR/USD/GBP currency, device ID, and device name are required");
  }
  const group = row<{ id: string }>("SELECT id FROM groups WHERE id=?", groupId);
  if (!group) throw new Error("Household not found");
  const selectedCurrency = currency!;
  const newGroupId = randomUUID();
  const newUserId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of ["household_invitations", "audit_events", "budget_alerts", "sync_events"]) {
      db.prepare(`DELETE FROM ${table} WHERE group_id=?`).run(groupId);
    }
    db.prepare("DELETE FROM allocation_shares WHERE transaction_id IN (SELECT id FROM transactions WHERE group_id=?)").run(groupId);
    db.prepare("DELETE FROM device_sessions WHERE user_id IN (SELECT id FROM users WHERE group_id=?)").run(groupId);
    for (const table of ["shared_expense_funding", "shared_expense_payers", "transactions", "recurring_rules", "budgets", "savings_goal_contributions", "savings_goal_participants", "savings_goals", "categories", "accounts", "users"]) {
      db.prepare(`DELETE FROM ${table} WHERE group_id=?`).run(groupId);
    }
    db.prepare("DELETE FROM groups WHERE id=?").run(groupId);
    db.prepare("INSERT INTO groups(id,name,base_currency,pairing_code,created_at,pairing_code_expires_at) VALUES(?,?,?,?,?,?)")
      .run(newGroupId, name, selectedCurrency, newPairingCode(), createdAt, expiresIn(pairingCodeTtlMinutes * 60 * 1000));
    db.prepare("INSERT INTO users(id,group_id,display_name,role,default_share_bps) VALUES(?,?,?,'master',10000)")
      .run(newUserId, newGroupId, displayName);
    db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role,archived_at) VALUES(?,?,?,?,?,?,0,'main',NULL)")
      .run(`personal-${newUserId}`, newGroupId, `${displayName} personal`, "personal", newUserId, selectedCurrency);
    db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role,archived_at) VALUES(?,?,?,?,?,?,0,'shared',NULL)")
      .run("shared-main", newGroupId, "Household", "shared", null, selectedCurrency);
    for (const [id, category, color] of [["income", "Income", "#45A675"], ["transfer", "Transfer", "#8C78B8"]] as const) {
      db.prepare("INSERT INTO categories(id,group_id,owner_user_id,name,scope,color,is_system) VALUES(?,?,NULL,?,'shared',?,1)")
        .run(id, newGroupId, category, color);
    }
    db.prepare("INSERT INTO device_sessions(device_id,user_id,name,token_hash,expires_at,last_seen_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)")
      .run(input.deviceId.trim(), newUserId, input.deviceName.trim(), tokenHash(token), expiresIn(sessionTtlDays * 24 * 60 * 60 * 1000), realNow());
    audit(newGroupId, newUserId, input.deviceId.trim(), "household.reinitialized", "group", newGroupId, { previousGroupId: groupId, currency: selectedCurrency });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { deviceToken: token, user: getUser(newUserId), state: getState(newGroupId, newUserId) };
}

export function resetLedger(groupId: string, actorUserId: string, deviceId: string) {
  const actor = row<{ role: "master" | "member"; active: number }>(
    "SELECT role,active FROM users WHERE id=? AND group_id=?",
    actorUserId,
    groupId,
  );
  if (!actor?.active || actor.role !== "master") throw new Error("Master role required");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM audit_events WHERE group_id=?").run(groupId);
    db.prepare("DELETE FROM shared_expense_funding WHERE group_id=?").run(groupId);
    db.prepare("DELETE FROM shared_expense_payers WHERE group_id=?").run(groupId);
    db.prepare("DELETE FROM allocation_shares WHERE transaction_id IN (SELECT id FROM transactions WHERE group_id=?)").run(groupId);
    db.prepare("DELETE FROM transactions WHERE group_id=?").run(groupId);
    db.prepare("DELETE FROM savings_goal_contributions WHERE group_id=?").run(groupId);
    db.prepare("UPDATE savings_goals SET current_minor=0 WHERE group_id=?").run(groupId);
    db.prepare("UPDATE accounts SET opening_balance_minor=0 WHERE group_id=? AND kind='shared'").run(groupId);
    db.prepare("DELETE FROM sync_events WHERE group_id=?").run(groupId);
    const operationId = randomUUID();
    const resetAt = now();
    const event = db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,NULL,?)")
      .run(groupId, operationId, "ledger.reset", resetAt);
    audit(groupId, actorUserId, deviceId, "ledger.reset", "ledger", groupId, {});
    db.exec("COMMIT");
    return { serverSequence: Number(event.lastInsertRowid) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

type HouseholdInvitation = {
  id: string;
  displayName: string;
  userId: string | null;
  role: "master" | "member";
  createdAt: string;
  expiresAt: string;
  status: "pending" | "redeemed" | "revoked" | "expired";
};

type InvitationInput = { displayName?: string; userId?: string };

const invitationCodeHash = (code: string) => createHash("sha256").update(code, "utf8").digest("hex");
const normalizeInvitationCode = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();

function mapInvitation(invite: {
  id: string; display_name: string | null; user_id: string | null; authorized_role: string;
  created_at: string; expires_at: string; status: string;
}): HouseholdInvitation {
  const displayName = invite.display_name ?? (invite.user_id
    ? row<{ display_name: string }>("SELECT display_name FROM users WHERE id=?", invite.user_id)?.display_name
    : undefined);
  if (!displayName) throw new Error("Invitation identity is unavailable");
  return {
    id: invite.id,
    displayName,
    userId: invite.user_id,
    role: invite.authorized_role as "master" | "member",
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
    status: invite.status as HouseholdInvitation["status"],
  };
}

function requireActiveMaster(groupId: string, actorUserId: string) {
  const actor = row<{ role: string; active: number }>(
    "SELECT role,active FROM users WHERE id=? AND group_id=?", actorUserId, groupId,
  );
  if (!actor?.active || actor.role !== "master") throw new Error("Master role required");
}

function householdNameExists(groupId: string, name: string) {
  const normalizedName = name.trim().toLocaleLowerCase("en-US");
  return rows<{ display_name: string }>("SELECT display_name FROM users WHERE group_id=?", groupId)
    .some((user) => user.display_name.trim().toLocaleLowerCase("en-US") === normalizedName);
}

function pendingInvitationNameExists(groupId: string, name: string) {
  const normalizedName = name.trim().toLocaleLowerCase("en-US");
  return rows<{ display_name: string }>(
    "SELECT display_name FROM household_invitations WHERE group_id=? AND status='pending' AND display_name IS NOT NULL AND expires_at>?",
    groupId, realNow(),
  ).some((invite) => invite.display_name.trim().toLocaleLowerCase("en-US") === normalizedName);
}

function createInvitation(groupId: string, creatorUserId: string, input: InvitationInput, source: "http" | "local") {
  if (!input || Object.keys(input).some((key) => key !== "displayName" && key !== "userId")
    || (input.displayName !== undefined && typeof input.displayName !== "string")
    || (input.userId !== undefined && typeof input.userId !== "string")) {
    throw new Error("Invitation request contains unsupported fields");
  }
  const byName = typeof input?.displayName === "string";
  const byUser = typeof input?.userId === "string";
  if (byName === byUser) throw new Error("Provide exactly one of displayName or userId");
  let displayName: string | null = null;
  let userId: string | null = null;
  let role: "master" | "member" = "member";
  if (byName) {
    displayName = input.displayName!.trim();
    if (!displayName || displayName.length > 80) throw new Error("Display name must be 1 to 80 characters");
    if (householdNameExists(groupId, displayName)) {
      throw new Error("A household member with this name already exists or was removed");
    }
    if (pendingInvitationNameExists(groupId, displayName)) throw new Error("A pending invitation already uses this display name");
  } else {
    userId = input.userId!.trim();
    const target = row<{ role: "master" | "member"; active: number; display_name: string }>(
      "SELECT role,active,display_name FROM users WHERE id=? AND group_id=?", userId, groupId,
    );
    if (!target?.active || (target.role !== "master" && target.role !== "member")) {
      throw new Error("Target must be an active household member or Master");
    }
    role = target.role;
    displayName = target.display_name;
  }
  const id = randomUUID();
  const code = randomBytes(10).toString("hex").toUpperCase();
  const createdAt = realNow();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO household_invitations
    (id,group_id,creator_user_id,display_name,user_id,authorized_role,token_hash,created_at,expires_at,status,source)
    VALUES(?,?,?,?,?,?,?,?,?,'pending',?)`)
    .run(id, groupId, creatorUserId, displayName, userId, role, invitationCodeHash(code), createdAt, expiresAt, source);
  return { invitation: mapInvitation({ id, display_name: displayName, user_id: userId, authorized_role: role, created_at: createdAt, expires_at: expiresAt, status: "pending" }), invitationCode: code };
}

export function createHouseholdInvitation(groupId: string, actorUserId: string, deviceId: string, input: InvitationInput) {
  db.exec("BEGIN IMMEDIATE");
  try {
    requireActiveMaster(groupId, actorUserId);
    const device = row<{ user_id: string; revoked_at: string | null; expires_at: string }>(
      "SELECT user_id,revoked_at,expires_at FROM device_sessions WHERE device_id=?", deviceId,
    );
    if (!device || device.user_id !== actorUserId || device.revoked_at || Date.parse(device.expires_at) <= Date.now()) {
      throw new Error("Master device session is invalid");
    }
    const result = createInvitation(groupId, actorUserId, input, "http");
    audit(groupId, actorUserId, deviceId, "household.invitation-created", "invitation", result.invitation.id, {
      userId: result.invitation.userId, role: result.invitation.role,
    });
    db.exec("COMMIT");
    return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function listHouseholdInvitations(groupId: string, actorUserId: string) {
  requireActiveMaster(groupId, actorUserId);
  const nowAt = realNow();
  db.prepare("UPDATE household_invitations SET status='expired' WHERE group_id=? AND status='pending' AND expires_at<=?")
    .run(groupId, nowAt);
  const invitations = rows<{
    id: string; display_name: string | null; user_id: string | null; authorized_role: string;
    created_at: string; expires_at: string; status: string;
  }>("SELECT id,display_name,user_id,authorized_role,created_at,expires_at,status FROM household_invitations WHERE group_id=? ORDER BY created_at DESC",
  groupId).map(mapInvitation);
  return { invitations };
}

export function revokeHouseholdInvitation(groupId: string, actorUserId: string, deviceId: string, invitationId: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    requireActiveMaster(groupId, actorUserId);
    const session = row<{ user_id: string; revoked_at: string | null; expires_at: string }>(
      "SELECT user_id,revoked_at,expires_at FROM device_sessions WHERE device_id=?", deviceId,
    );
    if (!session || session.user_id !== actorUserId || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) {
      throw new Error("Master device session is invalid");
    }
    const invite = row<{ id: string; display_name: string | null; user_id: string | null; authorized_role: string; created_at: string; expires_at: string; status: string }>(
      "SELECT id,display_name,user_id,authorized_role,created_at,expires_at,status FROM household_invitations WHERE id=? AND group_id=?",
      invitationId, groupId,
    );
    if (!invite) throw new Error("Invitation not found");
    if (invite.status === "redeemed") {
      throw new Error("A redeemed invitation cannot be revoked. Revoke the device instead.");
    }
    if (invite.status === "pending" && Date.parse(invite.expires_at) <= Date.now()) {
      db.prepare("UPDATE household_invitations SET status='expired' WHERE id=?").run(invitationId);
      invite.status = "expired";
    } else if (invite.status === "pending") {
      db.prepare("UPDATE household_invitations SET status='revoked' WHERE id=?").run(invitationId);
      invite.status = "revoked";
    }
    if (invite.status === "revoked") {
      audit(groupId, actorUserId, deviceId, "household.invitation-revoked", "invitation", invitationId, {});
    }
    db.exec("COMMIT");
    return mapInvitation(invite);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function redeemHouseholdInvitation(input: { invitationCode: string; deviceId: string; deviceName: string }) {
  if (!input || typeof input.invitationCode !== "string" || typeof input.deviceId !== "string"
    || typeof input.deviceName !== "string" || !input.deviceId.trim() || !input.deviceName.trim()
    || input.deviceId.trim().length > 200 || input.deviceName.trim().length > 80
    || Object.keys(input).some((key) => !["invitationCode", "deviceId", "deviceName"].includes(key))) {
    throw new Error("Invalid invitation redemption request");
  }
  const code = normalizeInvitationCode(input.invitationCode);
  if (!/^[A-F0-9]{20}$/.test(code)) throw new Error("Invitation code is invalid or expired");
  db.exec("BEGIN IMMEDIATE");
  try {
    const invite = row<{
      id: string; group_id: string; creator_user_id: string; display_name: string | null;
      user_id: string | null; authorized_role: "master" | "member"; status: string; expires_at: string;
    }>("SELECT id,group_id,creator_user_id,display_name,user_id,authorized_role,status,expires_at FROM household_invitations WHERE token_hash=?",
    invitationCodeHash(code));
    if (!invite || invite.status !== "pending" || Date.parse(invite.expires_at) <= Date.now()) {
      if (invite?.status === "pending") db.prepare("UPDATE household_invitations SET status='expired' WHERE id=?").run(invite.id);
      throw new Error("Invitation code is invalid, expired, revoked, or already used");
    }
    const creator = row<{ active: number; role: string }>(
      "SELECT active,role FROM users WHERE id=? AND group_id=?", invite.creator_user_id, invite.group_id,
    );
    if (!creator?.active || creator.role !== "master") {
      db.prepare("UPDATE household_invitations SET status='revoked' WHERE id=?").run(invite.id);
      throw new Error("Invitation is no longer valid");
    }
    let userId = invite.user_id;
    if (userId) {
      const target = row<{ active: number; role: string }>(
        "SELECT active,role FROM users WHERE id=? AND group_id=?", userId, invite.group_id,
      );
      if (!target?.active || target.role !== invite.authorized_role) {
        db.prepare("UPDATE household_invitations SET status='revoked' WHERE id=?").run(invite.id);
        throw new Error("Invitation target is no longer authorized");
      }
    } else {
      const displayName = invite.display_name!;
      if (householdNameExists(invite.group_id, displayName)) {
        db.prepare("UPDATE household_invitations SET status='revoked' WHERE id=?").run(invite.id);
        throw new Error("A household member with this name already exists or was removed");
      }
      userId = randomUUID();
      const group = row<{ base_currency: string }>("SELECT base_currency FROM groups WHERE id=?", invite.group_id)!;
      db.prepare("INSERT INTO users(id,group_id,display_name,role,default_share_bps) VALUES(?,?,?,'member',0)")
        .run(userId, invite.group_id, displayName);
      db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role,archived_at) VALUES(?,?,?, 'personal', ?, ?, 0, 'main', NULL)")
        .run(`personal-${userId}`, invite.group_id, `${displayName} personal`, userId, group.base_currency);
    }
    const deviceId = input.deviceId.trim();
    if (row("SELECT device_id FROM device_sessions WHERE device_id=?", deviceId)) {
      throw new Error("This device ID is already registered; use a new device ID");
    }
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO device_sessions(device_id,user_id,name,token_hash,expires_at,last_seen_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)")
      .run(deviceId, userId, input.deviceName.trim(), tokenHash(token), expiresIn(sessionTtlDays * 24 * 60 * 60 * 1000), realNow());
    db.prepare("UPDATE household_invitations SET status='redeemed',user_id=? WHERE id=? AND status='pending'").run(userId, invite.id);
    audit(invite.group_id, userId, deviceId, "device.invitation-redeemed", "invitation", invite.id, { role: invite.authorized_role });
    const result = { deviceToken: token, user: getUser(userId), state: getState(invite.group_id, userId) };
    db.exec("COMMIT");
    return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function isReviewerDemoMode() {
  return reviewerDemoMode;
}

export function redeemReviewerDemoAccess(input: {
  invitationCode: string; deviceId: string; deviceName: string;
}) {
  if (!reviewerDemoMode) throw new Error("Reviewer access is unavailable");
  if (!input || typeof input.invitationCode !== "string" || typeof input.deviceId !== "string"
    || typeof input.deviceName !== "string" || !input.deviceId.trim() || !input.deviceName.trim()
    || input.deviceId.trim().length > 200 || input.deviceName.trim().length > 80
    || Object.keys(input).some((key) => !["invitationCode", "deviceId", "deviceName"].includes(key))) {
    throw new Error("Invalid reviewer access request");
  }
  const expectedCode = process.env["REVIEWER_DEMO_ACCESS_CODE"]?.trim().toUpperCase();
  if (!expectedCode || !/^[A-F0-9]{20}$/.test(expectedCode)) throw new Error("Reviewer access is not configured");
  const suppliedCode = input.invitationCode.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-F0-9]{20}$/.test(suppliedCode)
    || !timingSafeEqual(Buffer.from(expectedCode, "hex"), Buffer.from(suppliedCode, "hex"))) {
    throw new Error("Invitation code is invalid or expired");
  }
  const master = row<{ id: string; group_id: string }>(
    "SELECT id,group_id FROM users WHERE active=1 AND role='master' ORDER BY rowid LIMIT 1",
  );
  if (!master) throw new Error("Reviewer demo household is not ready");
  const deviceId = input.deviceId.trim();
  const existing = row<{ user_id: string }>("SELECT user_id FROM device_sessions WHERE device_id=?", deviceId);
  if (existing && existing.user_id !== master.id) throw new Error("This device is already linked to another demo user");
  db.exec("BEGIN IMMEDIATE");
  try {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = expiresIn(sessionTtlDays * 24 * 60 * 60 * 1000);
    if (existing) {
      db.prepare(`UPDATE device_sessions SET name=?,token_hash=?,expires_at=?,last_seen_at=?,revoked_at=NULL
        WHERE device_id=? AND user_id=?`)
        .run(input.deviceName.trim(), tokenHash(token), expiresAt, realNow(), deviceId, master.id);
    } else {
      db.prepare(`INSERT INTO device_sessions(device_id,user_id,name,token_hash,expires_at,last_seen_at,revoked_at)
        VALUES(?,?,?,?,?,?,NULL)`)
        .run(deviceId, master.id, input.deviceName.trim(), tokenHash(token), expiresAt, realNow());
    }
    audit(master.group_id, master.id, deviceId, "device.reviewer-demo-access-granted", "device", deviceId, {});
    const result = { deviceToken: token, user: getUser(master.id), state: getState(master.group_id, master.id) };
    db.exec("COMMIT");
    return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function createLocalMasterInvitation() {
  db.exec("BEGIN IMMEDIATE");
  try {
    const master = row<{ id: string; group_id: string }>(
      "SELECT id,group_id FROM users WHERE active=1 AND role='master' ORDER BY rowid LIMIT 1",
    );
    if (!master) throw new Error("No initialized household with an active Master was found");
    db.prepare("UPDATE household_invitations SET status='revoked' WHERE group_id=? AND source='local' AND status='pending'")
      .run(master.group_id);
    const created = createInvitation(master.group_id, master.id, { userId: master.id }, "local");
    audit(master.group_id, master.id, null, "household.master-recovery-invitation-created", "invitation", created.invitation.id, {});
    db.exec("COMMIT");
    return created;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function hasUnrevokedMasterDevice() {
  return Boolean(row<{ device_id: string }>(`SELECT device_sessions.device_id FROM device_sessions
    JOIN users ON users.id=device_sessions.user_id
    WHERE users.active=1 AND users.role='master' AND device_sessions.revoked_at IS NULL
    AND device_sessions.expires_at>? LIMIT 1`, realNow()));
}

// The old pairing-code mechanism is intentionally unavailable to callers.
export function pair(_input: unknown): never {
  throw new Error("This server requires an upgraded client using household invitations");
}

export function authenticate(token: string | undefined) {
  if (!token) return null;
  const session = row<{ device_id: string; user_id: string; token_hash: string; expires_at: string; revoked_at: string | null }>(
    "SELECT device_id,user_id,token_hash,expires_at,revoked_at FROM device_sessions WHERE token_hash = ?", tokenHash(token));
  if (!session || session.revoked_at) return null;
  const supplied = Buffer.from(tokenHash(token));
  const stored = Buffer.from(session.token_hash);
  if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    db.prepare("UPDATE device_sessions SET revoked_at=? WHERE device_id=?").run(realNow(), session.device_id);
    return null;
  }
  db.prepare("UPDATE device_sessions SET last_seen_at=? WHERE device_id=?").run(realNow(), session.device_id);
  const user = getUser(session.user_id);
  const group = row<{ group_id: string }>("SELECT group_id FROM users WHERE id=?", session.user_id)!;
  return { ...session, user, groupId: group.group_id };
}

export function getDiscoverySessionKey(input: { deviceId: string; userId: string; groupId: string }) {
  const device = row<{ token_hash: string }>(`SELECT ds.token_hash FROM device_sessions ds
    JOIN users u ON u.id=ds.user_id WHERE ds.device_id=? AND u.id=? AND u.group_id=?`,
  input.deviceId, input.userId, input.groupId);
  // Legacy sessions store a base64url-encoded token. Decode only inside the
  // server for HMAC; never return the key from an API or write it to logs.
  // A revoked/expired session can identify its original server, but this proof
  // grants no API access. Normal sync still returns 401 and protects its outbox.
  return device ? Buffer.from(device.token_hash, "base64url") : null;
}

export function isActiveHouseholdMaster(userId: string, groupId: string) {
  return Boolean(row<{ active: number }>(
    "SELECT active FROM users WHERE id=? AND group_id=? AND role='master'", userId, groupId,
  )?.active);
}

export function updateCurrentDeviceName(deviceId: string, deviceName: string | undefined) {
  const name = deviceName?.trim();
  if (!name || name.length > 80) return;
  db.prepare("UPDATE device_sessions SET name=? WHERE device_id=?").run(name, deviceId);
}

function getUser(id: string) {
  const user = row<{ id: string; display_name: string; role: "master" | "member"; default_share_bps: number }>(
    "SELECT id,display_name,role,default_share_bps FROM users WHERE id=?", id)!;
  return { id: user.id, displayName: user.display_name, role: user.role, defaultShareBps: user.default_share_bps };
}

function getTransaction(id: string): LedgerTransaction {
  const tx = row<any>("SELECT * FROM transactions WHERE id=?", id)!;
  const funding = expenseFunding(db, tx.group_id, id);
  const auditRelatedTransactionId = fundedExpenseId(db, tx.group_id, id)
    ?? (tx.reverses_transaction_id ? fundedExpenseId(db, tx.group_id, tx.reverses_transaction_id) : undefined);
  const shares = rows<any>("SELECT user_id,basis_points,amount_minor FROM allocation_shares WHERE transaction_id=?", id);
  return {
    id: tx.id, kind: tx.kind, accountId: tx.account_id, destinationAccountId: tx.destination_account_id,
    amountMinor: tx.amount_minor, currency: tx.currency, categoryId: tx.category_id, note: tx.note,
    occurredAt: tx.occurred_at, createdByUserId: tx.created_by_user_id, status: tx.status,
    reversesTransactionId: tx.reverses_transaction_id,
    paymentAccountId: funding?.account_id ?? null,
    personalPayerAccountId: personalPayerAccountId(db, tx.group_id, id),
    fundingTransactionId: funding?.id ?? null,
    linkedExpenseTransactionId: fundedExpenseId(db, tx.group_id, id) ?? null,
    isAudit: Boolean(auditRelatedTransactionId),
    auditRelatedTransactionId: auditRelatedTransactionId ?? null,
    allocationShares: shares.map((s) => ({ userId: s.user_id, basisPoints: s.basis_points, amountMinor: s.amount_minor })),
  };
}

function mapAccount(account: any, balanceMinor?: number) {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    role: account.role ?? (account.kind === "shared" ? "shared" : "main"),
    ownerUserId: account.owner_user_id,
    currency: account.currency,
    archived: Boolean(account.archived_at),
    ...(balanceMinor === undefined ? {} : { balanceMinor }),
  };
}

function accountBalance(accountId: string) {
  const currentDate = now().slice(0, 10);
  const opening = row<{ opening_balance_minor: number }>("SELECT opening_balance_minor FROM accounts WHERE id=?", accountId)?.opening_balance_minor ?? 0;
  return opening + rows<any>("SELECT * FROM transactions WHERE account_id=? OR destination_account_id=?", accountId, accountId).reduce((sum, tx) => {
    if (tx.status !== "posted" || tx.kind === "reversal") return sum;
    // A posted record remains in history, but money takes effect on its UTC
    // ledger date, including entries whose stored time is later today.
    if (new Date(tx.occurred_at).toISOString().slice(0, 10) > currentDate) return sum;
    if (tx.kind === "transfer") return sum + (tx.account_id === accountId ? -tx.amount_minor : tx.amount_minor);
    return tx.account_id === accountId ? sum + (tx.kind === "income" ? tx.amount_minor : -tx.amount_minor) : sum;
  }, 0);
}

function accountGoalAllocations(groupId: string, accountId: string, viewerUserId?: string) {
  const allocations = rows<any>(
    `SELECT c.goal_id, g.name, COALESCE(SUM(c.amount_minor),0) amount_minor
     FROM savings_goal_contributions c
     JOIN savings_goals g ON g.id=c.goal_id AND g.group_id=c.group_id
     JOIN transactions t ON t.id=c.transaction_id AND t.destination_account_id=?
     WHERE c.group_id=? AND c.reversed_at IS NULL AND t.status='posted'
       AND (g.is_shared=1 OR g.owner_user_id=?) GROUP BY c.goal_id,g.name ORDER BY g.name COLLATE NOCASE`,
    accountId, groupId, viewerUserId ?? "",
  ).map((item) => ({ goalId: item.goal_id, goalName: item.name, amountMinor: item.amount_minor }));
  const allocatedMinor = allocations.reduce((sum, item) => sum + item.amountMinor, 0);
  return { allocations, allocatedMinor, unallocatedMinor: Math.max(0, accountBalance(accountId) - allocatedMinor) };
}

function accountForGroup(groupId: string, accountId: string) {
  return row<{ id: string; name: string; kind: "shared" | "personal"; role: "shared" | "main" | "savings"; owner_user_id: string | null; currency: string; archived_at: string | null }>(
    "SELECT id,name,kind,role,owner_user_id,currency,archived_at FROM accounts WHERE id=? AND group_id=?", accountId, groupId,
  );
}

function validateTransferAccounts(groupId: string, actorUserId: string, sourceId: string, destinationId: string) {
  if (!destinationId || sourceId === destinationId) throw new Error("Transfers need different source and destination accounts");
  const source = accountForGroup(groupId, sourceId);
  const destination = accountForGroup(groupId, destinationId);
  if (!source || !destination) throw new Error("Transfer accounts must belong to the household");
  if (source.archived_at || destination.archived_at) throw new Error("Archived accounts cannot be used for new transfers");
  if (source.currency !== destination.currency) throw new Error("Transfer accounts must use the same currency");
  const personal = [source, destination].filter((account) => account.kind === "personal");
  if (personal.some((account) => account.owner_user_id !== actorUserId)) {
    throw new Error("You can only transfer between your own personal accounts");
  }
  if ((source.role === "savings" || destination.role === "savings") && (source.kind === "shared" || destination.kind === "shared")) {
    throw new Error("Savings accounts cannot transfer directly to shared accounts");
  }
  return { source, destination };
}

export type SavingsAccountInput = { name: string };
export type SavingsAccountUpdate = { name?: string; archived?: boolean };

export function createSavingsAccount(groupId: string, actorUserId: string, deviceId: string, input: SavingsAccountInput) {
  const name = input?.name?.trim();
  if (!name || name.length > 80) throw new Error("Enter a savings account name up to 80 characters");
  const actor = row<{ active: number }>("SELECT active FROM users WHERE id=? AND group_id=?", actorUserId, groupId);
  if (!actor?.active) throw new Error("User is not part of this household");
  const group = row<{ base_currency: string }>("SELECT base_currency FROM groups WHERE id=?", groupId);
  if (!group) throw new Error("Household not found");
  const id = randomUUID();
  db.prepare("INSERT INTO accounts(id,group_id,name,kind,owner_user_id,currency,opening_balance_minor,role,archived_at) VALUES(?,?,?,'personal',?,?,0,'savings',NULL)")
    .run(id, groupId, name, actorUserId, group.base_currency);
  audit(groupId, actorUserId, deviceId, "account.created", "account", id, { role: "savings" });
  return { ...mapAccount(accountForGroup(groupId, id), 0), ...accountGoalAllocations(groupId, id, actorUserId) };
}

export function updateSavingsAccount(groupId: string, actorUserId: string, deviceId: string, accountId: string, input: SavingsAccountUpdate) {
  const account = accountForGroup(groupId, accountId);
  if (!account || account.role !== "savings" || account.owner_user_id !== actorUserId) throw new Error("You cannot manage this savings account");
  if (input?.name !== undefined) {
    const name = input.name.trim();
    if (!name || name.length > 80) throw new Error("Enter a savings account name up to 80 characters");
    db.prepare("UPDATE accounts SET name=? WHERE id=? AND group_id=?").run(name, accountId, groupId);
  }
  if (input?.archived === true) {
    const activeRule = rows<any>("SELECT id,transaction_template_json FROM recurring_rules WHERE group_id=? AND active=1", groupId)
      .find((rule) => {
        const template = JSON.parse(rule.transaction_template_json) as RecurringRuleInput["transactionTemplate"];
        return template.accountId === accountId || template.destinationAccountId === accountId;
      });
    if (activeRule) throw new Error("Pause or remove recurring entries before archiving this account");
    db.prepare("UPDATE accounts SET archived_at=? WHERE id=? AND group_id=?").run(now(), accountId, groupId);
  } else if (input?.archived === false) {
    db.prepare("UPDATE accounts SET archived_at=NULL WHERE id=? AND group_id=?").run(accountId, groupId);
  }
  audit(groupId, actorUserId, deviceId, "account.updated", "account", accountId, input ?? {});
  return { ...mapAccount(accountForGroup(groupId, accountId), accountBalance(accountId)), ...accountGoalAllocations(groupId, accountId, actorUserId) };
}

function mapRecurringRule(rule: any) {
  return {
    id: rule.id,
    cadence: rule.cadence as "weekly" | "monthly",
    intervalMonths: rule.cadence === "monthly" ? rule.interval_months ?? 1 : 1,
    anchorDay: rule.anchor_day ?? new Date(rule.next_run_at).getUTCDate(),
    nextRunAt: rule.next_run_at as string,
    active: Boolean(rule.active),
    assignedUserId: rule.assigned_user_id ?? null,
    endCondition: rule.end_condition ?? "never",
    endAt: rule.end_at ?? null,
    remainingOccurrences: rule.remaining_occurrences ?? null,
    transactionTemplate: JSON.parse(rule.transaction_template_json) as RecurringRuleInput["transactionTemplate"],
  };
}

function validateRecurringTransferAccounts(groupId: string, actorUserId: string, template: RecurringRuleInput["transactionTemplate"]) {
  if (!template.destinationAccountId) throw new Error("Choose a destination savings or main account");
  const { source, destination } = validateTransferAccounts(groupId, actorUserId, template.accountId, template.destinationAccountId);
  if (source.kind !== "personal" || destination.kind !== "personal"
    || !((source.role === "main" && destination.role === "savings")
      || (source.role === "savings" && destination.role === "main"))) {
    throw new Error("Recurring transfers must be between your Main and Savings accounts");
  }
}

function validateRecurringRule(groupId: string, actorUserId: string, input: RecurringRuleInput) {
  const template = input?.transactionTemplate;
  const nextRunAt = new Date(input?.nextRunAt);
  if (!["weekly", "monthly"].includes(input?.cadence)) throw new Error("Choose a weekly or monthly schedule");
  const intervalMonths = input.cadence === "monthly" ? input.intervalMonths ?? 1 : 1;
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 120) {
    throw new Error("Choose a month interval from 1 to 120");
  }
  if (Number.isNaN(nextRunAt.getTime())) throw new Error("Choose a valid first date");
  const endCondition = input.endCondition ?? "never";
  if (!["never", "date", "occurrences"].includes(endCondition)) throw new Error("Choose a valid ending condition");
  let endAt: string | null = null;
  let remainingOccurrences: number | null = null;
  if (endCondition === "date") {
    const endDate = new Date(input.endAt ?? "");
    if (Number.isNaN(endDate.getTime())) throw new Error("Choose a valid ending date");
    if (endDate.toISOString().slice(0, 10) < nextRunAt.toISOString().slice(0, 10)) throw new Error("The ending date cannot be before the next transaction");
    endAt = endDate.toISOString();
  } else if (endCondition === "occurrences") {
    if (!Number.isInteger(input.remainingOccurrences) || (input.remainingOccurrences ?? 0) < 1 || (input.remainingOccurrences ?? 0) > 10000) {
      throw new Error("Choose between 1 and 10,000 occurrences");
    }
    remainingOccurrences = input.remainingOccurrences!;
  }
  if (!template || !["income", "expense", "transfer"].includes(template.kind)) throw new Error("Choose a bill, income, or transfer");
  if (!Number.isInteger(template.amountMinor) || template.amountMinor < 1) throw new Error("Enter an amount greater than zero");
  if (!template.note?.trim() || template.note.trim().length > 160) throw new Error("Enter a description up to 160 characters");
  const group = row<{ base_currency: string }>("SELECT base_currency FROM groups WHERE id=?", groupId);
  if (!group || template.currency !== group.base_currency) throw new Error("Currency must match the household");
  const account = row<{ kind: "shared" | "personal"; owner_user_id: string | null; archived_at: string | null }>(
    "SELECT kind,owner_user_id,archived_at FROM accounts WHERE id=? AND group_id=?",
    template.accountId,
    groupId,
  );
  if (!account || (account.kind === "personal" && account.owner_user_id !== actorUserId)) {
    throw new Error("Choose an account you can use");
  }
  if (account.archived_at) throw new Error("Archived accounts cannot be used for recurring entries");
  const actor = row<{ role: "master" | "member" }>("SELECT role FROM users WHERE id=? AND group_id=?", actorUserId, groupId);
  if (!actor) throw new Error("User is not part of this household");
  if (account.kind === "shared" && actor.role !== "master") {
    throw new Error("Only the master user can manage recurring entries for the shared household");
  }
  if (template.kind === "transfer") validateRecurringTransferAccounts(groupId, actorUserId, template);
  else if (template.destinationAccountId) throw new Error("Only transfers can have a destination account");
  const assignedUserId = input.assignedUserId ?? null;
  if (assignedUserId !== null) {
    const assignedUser = row<{ id: string; active: number }>(
      "SELECT id,active FROM users WHERE id=? AND group_id=?",
      assignedUserId,
      groupId,
    );
    if (!assignedUser?.active) throw new Error("Choose an active household member to assign this entry to");
    if (account.kind !== "shared") throw new Error("Personal recurring entries cannot be assigned to another user");
  }
  const category = row<{ id: string; scope: "shared" | "personal"; owner_user_id: string | null; archived_at: string | null; is_system: number }>(
    "SELECT id,scope,owner_user_id,archived_at,is_system FROM categories WHERE id=? AND group_id=?",
    template.categoryId,
    groupId,
  );
  if (!category || (category.scope === "personal" && category.owner_user_id !== actorUserId)) {
    throw new Error("Choose a category you can use");
  }
  if (category.archived_at) throw new Error("Choose an active category");
  if (template.kind === "income" && category.id !== "income") throw new Error("Choose the income category");
  if (template.kind === "transfer" && category.id !== "transfer") throw new Error("Choose the transfer category");
  if (template.kind === "expense" && (category.is_system || category.scope !== account.kind)) {
    throw new Error("Choose an expense category for the selected account");
  }
  if (template.kind === "expense" && category.scope === "personal" && account.owner_user_id !== category.owner_user_id) {
    throw new Error("Personal categories require the matching personal account");
  }
  return {
    ...input,
    intervalMonths,
    nextRunAt: nextRunAt.toISOString(),
    assignedUserId,
    endCondition,
    endAt,
    remainingOccurrences,
    transactionTemplate: { ...template, note: template.note.trim() },
  };
}

function assertRecurringRulePermission(groupId: string, actorUserId: string, rule: any) {
  const actor = row<{ role: "master" | "member" }>("SELECT role FROM users WHERE id=? AND group_id=?", actorUserId, groupId);
  if (!actor) throw new Error("User is not part of this household");
  const template = JSON.parse(rule.transaction_template_json) as RecurringRuleInput["transactionTemplate"];
  const account = row<{ kind: "shared" | "personal"; owner_user_id: string | null }>(
    "SELECT kind,owner_user_id FROM accounts WHERE id=? AND group_id=?",
    template.accountId,
    groupId,
  );
  if (!account || (account.kind === "personal" && account.owner_user_id !== actorUserId)) {
    throw new Error("You cannot manage this recurring entry");
  }
  if (account.kind === "shared" && actor.role !== "master") {
    throw new Error("Only the master user can manage recurring entries for the shared household");
  }
}

export function createRecurringRule(groupId: string, actorUserId: string, deviceId: string, input: RecurringRuleInput) {
  const value = validateRecurringRule(groupId, actorUserId, input);
  const id = randomUUID();
  db.prepare(`INSERT INTO recurring_rules(
    id,group_id,cadence,next_run_at,transaction_template_json,active,created_by_user_id,anchor_day,assigned_user_id,interval_months,
    end_condition,end_at,remaining_occurrences
  ) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?)`).run(
    id,
    groupId,
    value.cadence,
    value.nextRunAt,
    JSON.stringify(value.transactionTemplate),
    actorUserId,
    new Date(value.nextRunAt).getUTCDate(),
    value.assignedUserId,
    value.intervalMonths,
    value.endCondition,
    value.endAt,
    value.remainingOccurrences,
  );
  audit(groupId, actorUserId, deviceId, "recurring-rule.created", "recurring-rule", id, {});
  return mapRecurringRule(row("SELECT * FROM recurring_rules WHERE id=?", id)!);
}

export function updateRecurringRule(
  groupId: string,
  actorUserId: string,
  deviceId: string,
  ruleId: string,
  input: Partial<RecurringRuleInput> & { active?: boolean },
) {
  const existing = row<any>("SELECT * FROM recurring_rules WHERE id=? AND group_id=?", ruleId, groupId);
  if (!existing) throw new Error("Recurring rule not found");
  assertRecurringRulePermission(groupId, actorUserId, existing);
  const editsDetails = input?.cadence !== undefined
    || input?.intervalMonths !== undefined
    || input?.nextRunAt !== undefined
    || input?.transactionTemplate !== undefined
    || input?.assignedUserId !== undefined
    || input?.endCondition !== undefined
    || input?.endAt !== undefined
    || input?.remainingOccurrences !== undefined;
  if (input?.active === undefined && !editsDetails) throw new Error("Provide a schedule update, assignment, or active status");
  if (input?.active !== undefined && typeof input.active !== "boolean") throw new Error("Active status must be true or false");

  let cadence = existing.cadence as RecurringRuleInput["cadence"];
  let intervalMonths = (existing.interval_months as number | null) ?? 1;
  let nextRunAt = existing.next_run_at as string;
  let transactionTemplate = JSON.parse(existing.transaction_template_json) as RecurringRuleInput["transactionTemplate"];
  let anchorDay = existing.anchor_day as number | null;
  let assignedUserId = existing.assigned_user_id as string | null;
  let endCondition = (existing.end_condition ?? "never") as NonNullable<RecurringRuleInput["endCondition"]>;
  let endAt = existing.end_at as string | null;
  let remainingOccurrences = existing.remaining_occurrences as number | null;
  if (editsDetails) {
    const value = validateRecurringRule(groupId, actorUserId, {
      cadence: input.cadence ?? cadence,
      intervalMonths: input.intervalMonths ?? intervalMonths,
      nextRunAt: input.nextRunAt ?? nextRunAt,
      transactionTemplate: input.transactionTemplate ?? transactionTemplate,
      assignedUserId: input.assignedUserId !== undefined ? input.assignedUserId : assignedUserId,
      endCondition: input.endCondition ?? endCondition,
      endAt: input.endAt !== undefined ? input.endAt : endAt,
      remainingOccurrences: input.remainingOccurrences !== undefined ? input.remainingOccurrences : remainingOccurrences,
    });
    cadence = value.cadence;
    intervalMonths = value.intervalMonths;
    nextRunAt = value.nextRunAt;
    transactionTemplate = value.transactionTemplate;
    assignedUserId = value.assignedUserId ?? null;
    endCondition = value.endCondition ?? "never";
    endAt = value.endAt ?? null;
    remainingOccurrences = value.remainingOccurrences ?? null;
    anchorDay = new Date(value.nextRunAt).getUTCDate();
  }
  const wasEnded = !Boolean(existing.active) && (
    ((existing.end_condition ?? "never") === "occurrences" && (existing.remaining_occurrences ?? 0) === 0)
    || ((existing.end_condition ?? "never") === "date" && existing.end_at && existing.next_run_at.slice(0, 10) > existing.end_at.slice(0, 10))
  );
  const active = input.active ?? (editsDetails && wasEnded ? true : Boolean(existing.active));
  if (active && input.active === true && !editsDetails) {
    validateRecurringRule(groupId, actorUserId, {
      cadence,
      intervalMonths,
      nextRunAt,
      transactionTemplate,
      assignedUserId,
      endCondition,
      endAt,
      remainingOccurrences,
    });
  }
  if (active && endCondition === "occurrences" && (remainingOccurrences ?? 0) < 1) {
    throw new Error("Update the occurrence limit before resuming this recurring entry");
  }
  if (active && endCondition === "date" && endAt && nextRunAt.slice(0, 10) > endAt.slice(0, 10)) {
    throw new Error("Update the ending date before resuming this recurring entry");
  }
  db.prepare(`UPDATE recurring_rules
    SET cadence=?,interval_months=?,next_run_at=?,transaction_template_json=?,active=?,anchor_day=?,assigned_user_id=?,
        end_condition=?,end_at=?,remaining_occurrences=?
    WHERE id=? AND group_id=?`).run(
    cadence, intervalMonths, nextRunAt, JSON.stringify(transactionTemplate), active ? 1 : 0, anchorDay, assignedUserId,
    endCondition, endAt, remainingOccurrences, ruleId, groupId,
  );
  const action = editsDetails
    ? "recurring-rule.updated"
    : active ? "recurring-rule.resumed" : "recurring-rule.paused";
  audit(groupId, actorUserId, deviceId, action, "recurring-rule", ruleId, {});
  return mapRecurringRule(row("SELECT * FROM recurring_rules WHERE id=?", ruleId)!);
}

export function deleteRecurringRule(groupId: string, actorUserId: string, deviceId: string, ruleId: string) {
  const existing = row<any>("SELECT * FROM recurring_rules WHERE id=? AND group_id=?", ruleId, groupId);
  if (!existing) throw new Error("Recurring rule not found");
  assertRecurringRulePermission(groupId, actorUserId, existing);
  const result = db.prepare("DELETE FROM recurring_rules WHERE id=? AND group_id=?").run(ruleId, groupId);
  if (result.changes !== 1) throw new Error("Recurring rule not found");
  audit(groupId, actorUserId, deviceId, "recurring-rule.deleted", "recurring-rule", ruleId, {});
}

function nextRecurringDate(current: string, cadence: "weekly" | "monthly", anchorDay: number, intervalMonths = 1) {
  const date = new Date(current);
  if (cadence === "weekly") {
    date.setUTCDate(date.getUTCDate() + 7);
  } else {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + intervalMonths);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(anchorDay, lastDay));
  }
  return date.toISOString();
}

export function processDueRecurringRules(groupId?: string) {
  // Schedules are calendar dates in the UTC ledger, not appointment times.
  // Existing clients saved local noon; do not wait for that hidden time.
  // Keep the stored timestamp intact for the occurrence's idempotency key.
  const currentDate = now().slice(0, 10);
  const due = groupId
    ? rows<any>(`SELECT * FROM recurring_rules
        WHERE group_id=? AND active=1
          AND (substr(next_run_at,1,10)<=? OR (end_condition='date' AND substr(end_at,1,10)<?))
        ORDER BY next_run_at`, groupId, currentDate, currentDate)
    : rows<any>(`SELECT * FROM recurring_rules
        WHERE active=1
          AND (substr(next_run_at,1,10)<=? OR (end_condition='date' AND substr(end_at,1,10)<?))
        ORDER BY next_run_at`, currentDate, currentDate);
  let created = 0;
  for (const rule of due) {
    let scheduledAt = rule.next_run_at as string;
    let remainingOccurrences = rule.remaining_occurrences as number | null;
    const endCondition = (rule.end_condition ?? "never") as "never" | "date" | "occurrences";
    const endAt = rule.end_at as string | null;
    const template = JSON.parse(rule.transaction_template_json) as RecurringRuleInput["transactionTemplate"];
    const sourceAccount = accountForGroup(rule.group_id, template.accountId);
    if (!sourceAccount || sourceAccount.archived_at) {
      db.prepare("UPDATE recurring_rules SET active=0 WHERE id=? AND group_id=?").run(rule.id, rule.group_id);
      audit(rule.group_id, null, null, "recurring-rule.disabled", "recurring-rule", rule.id, {
        reason: sourceAccount ? "account_archived" : "account_missing",
      });
      continue;
    }
    const actorUserId = rule.assigned_user_id as string | null
      ?? rule.created_by_user_id as string | null
      ?? row<{ id: string }>("SELECT id FROM users WHERE group_id=? ORDER BY role='master' DESC LIMIT 1", rule.group_id)?.id;
    if (!actorUserId) continue;
    if (template.kind === "transfer") {
      try {
        validateRecurringTransferAccounts(rule.group_id, actorUserId, template);
      } catch {
        db.prepare("UPDATE recurring_rules SET active=0 WHERE id=? AND group_id=?").run(rule.id, rule.group_id);
        audit(rule.group_id, null, null, "recurring-rule.disabled", "recurring-rule", rule.id, {
          reason: "transfer_accounts_unavailable",
        });
        continue;
      }
    }
    let occurrences = 0;
    while (scheduledAt.slice(0, 10) <= currentDate && occurrences < 120) {
      if (
        (endCondition === "date" && endAt && scheduledAt.slice(0, 10) > endAt.slice(0, 10))
        || (endCondition === "occurrences" && (remainingOccurrences ?? 0) < 1)
      ) {
        db.prepare("UPDATE recurring_rules SET active=0 WHERE id=?").run(rule.id);
        break;
      }
      const operationId = `recurring:${rule.id}:${scheduledAt}`;
      const nextRunAt = nextRecurringDate(
        scheduledAt,
        rule.cadence,
        rule.anchor_day ?? new Date(scheduledAt).getUTCDate(),
        rule.interval_months ?? 1,
      );
      let nextRemainingOccurrences = remainingOccurrences;
      let remainsActive = true;
      if (!clockAdvanceTransaction) db.exec("BEGIN IMMEDIATE");
      try {
        const alreadyProcessed = Boolean(row("SELECT sequence FROM sync_events WHERE operation_id=?", operationId));
        if (!alreadyProcessed) {
          const transactionId = randomUUID();
          db.prepare(`INSERT INTO transactions(
            id,group_id,kind,account_id,destination_account_id,amount_minor,currency,category_id,note,
            occurred_at,created_by_user_id,status,reverses_transaction_id,operation_id
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'posted',NULL,?)`).run(
            transactionId,
            rule.group_id,
            template.kind,
            template.accountId,
            template.kind === "transfer" ? template.destinationAccountId ?? null : null,
            template.amountMinor,
            template.currency,
            template.categoryId,
            template.note,
            `${scheduledAt.slice(0, 10)}T00:00:00.000Z`,
            actorUserId,
            operationId,
          );
          for (const share of snapshotShares(rule.group_id, template.amountMinor)) {
            db.prepare("INSERT INTO allocation_shares VALUES(?,?,?,?)")
              .run(transactionId, share.userId, share.basisPoints, share.amountMinor);
          }
          db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,?,?)")
            .run(rule.group_id, operationId, "transaction.create", transactionId, now());
          audit(rule.group_id, actorUserId, null, "recurring-rule.executed", "transaction", transactionId, { ruleId: rule.id, scheduledAt });
          created += 1;
          if (endCondition === "occurrences") {
            nextRemainingOccurrences = Math.max(0, (remainingOccurrences ?? 0) - 1);
          }
        }
        remainsActive = !(
          (endCondition === "occurrences" && nextRemainingOccurrences === 0)
          || (endCondition === "date" && endAt && nextRunAt.slice(0, 10) > endAt.slice(0, 10))
        );
        db.prepare("UPDATE recurring_rules SET next_run_at=?,remaining_occurrences=?,active=? WHERE id=?")
          .run(nextRunAt, nextRemainingOccurrences, remainsActive ? 1 : 0, rule.id);
        if (!clockAdvanceTransaction) db.exec("COMMIT");
      } catch (error) {
        if (!clockAdvanceTransaction) db.exec("ROLLBACK");
        throw error;
      }
      scheduledAt = nextRunAt;
      remainingOccurrences = nextRemainingOccurrences;
      occurrences += 1;
      if (!remainsActive) break;
    }
  }
  return created;
}

type CategoryInput = { name?: string; scope?: "shared" | "personal"; color?: string };
type CategoryUpdate = { name?: string; color?: string; archived?: boolean };

function categoryName(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 40) throw new Error("Enter a category name up to 40 characters");
  return value.trim();
}

function categoryColor(value: unknown) {
  if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error("Choose a valid category color");
  return value.toUpperCase();
}

function assertUniqueCategoryName(groupId: string, ownerUserId: string | null, scope: "shared" | "personal", name: string, exceptId = "") {
  const duplicate = row<{ id: string }>(
    "SELECT id FROM categories WHERE group_id=? AND scope=? AND COALESCE(owner_user_id,'')=? AND name=? COLLATE NOCASE AND id<>?",
    groupId, scope, ownerUserId ?? "", name, exceptId,
  );
  if (duplicate) throw new Error("A category with this name already exists");
}

export function createCategory(groupId: string, actorUserId: string, deviceId: string, input: CategoryInput) {
  if (!["shared", "personal"].includes(input?.scope ?? "")) throw new Error("Choose shared or personal");
  const scope = input.scope!;
  if (scope === "shared") assertMaster(groupId, actorUserId);
  const ownerUserId = scope === "personal" ? actorUserId : null;
  const name = categoryName(input.name);
  const color = categoryColor(input.color);
  assertUniqueCategoryName(groupId, ownerUserId, scope, name);
  const id = randomUUID();
  db.prepare("INSERT INTO categories(id,group_id,owner_user_id,name,scope,color,archived_at,is_system) VALUES(?,?,?,?,?,?,NULL,0)")
    .run(id, groupId, ownerUserId, name, scope, color);
  audit(groupId, actorUserId, deviceId, "category.created", "category", id, { scope });
  return getState(groupId, actorUserId);
}

export function updateCategory(groupId: string, actorUserId: string, deviceId: string, categoryId: string, input: CategoryUpdate) {
  const category = row<any>("SELECT * FROM categories WHERE id=? AND group_id=?", categoryId, groupId);
  if (!category) throw new Error("Category not found");
  if (category.is_system) throw new Error("Income and transfer categories cannot be changed");
  if (category.scope === "shared") assertMaster(groupId, actorUserId);
  else if (category.owner_user_id !== actorUserId) throw new Error("You cannot manage this personal category");
  if (input.name === undefined && input.color === undefined && input.archived === undefined) throw new Error("Provide a category update");
  const name = input.name === undefined ? category.name : categoryName(input.name);
  const color = input.color === undefined ? category.color : categoryColor(input.color);
  if (input.archived !== undefined && typeof input.archived !== "boolean") throw new Error("Archived status must be true or false");
  assertUniqueCategoryName(groupId, category.owner_user_id, category.scope, name, categoryId);
  if (input.archived === true) {
    const activeRule = row<{ id: string }>(
      "SELECT id FROM recurring_rules WHERE group_id=? AND active=1 AND json_extract(transaction_template_json,'$.categoryId')=? LIMIT 1",
      groupId, categoryId,
    );
    if (activeRule) throw new Error("Pause or edit recurring entries using this category before archiving it");
  }
  const archivedAt = input.archived === undefined ? category.archived_at : input.archived ? now() : null;
  db.prepare("UPDATE categories SET name=?,color=?,archived_at=? WHERE id=? AND group_id=?")
    .run(name, color, archivedAt, categoryId, groupId);
  audit(groupId, actorUserId, deviceId, input.archived === true ? "category.archived" : input.archived === false ? "category.restored" : "category.updated", "category", categoryId, {});
  return getState(groupId, actorUserId);
}

export type SavingsGoalInput = {
  name?: string; targetMinor?: number; initialSavedMinor?: number; isShared?: boolean;
  accountId?: string; linkedAccountId?: string | null; dueDate?: string; priority?: "high" | "medium" | "low"; operationId?: string;
};
export type SavingsGoalUpdate = Partial<Pick<SavingsGoalInput, "name" | "targetMinor" | "isShared" | "accountId" | "linkedAccountId" | "dueDate" | "priority">>;
export type SavingsGoalContributionInput = { amountMinor?: number; note?: string; operationId?: string };
export type SavingsGoalParticipantInput = { userId?: string; committedMinor?: number; operationId?: string };
export type SavingsGoalParticipantResponseInput = {
  status?: "accepted" | "declined" | "removed";
  personalGoalId?: string | null;
  createPersonalGoal?: boolean;
  operationId?: string;
};
function goalOperationId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new Error("A valid operation ID is required");
  return value;
}

function validateGoalDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid due date");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < now().slice(0, 10)) {
    throw new Error("Due date must be today or later");
  }
  return value;
}
function goalName(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new Error("Enter a goal name up to 80 characters");
  return value.trim();
}
function goalAccount(groupId: string, actorUserId: string, accountId: unknown, isShared: boolean) {
  const account = row<{ kind: "shared" | "personal"; owner_user_id: string | null; archived_at: string | null }>(
    "SELECT kind,owner_user_id,archived_at FROM accounts WHERE id=? AND group_id=?", String(accountId), groupId,
  );
  if (account?.archived_at) throw new Error("Archived accounts cannot be used for savings goals");
  if (!account || (isShared ? account.kind !== "shared" : account.kind !== "personal" || account.owner_user_id !== actorUserId)) {
    throw new Error(isShared ? "Shared goals require the shared account" : "Personal goals require your personal account");
  }
}
function goalLinkedAccount(groupId: string, ownerUserId: string, accountId: unknown, _excludedGoalId?: string) {
  if (accountId === null || accountId === undefined || accountId === "") return;
  const account = accountForGroup(groupId, String(accountId));
  if (!account || account.kind !== "personal" || account.role !== "savings" || account.owner_user_id !== ownerUserId) {
    throw new Error("Linked account must be your active personal savings account");
  }
  if (account.archived_at) throw new Error("Archived accounts cannot be linked to savings goals");
  const group = row<{ base_currency: string }>("SELECT base_currency FROM groups WHERE id=?", groupId);
  if (group && account.currency !== group.base_currency) throw new Error("Linked account must use the household currency");
}
function createGoalTransfer(groupId: string, actorUserId: string, destinationAccountId: string, amountMinor: number, note: string, operationId: string) {
  const group = row<{ base_currency: string }>("SELECT base_currency FROM groups WHERE id=?", groupId)!;
  const source = row<any>("SELECT * FROM accounts WHERE group_id=? AND owner_user_id=? AND kind='personal' AND role='main' AND archived_at IS NULL", groupId, actorUserId);
  const destination = accountForGroup(groupId, destinationAccountId);
  if (!source) throw new Error("An active Main account is required for linked contributions");
  if (!destination || destination.archived_at) throw new Error("The linked savings account is missing or archived");
  if (source.currency !== group.base_currency || destination.currency !== group.base_currency) throw new Error("Linked contribution must use the household currency");
  const transactionId = randomUUID();
  db.prepare(`INSERT INTO transactions(id,group_id,kind,account_id,destination_account_id,amount_minor,currency,category_id,note,occurred_at,created_by_user_id,status,reverses_transaction_id,operation_id) VALUES(?,?,?,?,?,?,?,'transfer',?,?,?,'posted',NULL,?)`)
    .run(transactionId, groupId, "transfer", source.id, destinationAccountId, amountMinor, group.base_currency, note, now(), actorUserId, operationId);
  db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,?,?)").run(groupId, operationId, "transaction.create", transactionId, now());
  return transactionId;
}
function mapSavingsGoal(groupId: string, goal: any, viewerUserId?: string) {
  const contributions = rows<any>(
    "SELECT id,goal_id,contributed_by_user_id,amount_minor,note,occurred_at,transaction_id,reversed_at,shared_goal_id FROM savings_goal_contributions WHERE group_id=? AND (goal_id=? OR shared_goal_id=?) ORDER BY occurred_at",
    groupId, goal.id, goal.is_shared ? goal.id : "",
  )
    .map((c) => ({ id: c.id, goalId: c.goal_id, contributedByUserId: c.contributed_by_user_id, amountMinor: c.amount_minor, note: c.note, occurredAt: c.occurred_at, transactionId: c.transaction_id ?? null, reversedAt: c.reversed_at ?? null, sharedGoalId: c.shared_goal_id ?? null, returnTransactionId: c.return_transaction_id ?? null }));
  const participants = goal.is_shared
    ? rows<any>("SELECT p.id,p.user_id,p.committed_minor,p.status,p.personal_goal_id,p.updated_at,u.display_name FROM savings_goal_participants p JOIN users u ON u.id=p.user_id WHERE p.group_id=? AND p.shared_goal_id=? ORDER BY p.created_at", groupId, goal.id)
      .map((p) => ({
        id: p.id,
        userId: p.user_id,
        displayName: p.display_name,
        committedMinor: p.committed_minor,
        status: p.status,
        acceptedAt: p.status === "accepted" ? p.updated_at : null,
        personalGoalId: p.user_id === viewerUserId ? (p.personal_goal_id ?? null) : null,
      }))
    : [];
  const participation = !goal.is_shared
    ? row<any>("SELECT p.id,p.shared_goal_id,p.committed_minor,p.status FROM savings_goal_participants p WHERE p.group_id=? AND p.personal_goal_id=? ORDER BY p.created_at DESC LIMIT 1", groupId, goal.id)
    : undefined;
  return {
    id: goal.id, name: goal.name, targetMinor: goal.target_minor, currentMinor: goal.current_minor,
    isShared: Boolean(goal.is_shared), ownerUserId: goal.owner_user_id ?? null,
    accountId: goal.account_id ?? "", linkedAccountId: goal.linked_account_id ?? null, dueDate: goal.due_date ?? now().slice(0, 10),
    priority: goal.priority ?? "medium", createdAt: goal.created_at ?? now(), status: goal.status ?? "active",
    cancelledAt: goal.cancelled_at ?? null, cancelledByUserId: goal.cancelled_by_user_id ?? null, contributions,
    participants,
    ...(participation ? { sharedParticipation: { id: participation.id, sharedGoalId: participation.shared_goal_id, committedMinor: participation.committed_minor, status: participation.status } } : {}),
    pendingSettlements: rows<any>("SELECT id,contributed_by_user_id,amount_minor,transaction_id FROM savings_goal_contributions WHERE group_id=? AND (goal_id=? OR shared_goal_id=?) AND transaction_id IS NOT NULL AND reversed_at IS NULL AND return_transaction_id IS NULL", groupId, goal.id, goal.id)
      .map((c) => ({ contributionId: c.id, contributedByUserId: c.contributed_by_user_id, amountMinor: c.amount_minor, transactionId: c.transaction_id })),
  };
}
function assertGoalPermission(groupId: string, actorUserId: string, goal: any, action: "manage" | "contribute") {
  const actor = row<{ role: "master" | "member"; active: number }>("SELECT role,active FROM users WHERE id=? AND group_id=?", actorUserId, groupId);
  if (!actor?.active) throw new Error("User is not part of this household");
  if (goal.is_shared && actor.role !== "master" && action === "manage") throw new Error("Master role required");
  if (!goal.is_shared && goal.owner_user_id !== actorUserId) throw new Error("You cannot manage this personal goal");
}
export function createSavingsGoal(groupId: string, actorUserId: string, deviceId: string, input: SavingsGoalInput) {
  const operationId = goalOperationId(input?.operationId);
  if (operationAlreadyApplied(groupId, operationId) || operationAlreadyAppliedGlobal(operationId)) return getState(groupId, actorUserId);
  if (typeof input?.isShared !== "boolean" || input.name === undefined || input.targetMinor === undefined || input.initialSavedMinor === undefined || input.accountId === undefined || input.dueDate === undefined || !input.priority) throw new Error("Goal name, target, initial amount, scope, account, due date, priority, and operation ID are required");
  const isShared = input.isShared;
  if (isShared) assertMaster(groupId, actorUserId);
  const name = goalName(input.name);
  if (!Number.isInteger(input.targetMinor) || input.targetMinor < 1) throw new Error("Target must be greater than zero");
  if (!Number.isInteger(input.initialSavedMinor) || input.initialSavedMinor < 0) throw new Error("Initial saved amount cannot be negative");
  if (!["high", "medium", "low"].includes(input.priority)) throw new Error("Choose a valid priority");
  const dueDate = validateGoalDate(input.dueDate);
  goalAccount(groupId, actorUserId, input.accountId, isShared);
  const linkedAccountId = input.linkedAccountId ?? null;
  if (linkedAccountId !== null && isShared) throw new Error("Shared goals cannot link a personal savings account");
  if (linkedAccountId !== null) goalLinkedAccount(groupId, actorUserId, linkedAccountId);
  const id = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (operationAlreadyAppliedGlobal(operationId)) { db.exec("ROLLBACK"); return getState(groupId, actorUserId); }
    db.prepare("INSERT INTO savings_goals(id,group_id,owner_user_id,name,target_minor,current_minor,is_shared,account_id,linked_account_id,due_date,priority,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, groupId, isShared ? null : actorUserId, name, input.targetMinor, input.initialSavedMinor, isShared ? 1 : 0, input.accountId, linkedAccountId, dueDate, input.priority, now());
    let initialTransactionId: string | null = null;
    if (input.initialSavedMinor > 0) {
      initialTransactionId = linkedAccountId ? createGoalTransfer(groupId, actorUserId, linkedAccountId, input.initialSavedMinor, "Starting amount", operationId) : null;
      db.prepare("INSERT INTO savings_goal_contributions(id,group_id,goal_id,contributed_by_user_id,amount_minor,note,occurred_at,transaction_id,reversed_at,shared_goal_id) VALUES(?,?,?,?,?,?,?, ?,NULL, NULL)")
        .run(randomUUID(), groupId, id, actorUserId, input.initialSavedMinor, "Starting amount", now(), initialTransactionId);
    }
    if (!initialTransactionId) recordGoalSyncEvent(groupId, operationId, "savings-goal.create", null, actorUserId);
    audit(groupId, actorUserId, deviceId, "savings-goal.created", "savings-goal", id, { operationId });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getState(groupId, actorUserId);
}
export function updateSavingsGoal(groupId: string, actorUserId: string, deviceId: string, goalId: string, input: SavingsGoalUpdate) {
  const goal = row<any>("SELECT * FROM savings_goals WHERE id=? AND group_id=?", goalId, groupId);
  if (!goal) throw new Error("Savings goal not found");
  if (!input || !Object.keys(input).length) throw new Error("Provide a goal update");
  assertGoalPermission(groupId, actorUserId, goal, "manage");
  const isShared = input.isShared ?? Boolean(goal.is_shared);
  if (isShared && !goal.is_shared) assertMaster(groupId, actorUserId);
  const name = input.name === undefined ? goal.name : goalName(input.name);
  const target = input.targetMinor === undefined ? goal.target_minor : input.targetMinor;
  if (!Number.isInteger(target) || target < 1) throw new Error("Target must be greater than zero");
  const accountId = input.accountId ?? goal.account_id ?? "";
  goalAccount(groupId, actorUserId, accountId, isShared);
  const owner = isShared ? null : (goal.is_shared ? actorUserId : goal.owner_user_id);
  const linkedAccountId = isShared ? (input.linkedAccountId ?? null) : (input.linkedAccountId !== undefined ? input.linkedAccountId : (goal.linked_account_id ?? null));
  if (linkedAccountId !== null && (isShared || !owner)) throw new Error("Shared goals cannot link a personal savings account");
  if (linkedAccountId !== null) goalLinkedAccount(groupId, owner, linkedAccountId, goalId);
  const dueDate = input.dueDate === undefined ? goal.due_date ?? now().slice(0, 10) : validateGoalDate(input.dueDate);
  const priority = input.priority ?? goal.priority ?? "medium";
  if (!["high", "medium", "low"].includes(priority)) throw new Error("Choose a valid priority");
  db.prepare("UPDATE savings_goals SET owner_user_id=?,name=?,target_minor=?,is_shared=?,account_id=?,linked_account_id=?,due_date=?,priority=? WHERE id=? AND group_id=?")
    .run(owner, name, target, isShared ? 1 : 0, accountId, linkedAccountId, dueDate, priority, goalId, groupId);
  audit(groupId, actorUserId, deviceId, "savings-goal.updated", "savings-goal", goalId, {});
  return getState(groupId, actorUserId);
}
export function deleteSavingsGoal(groupId: string, actorUserId: string, deviceId: string, goalId: string) {
  return cancelSavingsGoal(groupId, actorUserId, deviceId, goalId, { operationId: randomUUID(), returnFunds: false });
}

function createGoalReturnTransfer(groupId: string, actorUserId: string, sourceAccountId: string, amountMinor: number, note: string, operationId: string) {
  const group = row<{ base_currency: string }>("SELECT base_currency FROM groups WHERE id=?", groupId)!;
  const source = accountForGroup(groupId, sourceAccountId);
  const destination = row<any>("SELECT * FROM accounts WHERE group_id=? AND owner_user_id=? AND kind='personal' AND role='main' AND archived_at IS NULL", groupId, actorUserId);
  if (!source || !destination) throw new Error("An active Main account is required to return goal funds");
  const id = randomUUID();
  db.prepare(`INSERT INTO transactions(id,group_id,kind,account_id,destination_account_id,amount_minor,currency,category_id,note,occurred_at,created_by_user_id,status,reverses_transaction_id,operation_id) VALUES(?,?,?,?,?,?,?,'transfer',?,?,?,'posted',NULL,?)`)
    .run(id, groupId, "transfer", source.id, destination.id, amountMinor, group.base_currency, note, now(), actorUserId, `${operationId}:return:${randomUUID()}`);
  db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,?,?)")
    .run(groupId, `${operationId}:return:${id}`, "transaction.create", id, now());
  return id;
}

export function cancelSavingsGoal(groupId: string, actorUserId: string, deviceId: string, goalId: string, input: SavingsGoalCancellationInput) {
  const operationId = goalOperationId(input?.operationId);
  if (operationAlreadyApplied(groupId, operationId) || operationAlreadyAppliedGlobal(operationId)) return getState(groupId, actorUserId);
  const goal = row<any>("SELECT * FROM savings_goals WHERE id=? AND group_id=?", goalId, groupId);
  if (!goal) throw new Error("Savings goal not found");
  assertGoalPermission(groupId, actorUserId, goal, "manage");
  if (goal.is_shared && input?.returnFunds) throw new Error("Each contribution owner must settle their own shared-goal funds");
  if (goal.status === "cancelled") {
    if (!operationAlreadyAppliedGlobal(operationId)) recordGoalSyncEvent(groupId, operationId, "savings-goal.cancel", null, actorUserId);
    return getState(groupId, actorUserId);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const returned = [];
    if (input?.returnFunds) {
      const contributions = rows<any>("SELECT * FROM savings_goal_contributions WHERE group_id=? AND (goal_id=? OR shared_goal_id=?) AND reversed_at IS NULL AND transaction_id IS NOT NULL AND return_transaction_id IS NULL", groupId, goalId, goalId);
      for (const contribution of contributions) {
        const tx = row<any>("SELECT * FROM transactions WHERE id=? AND status='posted'", contribution.transaction_id);
        if (!tx || tx.destination_account_id !== goal.account_id) continue;
        const returnId = createGoalReturnTransfer(groupId, contribution.contributed_by_user_id, tx.destination_account_id, contribution.amount_minor, `Return cancelled goal: ${goal.name}`, operationId);
        db.prepare("UPDATE savings_goal_contributions SET return_transaction_id=?,reversed_at=? WHERE id=?").run(returnId, now(), contribution.id);
        returned.push(returnId);
      }
    } else {
      // Progress-only reservations have no money to settle. Transfer-backed
      // contributions remain pending until their authenticated owners decide.
      db.prepare("UPDATE savings_goal_contributions SET reversed_at=? WHERE group_id=? AND (goal_id=? OR shared_goal_id=?) AND transaction_id IS NULL AND reversed_at IS NULL").run(now(), groupId, goalId, goalId);
    }
    db.prepare("UPDATE savings_goals SET status='cancelled',cancelled_at=?,cancelled_by_user_id=? WHERE id=? AND group_id=?")
      .run(now(), actorUserId, goalId, groupId);
    refreshGoalTotals(groupId, goalId);
    recordGoalSyncEvent(groupId, operationId, "savings-goal.cancel", returned[0] ?? null, actorUserId);
    audit(groupId, actorUserId, deviceId, "savings-goal.cancelled", "savings-goal", goalId, { operationId, returnFunds: Boolean(input?.returnFunds), returnTransactionIds: returned });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getState(groupId, actorUserId);
}

export function settleSavingsGoal(groupId: string, actorUserId: string, deviceId: string, goalId: string, input: SavingsGoalSettlementInput) {
  const operationId = goalOperationId(input?.operationId);
  if (operationAlreadyApplied(groupId, operationId) || operationAlreadyAppliedGlobal(operationId)) return getState(groupId, actorUserId);
  const goal = row<any>("SELECT * FROM savings_goals WHERE id=? AND group_id=? AND status='cancelled'", goalId, groupId);
  if (!goal) throw new Error("Cancelled savings goal not found");
  const actor = row<{ active: number }>("SELECT active FROM users WHERE id=? AND group_id=?", actorUserId, groupId);
  if (!actor?.active) throw new Error("User is not part of this household");
  db.exec("BEGIN IMMEDIATE");
  try {
    const contributions = rows<any>("SELECT * FROM savings_goal_contributions WHERE group_id=? AND (goal_id=? OR shared_goal_id=?) AND contributed_by_user_id=? AND transaction_id IS NOT NULL AND reversed_at IS NULL AND return_transaction_id IS NULL", groupId, goalId, goalId, actorUserId);
    const returned: string[] = [];
    for (const contribution of contributions) {
      const tx = row<any>("SELECT * FROM transactions WHERE id=? AND status='posted'", contribution.transaction_id);
      if (!tx || tx.destination_account_id !== goal.account_id) continue;
      if (input?.returnFunds) {
        const returnId = createGoalReturnTransfer(groupId, actorUserId, tx.destination_account_id, contribution.amount_minor, `Return cancelled goal: ${goal.name}`, operationId);
        db.prepare("UPDATE savings_goal_contributions SET return_transaction_id=?,reversed_at=? WHERE id=?").run(returnId, now(), contribution.id);
        returned.push(returnId);
      } else {
        db.prepare("UPDATE savings_goal_contributions SET reversed_at=? WHERE id=?").run(now(), contribution.id);
      }
    }
    recordGoalSyncEvent(groupId, operationId, "savings-goal.settle", returned[0] ?? null, actorUserId);
    refreshGoalTotals(groupId, goalId);
    audit(groupId, actorUserId, deviceId, "savings-goal.settled", "savings-goal", goalId, { operationId, returnFunds: Boolean(input?.returnFunds), returnTransactionIds: returned });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getState(groupId, actorUserId);
}
export function contributeToSavingsGoal(groupId: string, actorUserId: string, deviceId: string, goalId: string, input: SavingsGoalContributionInput) {
  const operationId = goalOperationId(input?.operationId);
  if (operationAlreadyApplied(groupId, operationId) || operationAlreadyAppliedGlobal(operationId)) return getState(groupId, actorUserId);
  const goal = row<any>("SELECT * FROM savings_goals WHERE id=? AND group_id=?", goalId, groupId);
  if (!goal) throw new Error("Savings goal not found");
  assertGoalPermission(groupId, actorUserId, goal, "contribute");
  if (goal.linked_account_id) {
    const linked = accountForGroup(groupId, goal.linked_account_id);
    if (!linked || linked.archived_at || linked.kind !== "personal" || linked.role !== "savings" || linked.owner_user_id !== goal.owner_user_id) {
      throw new Error("The linked savings account is missing or archived");
    }
  }
  if (!Number.isInteger(input?.amountMinor) || (input.amountMinor ?? 0) < 1) throw new Error("Contribution must be a positive integer");
  const note = input.note === undefined ? null : input.note;
  if (note !== null && (typeof note !== "string" || note.length > 160)) throw new Error("Note must be 160 characters or fewer");
  const amountMinor = input.amountMinor!;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (operationAlreadyAppliedGlobal(operationId)) { db.exec("ROLLBACK"); return getState(groupId, actorUserId); }
    let transactionId: string | null = null;
    if (goal.linked_account_id) {
      transactionId = createGoalTransfer(groupId, actorUserId, goal.linked_account_id, amountMinor, note ?? "Savings goal contribution", operationId);
    }
    const participation = row<{ shared_goal_id: string; status: string }>(
      "SELECT shared_goal_id,status FROM savings_goal_participants WHERE group_id=? AND personal_goal_id=?",
      groupId, goalId,
    );
    const sharedGoalId = participation?.status === "accepted" ? participation.shared_goal_id : null;
    db.prepare("INSERT INTO savings_goal_contributions(id,group_id,goal_id,contributed_by_user_id,amount_minor,note,occurred_at,transaction_id,reversed_at,shared_goal_id) VALUES(?,?,?,?,?,?,?, ?,NULL,?)").run(randomUUID(), groupId, goalId, actorUserId, amountMinor, note, now(), transactionId, sharedGoalId);
    if (!transactionId) recordGoalSyncEvent(groupId, operationId, "savings-goal.contribution", null, actorUserId);
    refreshGoalTotals(groupId, goalId, sharedGoalId);
    audit(groupId, actorUserId, deviceId, "savings-goal.contributed", "savings-goal", goalId, { amountMinor });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getState(groupId, actorUserId);
}

export function cancelSavingsGoalContribution(
  groupId: string, actorUserId: string, deviceId: string, goalId: string,
  contributionId: string, input: SavingsGoalContributionCancellationInput,
) {
  if (!input || Object.keys(input).some((key) => key !== "operationId")) {
    throw new Error("Contribution cancellation only accepts an operation ID");
  }
  const operationId = goalOperationId(input.operationId);
  const actor = row<{ active: number }>("SELECT active FROM users WHERE id=? AND group_id=?", actorUserId, groupId);
  if (!actor?.active) throw new Error("User is not part of this household");
  db.exec("BEGIN IMMEDIATE");
  try {
    const contribution = row<{
      id: string; goal_id: string; shared_goal_id: string | null;
      contributed_by_user_id: string; transaction_id: string | null; reversed_at: string | null;
    }>("SELECT * FROM savings_goal_contributions WHERE id=? AND group_id=? AND (goal_id=? OR shared_goal_id=?)",
      contributionId, groupId, goalId, goalId);
    if (!contribution) throw new Error("Contribution not found");
    if (contribution.contributed_by_user_id !== actorUserId) throw new Error("You can only cancel your own contributions");
    if (operationAlreadyApplied(groupId, operationId) || contribution.reversed_at) {
      db.exec("COMMIT");
      return getState(groupId, actorUserId);
    }
    if (operationAlreadyAppliedGlobal(operationId)) throw new Error("Operation ID already used");
    const goal = row<{ status: string }>("SELECT status FROM savings_goals WHERE group_id=? AND id=?", groupId, goalId);
    const sourceGoal = row<{ status: string }>("SELECT status FROM savings_goals WHERE group_id=? AND id=?", groupId, contribution.goal_id);
    if (goal?.status !== "active" || sourceGoal?.status !== "active") {
      throw new Error("Use settlement for contributions belonging to a cancelled goal");
    }
    // This releases an allocation only. Never reverse, replace, or return the
    // linked transfer: money remains in its account as unallocated savings.
    db.prepare("UPDATE savings_goal_contributions SET reversed_at=? WHERE id=? AND group_id=? AND reversed_at IS NULL")
      .run(now(), contributionId, groupId);
    refreshGoalTotals(groupId, contribution.goal_id, contribution.shared_goal_id);
    recordGoalSyncEvent(groupId, operationId, "savings-goal.contribution-cancelled", null, actorUserId);
    audit(groupId, actorUserId, deviceId, "savings-goal.contribution-cancelled", "savings-goal-contribution", contributionId, {
      operationId, goalId: contribution.goal_id, sharedGoalId: contribution.shared_goal_id, transferUnchanged: true,
    });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getState(groupId, actorUserId);
}

function participantOperationId(input: SavingsGoalParticipantInput) {
  return goalOperationId(input?.operationId);
}

export function inviteSavingsGoalParticipant(groupId: string, actorUserId: string, deviceId: string, sharedGoalId: string, input: SavingsGoalParticipantInput) {
  const operationId = participantOperationId(input);
  if (operationAlreadyApplied(groupId, operationId) || operationAlreadyAppliedGlobal(operationId)) return getState(groupId, actorUserId);
  assertMaster(groupId, actorUserId);
  const sharedGoal = row<any>("SELECT * FROM savings_goals WHERE id=? AND group_id=? AND is_shared=1", sharedGoalId, groupId);
  if (!sharedGoal) throw new Error("Shared savings goal not found");
  const userId = typeof input.userId === "string" ? input.userId : "";
  const user = row<{ id: string; active: number }>("SELECT id,active FROM users WHERE id=? AND group_id=?", userId, groupId);
  if (!user?.active) throw new Error("Choose an active household member");
  const committedMinor = input.committedMinor;
  if (!Number.isInteger(committedMinor) || (committedMinor ?? 0) < 1) throw new Error("Participant quota must be greater than zero");
  const quota = committedMinor as number;
  if ("personalGoalId" in input) throw new Error("Choose a personal goal when accepting the invitation");
  const existing = row<{ id: string; status: string }>("SELECT id,status FROM savings_goal_participants WHERE group_id=? AND shared_goal_id=? AND user_id=?", groupId, sharedGoalId, userId);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (existing) {
      if (existing.status === "accepted") {
        recordGoalSyncEvent(groupId, operationId, "savings-goal.participant-invite-noop", null, actorUserId);
        db.exec("COMMIT");
        return getState(groupId, actorUserId);
      }
      db.prepare("UPDATE savings_goal_participants SET committed_minor=?,status='pending',updated_at=? WHERE id=?").run(quota, now(), existing.id);
    } else {
      db.prepare("INSERT INTO savings_goal_participants(id,group_id,shared_goal_id,user_id,personal_goal_id,committed_minor,status,created_at,updated_at) VALUES(?,?,?,?,NULL,?,?, ?,?)")
        .run(randomUUID(), groupId, sharedGoalId, userId, quota, "pending", now(), now());
    }
    recordGoalSyncEvent(groupId, operationId, "savings-goal.participant-invited", null, actorUserId);
    audit(groupId, actorUserId, deviceId, "savings-goal.participant-invited", "savings-goal", sharedGoalId, { userId });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getState(groupId, actorUserId);
}

export function respondToSavingsGoalInvitation(groupId: string, actorUserId: string, deviceId: string, participantId: string, input: SavingsGoalParticipantResponseInput) {
  const operationId = participantOperationId(input);
  if (operationAlreadyApplied(groupId, operationId) || operationAlreadyAppliedGlobal(operationId)) return getState(groupId, actorUserId);
  const participant = row<any>("SELECT * FROM savings_goal_participants WHERE id=? AND group_id=?", participantId, groupId);
  if (!participant) throw new Error("Savings goal invitation not found");
  const status = input.status;
  if (status !== "accepted" && status !== "declined" && status !== "removed") throw new Error("Choose accepted, declined, or removed");
  const actor = row<{ role: "master" | "member" }>("SELECT role FROM users WHERE id=? AND group_id=? AND active=1", actorUserId, groupId);
  if (!actor) throw new Error("User is not part of this household");
  if (status !== "removed" && participant.user_id !== actorUserId) throw new Error("You can only respond to your own invitation");
  if (status === "removed" && participant.user_id !== actorUserId && actor.role !== "master") throw new Error("You cannot remove this participation");
  const repairingAcceptedMapping = status === "accepted" && participant.status === "accepted" && !participant.personal_goal_id;
  if (participant.status !== "pending" && !(status === "removed" && participant.status === "accepted") && !repairingAcceptedMapping) {
    throw new Error("This invitation has already been answered");
  }
  let personalGoalId: string | null = null;
  let createPersonalGoal = false;
  if (status === "accepted") {
    personalGoalId = input.personalGoalId ?? null;
    createPersonalGoal = !personalGoalId && input.createPersonalGoal !== false;
    if (personalGoalId && input.createPersonalGoal === true) throw new Error("Choose an existing personal goal or create a new one");
    if (personalGoalId) {
      const personal = row<any>("SELECT id,owner_user_id,is_shared FROM savings_goals WHERE id=? AND group_id=?", personalGoalId, groupId);
      if (!personal || personal.is_shared || personal.owner_user_id !== actorUserId) throw new Error("Personal goal must belong to you");
      const mapped = row<{ id: string }>(
        "SELECT id FROM savings_goal_participants WHERE group_id=? AND personal_goal_id=? AND status IN ('pending','accepted') AND id<>?",
        groupId, personalGoalId, participantId,
      );
      if (mapped) throw new Error("This personal goal is already mapped to another shared goal");
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (createPersonalGoal) {
      const sharedGoal = row<any>("SELECT name,due_date,priority FROM savings_goals WHERE id=? AND group_id=? AND is_shared=1", participant.shared_goal_id, groupId);
      if (!sharedGoal) throw new Error("Shared savings goal not found");
      const mainAccount = row<{ id: string }>(
        "SELECT id FROM accounts WHERE group_id=? AND owner_user_id=? AND kind='personal' AND role='main' AND archived_at IS NULL LIMIT 1",
        groupId, actorUserId,
      );
      if (!mainAccount) throw new Error("An active Main account is required to create your personal goal");
      personalGoalId = randomUUID();
      db.prepare("INSERT INTO savings_goals(id,group_id,owner_user_id,name,target_minor,current_minor,is_shared,account_id,linked_account_id,due_date,priority,created_at) VALUES(?,?,?,?,?,0,0,?,NULL,?,?,?)")
        .run(
          personalGoalId,
          groupId,
          actorUserId,
          sharedGoal.name,
          participant.committed_minor,
          mainAccount.id,
          sharedGoal.due_date ?? now().slice(0, 10),
          sharedGoal.priority ?? "medium",
          now(),
        );
      audit(groupId, actorUserId, deviceId, "savings-goal.created-from-invitation", "savings-goal", personalGoalId, {
        participantId,
        sharedGoalId: participant.shared_goal_id,
      });
    }
    db.prepare("UPDATE savings_goal_participants SET status=?,personal_goal_id=?,updated_at=? WHERE id=? AND group_id=?")
      .run(status, personalGoalId, now(), participantId, groupId);
    recordGoalSyncEvent(groupId, operationId, `savings-goal.participant-${status}`, null, actorUserId);
    audit(groupId, actorUserId, deviceId, `savings-goal.participant-${status}`, "savings-goal-participant", participantId, {
      createdPersonalGoal: createPersonalGoal,
    });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getState(groupId, actorUserId);
}


function budgetSpent(groupId: string, categoryId: string, month: string) {
  return row<{ spent: number }>(
    `SELECT COALESCE(SUM(amount_minor),0) spent FROM transactions
     WHERE group_id=? AND category_id=? AND kind='expense' AND status='posted'
       AND reverses_transaction_id IS NULL AND substr(occurred_at,1,7)=?`,
    groupId, categoryId, month,
  )?.spent ?? 0;
}

function ensureBudgetSnapshots(groupId: string, month: string) {
  const categories = rows<{ id: string }>(
    "SELECT id FROM categories WHERE group_id=? AND scope IN ('shared','personal') AND archived_at IS NULL AND is_system=0",
    groupId,
  );
  for (const category of categories) {
    const exists = row<{ id: string }>("SELECT id FROM budgets WHERE group_id=? AND category_id=? AND month=?", groupId, category.id, month);
    if (exists) continue;
    const latest = row<any>(
      "SELECT * FROM budgets WHERE group_id=? AND category_id=? AND month<? ORDER BY month DESC LIMIT 1",
      groupId,
      category.id,
      month,
    );
    if (latest) {
      db.prepare("INSERT INTO budgets(id,group_id,category_id,month,limit_minor,warning_percent,rollover_minor,enabled) VALUES(?,?,?,?,?,?,0,?)")
        .run(randomUUID(), groupId, category.id, month, latest.limit_minor, latest.warning_percent, latest.enabled ? 1 : 0);
    }
  }
}

function mapBudget(groupId: string, budget: any) {
  const spentMinor = budgetSpent(groupId, budget.category_id, budget.month);
  const percentUsed = budget.limit_minor > 0 ? (spentMinor / budget.limit_minor) * 100 : 0;
  const status = !budget.enabled ? "normal" : percentUsed > 100 ? "over" : percentUsed === 100 ? "at_limit" : percentUsed >= budget.warning_percent ? "warning" : "normal";
  return {
    id: budget.id, categoryId: budget.category_id, month: budget.month, limitMinor: budget.limit_minor,
    warningPercent: budget.warning_percent, rolloverMinor: 0, enabled: Boolean(budget.enabled),
    spentMinor, percentUsed, status,
  };
}

function visibleBudgetCategory(groupId: string, actorUserId: string, categoryId: string) {
  const category = row<{ scope: "shared" | "personal"; owner_user_id: string | null; archived_at: string | null; is_system: number }>(
    "SELECT scope,owner_user_id,archived_at,is_system FROM categories WHERE id=? AND group_id=?", categoryId, groupId,
  );
  if (!category || category.archived_at || category.is_system) throw new Error("Choose an active expense category");
  if (category.scope === "personal" && category.owner_user_id !== actorUserId) throw new Error("You cannot manage this personal budget");
  if (category.scope === "shared") {
    const actor = row<{ role: "master" | "member"; active: number }>("SELECT role,active FROM users WHERE id=? AND group_id=?", actorUserId, groupId);
    if (!actor?.active) throw new Error("User is not part of this household");
  }
  return category;
}

function assertBudgetWritePermission(groupId: string, actorUserId: string, category: { scope: "shared" | "personal"; owner_user_id: string | null }) {
  if (category.scope === "shared") assertMaster(groupId, actorUserId);
}

export type BudgetInput = { categoryId?: string; limitMinor?: number; warningPercent?: number; enabled?: boolean };
export function createBudget(groupId: string, actorUserId: string, deviceId: string, input: BudgetInput) {
  return updateBudget(groupId, actorUserId, deviceId, input.categoryId ?? "", input);
}
export function updateBudget(groupId: string, actorUserId: string, deviceId: string, categoryId: string, input: BudgetInput) {
  const category = visibleBudgetCategory(groupId, actorUserId, categoryId);
  assertBudgetWritePermission(groupId, actorUserId, category);
  if (!Number.isInteger(input.limitMinor) || (input.limitMinor ?? 0) < 1) throw new Error("Budget must be greater than zero");
  if (!Number.isInteger(input.warningPercent) || (input.warningPercent ?? 0) < 1 || (input.warningPercent ?? 0) > 100) throw new Error("Warning threshold must be between 1 and 100");
  if (typeof input.enabled !== "boolean") throw new Error("Enabled status is required");
  const month = now().slice(0, 7);
  ensureBudgetSnapshots(groupId, month);
  db.prepare(`INSERT INTO budgets(id,group_id,category_id,month,limit_minor,warning_percent,rollover_minor,enabled)
    VALUES(?,?,?,?,?,?,0,?) ON CONFLICT(group_id,category_id,month) DO UPDATE SET limit_minor=excluded.limit_minor,warning_percent=excluded.warning_percent,enabled=excluded.enabled`)
    .run(randomUUID(), groupId, categoryId, month, input.limitMinor!, input.warningPercent!, input.enabled ? 1 : 0);
  audit(groupId, actorUserId, deviceId, "budget.updated", "budget", categoryId, { month });
  return getState(groupId, actorUserId);
}
export function deleteBudget(groupId: string, actorUserId: string, deviceId: string, categoryId: string) {
  const category = visibleBudgetCategory(groupId, actorUserId, categoryId);
  assertBudgetWritePermission(groupId, actorUserId, category);
  const month = now().slice(0, 7);
  ensureBudgetSnapshots(groupId, month);
  db.prepare("UPDATE budgets SET enabled=0 WHERE group_id=? AND category_id=? AND month=?").run(groupId, categoryId, month);
  audit(groupId, actorUserId, deviceId, "budget.disabled", "budget", categoryId, { month });
}

export function acknowledgeBudgetAlert(groupId: string, actorUserId: string, deviceId: string, alertId: string) {
  const alert = row<{ category_id: string }>(
    "SELECT category_id FROM budget_alerts WHERE id=? AND group_id=? AND acknowledged_at IS NULL",
    alertId,
    groupId,
  );
  if (!alert) throw new Error("Budget alert not found");
  visibleBudgetCategory(groupId, actorUserId, alert.category_id);
  db.prepare("UPDATE budget_alerts SET acknowledged_at=? WHERE id=? AND group_id=?").run(now(), alertId, groupId);
  audit(groupId, actorUserId, deviceId, "budget-alert.acknowledged", "budget-alert", alertId, {});
  return getState(groupId, actorUserId);
}

// Shared accounts belong to the household; personal accounts belong only to their owner,
// including when the viewer is the household master.
function visibleAccountIds(groupId: string, viewerUserId: string) {
  return new Set(rows<{ id: string }>(
    "SELECT id FROM accounts WHERE group_id=? AND (kind='shared' OR owner_user_id=?)",
    groupId, viewerUserId,
  ).map((account) => account.id));
}

function canViewTransaction(transaction: LedgerTransaction, accountIds: Set<string>) {
  return accountIds.has(transaction.accountId)
    || (transaction.destinationAccountId !== null && accountIds.has(transaction.destinationAccountId));
}

function scopeTransaction(transaction: LedgerTransaction, accountIds: Set<string>): LedgerTransaction {
  return {
    ...transaction,
    // A shared transfer remains visible, but its other endpoint must not
    // identify another member's personal account.
    accountId: accountIds.has(transaction.accountId) ? transaction.accountId : "hidden-personal-account",
    destinationAccountId: transaction.destinationAccountId && accountIds.has(transaction.destinationAccountId)
      ? transaction.destinationAccountId : null,
    paymentAccountId: transaction.paymentAccountId && !accountIds.has(transaction.paymentAccountId)
      ? "hidden-personal-account" : transaction.paymentAccountId,
    personalPayerAccountId: transaction.personalPayerAccountId && !accountIds.has(transaction.personalPayerAccountId)
      ? "hidden-personal-account" : transaction.personalPayerAccountId,
  };
}

export function getState(groupId: string, viewerUserId: string) {
  const viewer = row<{ active: number }>("SELECT active FROM users WHERE id=? AND group_id=?", viewerUserId, groupId);
  if (!viewer?.active) throw new Error("User is not part of this household");
  processDueRecurringRules(groupId);
  const month = now().slice(0, 7);
  ensureBudgetSnapshots(groupId, month);
  const transactionMonths = rows<{ month: string }>(
    'SELECT DISTINCT substr(occurred_at,1,7) AS "month" FROM transactions WHERE group_id=? AND substr(occurred_at,1,7)<?',
    groupId,
    month,
  );
  for (const transactionMonth of transactionMonths) ensureBudgetSnapshots(groupId, transactionMonth.month);
  const group = row<any>("SELECT * FROM groups WHERE id=?", groupId)!;
   const accountIds = visibleAccountIds(groupId, viewerUserId);
   const budgets = rows<any>("SELECT * FROM budgets WHERE group_id=? AND month<=? AND category_id IN (SELECT id FROM categories WHERE group_id=? AND (scope='shared' OR owner_user_id=?)) ORDER BY month DESC", groupId, month, groupId, viewerUserId).map((b) => mapBudget(groupId, b));
  for (const budget of budgets.filter((b) => b.month === month && b.enabled)) {
    if (budget.percentUsed >= budget.warningPercent) {
      db.prepare("INSERT OR IGNORE INTO budget_alerts(id,group_id,category_id,month,alert_type,created_at) VALUES(?,?,?,?,?,?)")
        .run(randomUUID(), groupId, budget.categoryId, month, "warning", now());
    }
    if (budget.percentUsed > 100) {
      db.prepare("INSERT OR IGNORE INTO budget_alerts(id,group_id,category_id,month,alert_type,created_at) VALUES(?,?,?,?,?,?)")
        .run(randomUUID(), groupId, budget.categoryId, month, "over", now());
    }
  }
  return {
     groupId, groupName: group.name, baseCurrency: group.base_currency,
    serverNow: now(),
    acceleratedTest: acceleratedTestEnabled,
    serverSequence: row<{ sequence: number }>("SELECT COALESCE(MAX(sequence),0) sequence FROM sync_events WHERE group_id=?", groupId)!.sequence,
    capabilities: ["shared-only-purchases", "funding-retirement-audit"],
    users: rows<any>("SELECT * FROM users WHERE group_id=? AND active=1", groupId).map((u) => ({ id: u.id, displayName: u.display_name, role: u.role, defaultShareBps: u.default_share_bps })),
      accounts: rows<any>("SELECT * FROM accounts WHERE group_id=? AND (kind='shared' OR owner_user_id=?)", groupId, viewerUserId).map((a) => ({
       ...mapAccount(a, accountBalance(a.id)),
       ...(a.role === "savings" ? accountGoalAllocations(groupId, a.id, viewerUserId) : {}),
     })),
    categories: rows<any>("SELECT * FROM categories WHERE group_id=? AND (scope='shared' OR owner_user_id=?) ORDER BY scope,name COLLATE NOCASE", groupId, viewerUserId ?? "").map((c) => ({
      id: c.id, name: c.name, scope: c.scope, ownerUserId: c.owner_user_id, color: c.color,
      archived: Boolean(c.archived_at), system: Boolean(c.is_system),
    })),
     // Include either side of a transfer so the visible account's history and
     // balance still reflect transfers to/from another member's account.
     transactions: rows<{ id: string }>(
       `SELECT t.id FROM transactions t WHERE t.group_id=? AND EXISTS (
         SELECT 1 FROM accounts a WHERE a.group_id=t.group_id
           AND (a.id=t.account_id OR a.id=t.destination_account_id)
           AND (a.kind='shared' OR a.owner_user_id=?)
       ) ORDER BY t.occurred_at DESC`,
       groupId, viewerUserId,
     ).map((t) => scopeTransaction(getTransaction(t.id), accountIds)),
    budgets,
     budgetAlerts: rows<any>("SELECT id,category_id,month,alert_type,created_at,acknowledged_at FROM budget_alerts WHERE group_id=? AND category_id IN (SELECT id FROM categories WHERE group_id=? AND (scope='shared' OR owner_user_id=?)) AND acknowledged_at IS NULL ORDER BY created_at DESC", groupId, groupId, viewerUserId).map((a) => ({ id: a.id, categoryId: a.category_id, month: a.month, type: a.alert_type, createdAt: a.created_at })),
      savingsGoals: rows<any>("SELECT * FROM savings_goals WHERE group_id=? AND (is_shared=1 OR owner_user_id=?)", groupId, viewerUserId).map((g) => mapSavingsGoal(groupId, g, viewerUserId)),
    devices: rows<any>("SELECT ds.* FROM device_sessions ds JOIN users u ON u.id=ds.user_id WHERE u.group_id=? AND u.active=1", groupId).map((d) => ({ id: d.device_id, name: d.name, userId: d.user_id, lastSeenAt: d.last_seen_at, revoked: Boolean(d.revoked_at) })),
     recurringRules: rows<any>("SELECT * FROM recurring_rules WHERE group_id=? ORDER BY active DESC,next_run_at", groupId)
       .map(mapRecurringRule).filter((rule) => accountIds.has(rule.transactionTemplate.accountId)),
  };
}

function assertTransactionPermission(groupId: string, actorUserId: string, transaction: LedgerTransaction) {
  if (transaction.isAudit) throw new Error("Audit entries are read-only. Manage the original purchase instead.");
  const actor = row<{ role: "master" | "member"; active: number }>(
    "SELECT role,active FROM users WHERE id=? AND group_id=?", actorUserId, groupId,
  );
  if (!actor?.active) throw new Error("User is not part of this household");
  const accountIds = [transaction.accountId, transaction.destinationAccountId].filter(Boolean) as string[];
  const accounts = accountIds.map((accountId) => row<{ kind: "shared" | "personal"; owner_user_id: string | null }>(
    "SELECT kind,owner_user_id FROM accounts WHERE id=? AND group_id=?", accountId, groupId,
  ));
  if (accounts.some((account) => !account)) throw new Error("Activity account is not in this household");
  if (accounts.some((account) => account!.kind === "shared")
    && actor.role !== "master" && transaction.createdByUserId !== actorUserId) {
    throw new Error("You cannot manage another member's shared activity");
  }
  if (accounts.some((account) => account!.kind === "personal" && account!.owner_user_id !== actorUserId)) {
    throw new Error("You cannot manage this personal activity");
  }
  const funding = expenseFunding(db, groupId, transaction.id);
  if (funding && accountForGroup(groupId, funding.account_id)?.owner_user_id !== actorUserId) {
    throw new Error("Only the payer can change a purchase funded by their personal account");
  }
}

function assertCorrectionCategory(groupId: string, actorUserId: string, transaction: LedgerTransaction, categoryId: string) {
  const category = row<{ id: string; scope: "shared" | "personal"; owner_user_id: string | null; archived_at: string | null; is_system: number }>(
    "SELECT id,scope,owner_user_id,archived_at,is_system FROM categories WHERE id=? AND group_id=?", categoryId, groupId,
  );
  const account = row<{ kind: "shared" | "personal"; owner_user_id: string | null; archived_at: string | null }>(
    "SELECT kind,owner_user_id,archived_at FROM accounts WHERE id=? AND group_id=?", transaction.accountId, groupId,
  );
  if (!category || category.archived_at || (category.scope === "personal" && category.owner_user_id !== actorUserId)) {
    throw new Error("Choose an active category you can use");
  }
  if (transaction.kind === "income" && category.id !== "income") throw new Error("Income activities require the income category");
  if (transaction.kind === "transfer" && category.id !== "transfer") throw new Error("Transfer activities require the transfer category");
  if (transaction.kind === "expense" && (!account || category.is_system || category.scope !== account.kind
    || (category.scope === "personal" && category.owner_user_id !== account.owner_user_id))) {
    throw new Error("Choose an expense category for the selected account");
  }
}

function correctionOccurredAt(value: unknown, fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new Error("Choose a valid activity date");
  }
  return new Date(value).toISOString();
}

function correctionShares(original: LedgerTransaction, amountMinor: number) {
  return original.allocationShares.map((share, index) => ({
    ...share,
    amountMinor: index === original.allocationShares.length - 1
      ? amountMinor - original.allocationShares.slice(0, -1).reduce((sum, item, itemIndex) => sum + Math.round(amountMinor * item.basisPoints / 10000), 0)
      : Math.round(amountMinor * share.basisPoints / 10000),
  }));
}

function operationAlreadyApplied(groupId: string, operationId: string) {
  return row<{ sequence: number }>("SELECT sequence FROM sync_events WHERE group_id=? AND operation_id=?", groupId, operationId);
}
function operationAlreadyAppliedGlobal(operationId: string) {
  return row<{ sequence: number }>("SELECT sequence FROM sync_events WHERE operation_id=?", operationId);
}

function reverseTransactionLeg(groupId: string, actorUserId: string, transaction: LedgerTransaction, operationId: string, reversalId: string, label: string, occurredAt = now()) {
  const updated = db.prepare("UPDATE transactions SET status='reversed' WHERE id=? AND group_id=? AND status='posted'")
    .run(transaction.id, groupId);
  if (updated.changes !== 1) throw new Error("Activity changed; refresh and try again");
  db.prepare(`INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    reversalId, groupId, "reversal", transaction.accountId, transaction.destinationAccountId, transaction.amountMinor,
    transaction.currency, transaction.categoryId, `${label}: ${transaction.note}`, occurredAt,
    actorUserId, "posted", transaction.id, operationId,
  );
}

function purchaseFundingTransaction(groupId: string, transaction: LedgerTransaction) {
  const funding = expenseFunding(db, groupId, transaction.id);
  if (!funding) return null;
  const mapped = getTransaction(funding.id);
  if (mapped.status !== "posted" || mapped.amountMinor !== transaction.amountMinor || mapped.currency !== transaction.currency
    || mapped.destinationAccountId !== transaction.accountId || mapped.occurredAt !== transaction.occurredAt) {
    throw new Error("Linked purchase payment is inconsistent; refresh before changing it");
  }
  return mapped;
}

function recordFundingEvent(groupId: string, operationId: string, transactionId: string, type = "transaction.create") {
  db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,?,?)")
    .run(groupId, `${operationId}:funding`, type, transactionId, now());
}
function refreshGoalTotals(groupId: string, goalId: string, sharedGoalId?: string | null) {
  const goal = row<{ is_shared: number }>("SELECT is_shared FROM savings_goals WHERE group_id=? AND id=?", groupId, goalId);
  if (goal?.is_shared) {
    db.prepare(`UPDATE savings_goals SET current_minor=(
      SELECT COALESCE(SUM(amount_minor),0) FROM savings_goal_contributions
      WHERE group_id=? AND (goal_id=? OR shared_goal_id=?) AND reversed_at IS NULL
    ) WHERE group_id=? AND id=?`).run(groupId, goalId, goalId, groupId, goalId);
  } else {
    db.prepare(`UPDATE savings_goals SET current_minor=(
      SELECT COALESCE(SUM(amount_minor),0) FROM savings_goal_contributions
      WHERE group_id=? AND goal_id=? AND reversed_at IS NULL
    ) WHERE group_id=? AND id=?`).run(groupId, goalId, groupId, goalId);
  }
  if (sharedGoalId) {
    db.prepare(`UPDATE savings_goals SET current_minor=(
      SELECT COALESCE(SUM(amount_minor),0) FROM savings_goal_contributions
      WHERE group_id=? AND (goal_id=? OR shared_goal_id=?) AND reversed_at IS NULL
    ) WHERE group_id=? AND id=? AND is_shared=1`).run(groupId, sharedGoalId, sharedGoalId, groupId, sharedGoalId);
  }
}
function updateGoalContributionForReplacement(groupId: string, originalTransactionId: string, replacementTransactionId: string, amountMinor: number, note: string) {
  const contribution = row<{ id: string; goal_id: string; shared_goal_id: string | null }>(
    "SELECT id,goal_id,shared_goal_id FROM savings_goal_contributions WHERE group_id=? AND transaction_id=? AND reversed_at IS NULL",
    groupId, originalTransactionId,
  );
  if (!contribution) return;
  db.prepare("UPDATE savings_goal_contributions SET transaction_id=?,amount_minor=?,note=? WHERE id=? AND group_id=?")
    .run(replacementTransactionId, amountMinor, note, contribution.id, groupId);
  refreshGoalTotals(groupId, contribution.goal_id, contribution.shared_goal_id);
}
function reverseGoalContribution(groupId: string, transactionId: string) {
  const contribution = row<{ id: string; goal_id: string; shared_goal_id: string | null }>(
    "SELECT id,goal_id,shared_goal_id FROM savings_goal_contributions WHERE group_id=? AND transaction_id=? AND reversed_at IS NULL",
    groupId, transactionId,
  );
  if (!contribution) return;
  db.prepare("UPDATE savings_goal_contributions SET reversed_at=? WHERE id=? AND group_id=?").run(now(), contribution.id, groupId);
  refreshGoalTotals(groupId, contribution.goal_id, contribution.shared_goal_id);
}

export function correctTransaction(
  groupId: string, actorUserId: string, deviceId: string, transactionId: string, input: TransactionCorrectionInput,
) {
  const operationId = input?.operationId?.trim();
  if (!operationId) throw new Error("An operation ID is required");
  if (operationAlreadyApplied(groupId, operationId)) return getState(groupId, actorUserId);
  if (row("SELECT id FROM transactions WHERE id=? AND group_id=?", transactionId, groupId)
    && getTransaction(transactionId).isAudit) throw new Error("Audit entries are read-only.");
  transactionId = fundedExpenseId(db, groupId, transactionId) ?? transactionId;
  const original = row<any>("SELECT * FROM transactions WHERE id=? AND group_id=?", transactionId, groupId);
  if (!original) throw new Error("Transaction not found");
  const mapped = getTransaction(transactionId);
  if (mapped.status === "reversed" || mapped.kind === "reversal" || mapped.reversesTransactionId) {
    throw new Error("This activity has already been corrected or cancelled");
  }
  assertTransactionPermission(groupId, actorUserId, mapped);
  const funding = purchaseFundingTransaction(groupId, mapped);
  if (!Number.isInteger(input.amountMinor) || (input.amountMinor ?? 0) < 1) throw new Error("Amount must be greater than zero");
  if (typeof input.note !== "string" || !input.note.trim() || input.note.trim().length > 160) throw new Error("Enter a description up to 160 characters");
  if (typeof input.categoryId !== "string") throw new Error("Choose a category");
  const occurredAt = correctionOccurredAt(input.occurredAt, mapped.occurredAt);
  const amountMinor = input.amountMinor!;
  const nextNote = input.note.trim();
  const paymentAccountId = input.paymentAccountId === undefined ? mapped.paymentAccountId ?? null : input.paymentAccountId;
  const personalPayerId = input.personalPayerAccountId === undefined
    ? mapped.personalPayerAccountId ?? null : input.personalPayerAccountId;
  if (personalPayerId !== (mapped.personalPayerAccountId ?? null) && actorUserId !== mapped.createdByUserId) {
    throw new Error("Only the activity creator can change its personal payer");
  }
  const payerUnchanged = personalPayerId === (mapped.personalPayerAccountId ?? null);
  const sameUtcDate = new Date(occurredAt).toISOString().slice(0, 10)
    === new Date(mapped.occurredAt).toISOString().slice(0, 10);
  if (amountMinor === mapped.amountMinor && input.categoryId === mapped.categoryId && sameUtcDate && payerUnchanged) {
    if (nextNote === mapped.note) return getState(groupId, actorUserId);
    db.exec("BEGIN IMMEDIATE");
    try {
      const updated = db.prepare("UPDATE transactions SET note=? WHERE id=? AND group_id=? AND status='posted' AND note=?")
        .run(nextNote, transactionId, groupId, mapped.note);
      if (updated.changes !== 1) throw new Error("Activity changed; refresh and try again");
      if (funding) {
        db.prepare("UPDATE transactions SET note=? WHERE id=? AND group_id=? AND status='posted'")
          .run(nextNote, funding.id, groupId);
        recordFundingEvent(groupId, operationId, funding.id, "transaction.note.updated");
      }
      db.prepare("UPDATE savings_goal_contributions SET note=? WHERE group_id=? AND transaction_id=? AND reversed_at IS NULL")
        .run(nextNote, groupId, transactionId);
      db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,?,?)")
        .run(groupId, operationId, "transaction.note.updated", transactionId, now());
      audit(groupId, actorUserId, deviceId, "transaction.note.updated", "transaction", transactionId,
        { operationId, previousNote: mapped.note, newNote: nextNote });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return getState(groupId, actorUserId);
  }
  validateExpensePayment(db, groupId, mapped.createdByUserId, mapped, paymentAccountId);
  validatePersonalPayerAccount(db, groupId, mapped.createdByUserId, mapped, personalPayerId);
  assertCorrectionCategory(groupId, actorUserId, mapped, input.categoryId);
  const reversalId = randomUUID();
  const replacementId = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    reverseTransactionLeg(groupId, actorUserId, mapped, `${operationId}:reversal`, reversalId, "Correction reversal");
    if (funding) reverseTransactionLeg(groupId, actorUserId, funding, `${operationId}:funding-reversal`, randomUUID(), "Correction reversal");
    db.prepare(`INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      replacementId, groupId, mapped.kind, mapped.accountId, mapped.destinationAccountId, amountMinor,
      mapped.currency, input.categoryId, input.note.trim(), occurredAt, mapped.createdByUserId, "posted", null, `${operationId}:replacement`,
    );
    updateGoalContributionForReplacement(groupId, transactionId, replacementId, amountMinor, input.note.trim());
    for (const share of correctionShares(mapped, amountMinor)) {
      db.prepare("INSERT INTO allocation_shares VALUES(?,?,?,?)").run(replacementId, share.userId, share.basisPoints, share.amountMinor);
    }
    setPersonalPayerAccountId(db, groupId, replacementId, personalPayerId);
    const nextFundingId = insertExpenseFunding(db, groupId,
      { ...mapped, id: replacementId, amountMinor, note: nextNote, occurredAt },
      `${operationId}:replacement`, paymentAccountId);
    if (nextFundingId) recordFundingEvent(groupId, operationId, nextFundingId, "transaction.correct");
    else if (funding) recordFundingEvent(groupId, operationId, funding.id, "transaction.cancel");
    db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,?,?)")
      .run(groupId, operationId, "transaction.correct", replacementId, now());
    audit(groupId, actorUserId, deviceId, "transaction.corrected", "transaction", transactionId, { replacementId, operationId });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getState(groupId, actorUserId);
}

export function cancelTransaction(
  groupId: string, actorUserId: string, deviceId: string, transactionId: string, input: TransactionCancellationInput,
) {
  const operationId = input?.operationId?.trim();
  if (!operationId) throw new Error("An operation ID is required");
  if (operationAlreadyApplied(groupId, operationId)) return getState(groupId, actorUserId);
  if (row("SELECT id FROM transactions WHERE id=? AND group_id=?", transactionId, groupId)
    && getTransaction(transactionId).isAudit) throw new Error("Audit entries are read-only.");
  transactionId = fundedExpenseId(db, groupId, transactionId) ?? transactionId;
  const original = row<any>("SELECT * FROM transactions WHERE id=? AND group_id=?", transactionId, groupId);
  if (!original) throw new Error("Transaction not found");
  const mapped = getTransaction(transactionId);
  if (mapped.status === "reversed" || mapped.kind === "reversal" || mapped.reversesTransactionId) {
    throw new Error("This activity has already been corrected or cancelled");
  }
  assertTransactionPermission(groupId, actorUserId, mapped);
  const funding = purchaseFundingTransaction(groupId, mapped);
  const reversalId = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    reverseTransactionLeg(groupId, actorUserId, mapped, `${operationId}:reversal`, reversalId, "Cancellation reversal");
    if (funding) {
      const fundingReversalId = randomUUID();
      reverseTransactionLeg(groupId, actorUserId, funding, `${operationId}:funding-reversal`, fundingReversalId, "Cancellation reversal");
      recordFundingEvent(groupId, operationId, fundingReversalId, "transaction.cancel");
    }
    reverseGoalContribution(groupId, transactionId);
    db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,?,?)")
      .run(groupId, operationId, "transaction.cancel", reversalId, now());
    audit(groupId, actorUserId, deviceId, "transaction.cancelled", "transaction", transactionId, { reversalId, operationId });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getState(groupId, actorUserId);
}

export function sync(groupId: string, actorUserId: string, deviceId: string, cursor: number, operations: any[]) {
  const acknowledgements: any[] = [];
  for (const operation of operations) {
    const existing = row<{ sequence: number }>("SELECT sequence FROM sync_events WHERE operation_id=?", operation.operationId);
    if (existing) {
      acknowledgements.push({ operationId: operation.operationId, status: "duplicate", serverSequence: existing.sequence, error: null });
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      let transactionId: string | null = null;
      if (operation.type === "transaction.create") {
        const tx = operation.payload.transaction as LedgerTransaction;
        const group = row<{ base_currency: string }>("SELECT base_currency FROM groups WHERE id=?", groupId);
        if (!["income", "expense", "transfer"].includes(tx.kind) || !Number.isInteger(tx.amountMinor) || tx.amountMinor <= 0 || tx.currency !== group?.base_currency) throw new Error("Invalid transaction kind, amount or currency");
        if (typeof tx.occurredAt !== "string" || Number.isNaN(new Date(tx.occurredAt).getTime())) throw new Error("Choose a valid activity date");
        if (tx.reversesTransactionId) throw new Error("Use the cancellation operation to reverse an activity");
        if (tx.kind !== "transfer" && tx.destinationAccountId) throw new Error("Only transfers can have a destination account");
        validateExpensePayment(db, groupId, actorUserId, tx, tx.paymentAccountId);
        const sourceAccount = row<{ kind: "shared" | "personal"; owner_user_id: string | null }>(
          "SELECT kind,owner_user_id FROM accounts WHERE id=? AND group_id=? AND archived_at IS NULL",
          tx.accountId, groupId,
        );
        if (!sourceAccount || (sourceAccount.kind === "personal" && sourceAccount.owner_user_id !== actorUserId)) {
          throw new Error("Choose an account you can use");
        }
        validatePersonalPayerAccount(db, groupId, actorUserId, tx, tx.personalPayerAccountId);
        const category = row<{ id: string; scope: "shared" | "personal"; owner_user_id: string | null; archived_at: string | null; is_system: number }>(
          "SELECT id,scope,owner_user_id,archived_at,is_system FROM categories WHERE id=? AND group_id=?",
          tx.categoryId, groupId,
        );
        if (!category || category.archived_at || (category.scope === "personal" && category.owner_user_id !== actorUserId)) {
          throw new Error("Choose an active category you can use");
        }
        if (tx.kind === "expense" && (category.is_system || category.scope !== sourceAccount.kind || (category.scope === "personal" && category.owner_user_id !== sourceAccount.owner_user_id))) {
          throw new Error("Choose an expense category for the selected account");
        }
        if (tx.kind === "income" && category.id !== "income") throw new Error("Choose the income category");
        if (tx.kind === "transfer" && category.id !== "transfer") throw new Error("Choose the transfer category");
        if (tx.kind === "transfer") {
          if (!tx.destinationAccountId || tx.destinationAccountId === tx.accountId) {
            throw new Error("Transfers need different source and destination accounts");
          }
          validateTransferAccounts(groupId, actorUserId, tx.accountId, tx.destinationAccountId);
        }
        transactionId = tx.id;
        db.prepare(`INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          tx.id, groupId, tx.kind, tx.accountId, tx.destinationAccountId, tx.amountMinor, tx.currency,
          tx.categoryId, tx.note, tx.occurredAt, actorUserId, "posted", tx.reversesTransactionId, operation.operationId);
        // A device may have cached household quotes from before a member joined
        // or the master changed the split. Save the server's current quotes for
        // shared expenses rather than accepting a stale client-side snapshot.
        const shares = tx.kind === "expense" && sourceAccount.kind === "shared"
          ? snapshotShares(groupId, tx.amountMinor)
          : tx.allocationShares.length ? tx.allocationShares : snapshotShares(groupId, tx.amountMinor);
        for (const share of shares) db.prepare("INSERT INTO allocation_shares VALUES(?,?,?,?)").run(tx.id, share.userId, share.basisPoints, share.amountMinor);
        const fundingId = insertExpenseFunding(db, groupId, { ...tx, createdByUserId: actorUserId }, operation.operationId, tx.paymentAccountId);
        if (fundingId) recordFundingEvent(groupId, operation.operationId, fundingId);
        setPersonalPayerAccountId(db, groupId, tx.id, tx.personalPayerAccountId);
      } else if (operation.type === "transaction.reverse") {
        const requestedId = operation.payload.transactionId;
        if (row("SELECT id FROM transactions WHERE id=? AND group_id=?", requestedId, groupId)
          && getTransaction(requestedId).isAudit) throw new Error("Audit entries are read-only.");
        const originalId = fundedExpenseId(db, groupId, requestedId) ?? requestedId;
        const originalRow = row<{ id: string }>(
          "SELECT id FROM transactions WHERE id=? AND group_id=?",
          originalId,
          groupId,
        );
        if (!originalRow) throw new Error("Transaction not found in this household");
        const original = getTransaction(originalRow.id);
        if (original.status === "reversed") throw new Error("Transaction already reversed");
        assertTransactionPermission(groupId, actorUserId, original);
        const funding = purchaseFundingTransaction(groupId, original);
        transactionId = operation.payload.reversalId;
        reverseTransactionLeg(groupId, actorUserId, original, operation.operationId, transactionId!, "Reversal", operation.payload.occurredAt);
        if (funding) {
          const fundingReversalId = `${transactionId}:funding`;
          reverseTransactionLeg(groupId, actorUserId, funding, `${operation.operationId}:funding-reversal`, fundingReversalId, "Reversal", operation.payload.occurredAt);
          recordFundingEvent(groupId, operation.operationId, fundingReversalId, "transaction.reverse");
        }
        reverseGoalContribution(groupId, original.id);
      } else throw new Error("Unsupported operation");
      const event = db.prepare("INSERT INTO sync_events(group_id,operation_id,type,transaction_id,occurred_at) VALUES(?,?,?,?,?)")
        .run(groupId, operation.operationId, operation.type, transactionId, now());
      audit(groupId, actorUserId, deviceId, operation.type, "transaction", transactionId!, { operationId: operation.operationId });
      db.exec("COMMIT");
      acknowledgements.push({ operationId: operation.operationId, status: "applied", serverSequence: Number(event.lastInsertRowid), error: null });
    } catch (error) {
      db.exec("ROLLBACK");
      acknowledgements.push({ operationId: operation.operationId, status: "rejected", serverSequence: cursor, error: error instanceof Error ? error.message : "Rejected" });
    }
  }
  const accountIds = visibleAccountIds(groupId, actorUserId);
  const pendingEvents = rows<any>("SELECT * FROM sync_events WHERE group_id=? AND sequence>? ORDER BY sequence", groupId, cursor);
  const events = pendingEvents.map((e) => ({
    sequence: e.sequence, operationId: e.operation_id, type: e.type, occurredAt: e.occurred_at,
    transaction: e.transaction_id ? getTransaction(e.transaction_id) : null,
    actorUserId: e.actor_user_id,
  // Old transaction-less events have no actor; fail closed except for household resets.
  })).filter((event) => event.transaction
    ? canViewTransaction(event.transaction, accountIds)
    : event.type === "ledger.reset" || event.actorUserId === actorUserId)
    .map(({ actorUserId: _actorUserId, ...event }) => ({ ...event, transaction: event.transaction ? scopeTransaction(event.transaction, accountIds) : null }));
  // Evaluate current-month budgets in the same request that accepts activity so
  // alert records are durable before the client receives its acknowledgement.
  getState(groupId, actorUserId);
  return { cursor: pendingEvents.at(-1)?.sequence ?? cursor, acknowledgements, events };
}

function snapshotShares(groupId: string, amountMinor: number) {
  const users = rows<{ id: string; default_share_bps: number }>("SELECT id,default_share_bps FROM users WHERE group_id=? AND active=1 ORDER BY id", groupId);
  let assigned = 0;
  return users.map((user, index) => {
    const amount = index === users.length - 1 ? amountMinor - assigned : Math.round(amountMinor * user.default_share_bps / 10000);
    assigned += amount;
    return { userId: user.id, basisPoints: user.default_share_bps, amountMinor: amount };
  });
}

export function dashboard(groupId: string, userId: string) {
  const state = getState(groupId, userId);
  const month = now().slice(0, 7);
  const current = state.transactions.filter((t) => t.occurredAt.startsWith(month) && t.status === "posted" && t.kind !== "reversal");
  const categoryTotals = state.categories.map((c) => ({
    categoryId: c.id, name: c.name, color: c.color,
    amountMinor: current.filter((t) => t.categoryId === c.id && t.kind === "expense").reduce((s, t) => s + t.amountMinor, 0),
  })).filter((c) => c.amountMinor > 0);
  return {
    personalBalanceMinor: state.accounts.filter((a) => a.ownerUserId === userId && a.role === "main").reduce((s, a) => s + accountBalance(a.id), 0),
    sharedBalanceMinor: state.accounts.filter((a) => a.kind === "shared").reduce((s, a) => s + accountBalance(a.id), 0),
    monthIncomeMinor: current.filter((t) => t.kind === "income").reduce((s, t) => s + t.amountMinor, 0),
    monthExpenseMinor: current.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amountMinor, 0),
    pendingOperations: 0, categoryTotals,
    accountBalances: state.accounts.filter((a) => a.ownerUserId === userId || a.kind === "shared").map((a) => ({
      accountId: a.id, balanceMinor: accountBalance(a.id),
    })),
  };
}

export function revoke(groupId: string, actorUserId: string, deviceId: string) {
  const actor = getUser(actorUserId);
  if (actor.role !== "master") throw new Error("Master role required");
  db.prepare("UPDATE device_sessions SET revoked_at=? WHERE device_id=?").run(realNow(), deviceId);
  audit(groupId, actorUserId, deviceId, "device.revoked", "device", deviceId, {});
}

function assertMaster(groupId: string, actorUserId: string) {
  const actor = row<{ role: "master" | "member"; active: number }>(
    "SELECT role,active FROM users WHERE id=? AND group_id=?",
    actorUserId,
    groupId,
  );
  if (!actor?.active || actor.role !== "master") throw new Error("Master role required");
}

export function updateHouseholdAllocations(
  groupId: string,
  actorUserId: string,
  deviceId: string,
  input: { allocations?: Array<{ userId: string; basisPoints: number }> },
) {
  assertMaster(groupId, actorUserId);
  const allocations = input?.allocations;
  const activeUsers = rows<{ id: string }>("SELECT id FROM users WHERE group_id=? AND active=1 ORDER BY id", groupId);
  if (!Array.isArray(allocations) || allocations.length !== activeUsers.length) {
    throw new Error("Provide an allocation for every active household member");
  }
  const expectedIds = new Set(activeUsers.map((user) => user.id));
  const suppliedIds = new Set(allocations.map((allocation) => allocation.userId));
  if (
    suppliedIds.size !== allocations.length
    || allocations.some((allocation) => !expectedIds.has(allocation.userId))
    || allocations.some((allocation) => !Number.isInteger(allocation.basisPoints) || allocation.basisPoints < 0 || allocation.basisPoints > 10000)
  ) {
    throw new Error("Allocations must contain each active household member exactly once");
  }
  if (allocations.reduce((sum, allocation) => sum + allocation.basisPoints, 0) !== 10000) {
    throw new Error("Shared allocations must total 100%");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const update = db.prepare("UPDATE users SET default_share_bps=? WHERE id=? AND group_id=? AND active=1");
    for (const allocation of allocations) update.run(allocation.basisPoints, allocation.userId, groupId);
    audit(groupId, actorUserId, deviceId, "household.allocations-updated", "household", groupId, { allocations });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getState(groupId, actorUserId);
}

export function transferHouseholdMaster(groupId: string, actorUserId: string, deviceId: string, targetUserId: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    assertMaster(groupId, actorUserId);
    if (typeof targetUserId !== "string" || !targetUserId) throw new Error("Choose an active household member");
    if (targetUserId === actorUserId) throw new Error("Choose another household member");
    const target = row<{ role: "master" | "member"; active: number }>(
      "SELECT role,active FROM users WHERE id=? AND group_id=?",
      targetUserId,
      groupId,
    );
    if (!target?.active) throw new Error("Household member not found");
    if (target.role !== "member") throw new Error("Choose an active household member");

    const masters = row<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE group_id=? AND active=1 AND role='master'",
      groupId,
    );
    if (masters?.count !== 1) throw new Error("Household must have exactly one active master");

    const result = db.prepare(
      "UPDATE users SET role=CASE WHEN id=? THEN 'member' WHEN id=? THEN 'master' ELSE role END WHERE group_id=? AND active=1 AND id IN (?,?)",
    ).run(actorUserId, targetUserId, groupId, actorUserId, targetUserId);
    if (result.changes !== 2) throw new Error("Master transfer could not be completed");

    const remainingMasters = row<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE group_id=? AND active=1 AND role='master'",
      groupId,
    );
    if (remainingMasters?.count !== 1) throw new Error("Household must have exactly one active master");

    audit(groupId, actorUserId, deviceId, "household.master-transferred", "user", targetUserId, {
      previousMasterUserId: actorUserId,
      newMasterUserId: targetUserId,
    });
    db.prepare("UPDATE household_invitations SET status='revoked' WHERE group_id=? AND status='pending'").run(groupId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getState(groupId, actorUserId);
}

export function claimHouseholdMaster(_groupId: string, _actorUserId: string, _deviceId: string): never {
  throw new Error("Master assignment by claim is disabled. Use a targeted Master invitation or explicit transfer.");
}

export function removeHouseholdMember(groupId: string, actorUserId: string, deviceId: string, userId: string) {
  assertMaster(groupId, actorUserId);
  if (userId === actorUserId) throw new Error("The master cannot remove their own access");
  const member = row<{ role: "master" | "member"; active: number }>(
    "SELECT role,active FROM users WHERE id=? AND group_id=?",
    userId,
    groupId,
  );
  if (!member?.active) throw new Error("Household member not found");
  if (member.role === "master") throw new Error("The master cannot be removed");
  db.exec("BEGIN IMMEDIATE");
  try {
    const revokedAt = realNow();
    db.prepare("UPDATE device_sessions SET revoked_at=? WHERE user_id=?").run(revokedAt, userId);
    db.prepare("UPDATE users SET active=0,default_share_bps=0 WHERE id=? AND group_id=?").run(userId, groupId);
    db.prepare("UPDATE recurring_rules SET assigned_user_id=NULL WHERE group_id=? AND assigned_user_id=?").run(groupId, userId);
    const remaining = rows<{ id: string; default_share_bps: number }>(
      "SELECT id,default_share_bps FROM users WHERE group_id=? AND active=1 ORDER BY id",
      groupId,
    );
    const total = remaining.reduce((sum, user) => sum + user.default_share_bps, 0);
    if (remaining.length && total !== 10000) {
      const master = remaining.find((user) => user.id === actorUserId)!;
      db.prepare("UPDATE users SET default_share_bps=? WHERE id=?").run(master.default_share_bps + (10000 - total), master.id);
    }
    audit(groupId, actorUserId, deviceId, "household.member-removed", "user", userId, {});
    db.prepare("UPDATE household_invitations SET status='revoked' WHERE group_id=? AND status='pending'").run(groupId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getState(groupId, actorUserId);
}

export function backupDatabase() {
  if (reviewerDemoMode) return null;
  return runEncryptedBackup();
}

export function getReviewerDemoServerIdentity() {
  if (!reviewerDemoMode) throw new Error("Hosted identity is only available in reviewer mode");
  db.prepare("INSERT OR IGNORE INTO runtime_state(key,value) VALUES('review_server_identity',?)").run(randomUUID());
  return row<{ value: string }>("SELECT value FROM runtime_state WHERE key='review_server_identity'")!.value;
}

export function getDatabaseStatus() {
  return {
    path: reviewerDemoMode ? "postgresql:home_ledger_review_demo" : dataPath,
    households: row<{ count: number }>("SELECT COUNT(*) AS count FROM groups")?.count ?? 0,
    users: row<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE active=1")?.count ?? 0,
    transactions: row<{ count: number }>("SELECT COUNT(*) AS count FROM transactions")?.count ?? 0,
  };
}

function audit(groupId: string, actorUserId: string | null, deviceId: string | null, action: string, entityType: string, entityId: string, details: object) {
  db.prepare("INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(), groupId, actorUserId, deviceId, action, entityType, entityId, JSON.stringify(details), now());
}

ensureDemo();
if (!reviewerDemoMode) retireExpenseFunding(db, realNow());