import {
  check,
  index,
  integer,
  pgSchema,
  primaryKey,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const reviewDemoSchema = pgSchema("home_ledger_review_demo");
const review = reviewDemoSchema;

export const reviewGroups = review.table("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull(),
  pairingCode: text("pairing_code").notNull().unique(),
  createdAt: text("created_at").notNull(),
  pairingCodeExpiresAt: text("pairing_code_expires_at"),
});

export const reviewUsers = review.table("users", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  defaultShareBps: integer("default_share_bps").notNull(),
  passwordSalt: text("password_salt"),
  passwordHash: text("password_hash"),
  active: integer("active").notNull().default(1),
});

export const reviewAccounts = review.table("accounts", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  ownerUserId: text("owner_user_id"),
  currency: text("currency").notNull(),
  openingBalanceMinor: integer("opening_balance_minor").notNull().default(0),
  role: text("role").notNull().default("main"),
  archivedAt: text("archived_at"),
});

export const reviewCategories = review.table("categories", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  ownerUserId: text("owner_user_id"),
  name: text("name").notNull(),
  scope: text("scope").notNull(),
  color: text("color").notNull(),
  archivedAt: text("archived_at"),
  isSystem: integer("is_system").notNull().default(0),
});

export const reviewTransactions = review.table("transactions", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  kind: text("kind").notNull(),
  accountId: text("account_id").notNull(),
  destinationAccountId: text("destination_account_id"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  categoryId: text("category_id").notNull(),
  note: text("note").notNull(),
  occurredAt: text("occurred_at").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  status: text("status").notNull(),
  reversesTransactionId: text("reverses_transaction_id"),
  operationId: text("operation_id").notNull().unique(),
}, (table) => [index("idx_transactions_group_date").on(table.groupId, table.occurredAt)]);

export const reviewAllocationShares = review.table("allocation_shares", {
  transactionId: text("transaction_id").notNull(),
  userId: text("user_id").notNull(),
  basisPoints: integer("basis_points").notNull(),
  amountMinor: integer("amount_minor").notNull(),
}, (table) => [uniqueIndex("allocation_shares_pk").on(table.transactionId, table.userId)]);

export const reviewBudgets = review.table("budgets", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  categoryId: text("category_id").notNull(),
  month: text("month").notNull(),
  limitMinor: integer("limit_minor").notNull(),
  warningPercent: integer("warning_percent").notNull(),
  rolloverMinor: integer("rollover_minor").notNull().default(0),
  enabled: integer("enabled").notNull().default(1),
}, (table) => [
  uniqueIndex("idx_budgets_group_category_month").on(table.groupId, table.categoryId, table.month),
]);

export const reviewBudgetItems = review.table("budget_items", {
  groupId: text("group_id").notNull(),
  budgetId: text("budget_id").notNull(),
  itemId: text("item_id").notNull(),
  name: text("name").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  sortOrder: integer("sort_order").notNull(),
}, (table) => [
  primaryKey({ columns: [table.budgetId, table.itemId], name: "budget_items_pk" }),
  check("budget_items_amount_positive", sql`${table.amountMinor} > 0`),
  check("budget_items_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
]);

export const reviewBudgetAlerts = review.table("budget_alerts", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  categoryId: text("category_id").notNull(),
  month: text("month").notNull(),
  alertType: text("alert_type").notNull(),
  createdAt: text("created_at").notNull(),
  acknowledgedAt: text("acknowledged_at"),
}, (table) => [
  uniqueIndex("budget_alerts_group_category_month_type").on(
    table.groupId, table.categoryId, table.month, table.alertType,
  ),
  index("idx_budget_alerts_group_month").on(table.groupId, table.month),
]);

export const reviewSavingsGoals = review.table("savings_goals", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  ownerUserId: text("owner_user_id"),
  name: text("name").notNull(),
  targetMinor: integer("target_minor").notNull(),
  currentMinor: integer("current_minor").notNull().default(0),
  isShared: integer("is_shared").notNull().default(0),
  accountId: text("account_id"),
  linkedAccountId: text("linked_account_id"),
  dueDate: text("due_date"),
  priority: text("priority"),
  createdAt: text("created_at"),
  status: text("status").notNull().default("active"),
  cancelledAt: text("cancelled_at"),
  cancelledByUserId: text("cancelled_by_user_id"),
});

export const reviewSavingsGoalParticipants = review.table("savings_goal_participants", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  sharedGoalId: text("shared_goal_id").notNull(),
  userId: text("user_id").notNull(),
  personalGoalId: text("personal_goal_id"),
  committedMinor: integer("committed_minor").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("savings_goal_participants_goal_user").on(table.sharedGoalId, table.userId)]);

export const reviewSavingsGoalContributions = review.table("savings_goal_contributions", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  goalId: text("goal_id").notNull(),
  contributedByUserId: text("contributed_by_user_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  note: text("note"),
  occurredAt: text("occurred_at").notNull(),
  transactionId: text("transaction_id"),
  reversedAt: text("reversed_at"),
  sharedGoalId: text("shared_goal_id"),
  returnTransactionId: text("return_transaction_id"),
});

export const reviewRecurringRules = review.table("recurring_rules", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  cadence: text("cadence").notNull(),
  nextRunAt: text("next_run_at").notNull(),
  transactionTemplateJson: text("transaction_template_json").notNull(),
  active: integer("active").notNull().default(1),
  createdByUserId: text("created_by_user_id"),
  anchorDay: integer("anchor_day"),
  assignedUserId: text("assigned_user_id"),
  intervalMonths: integer("interval_months").notNull().default(1),
  endCondition: text("end_condition").notNull().default("never"),
  endAt: text("end_at"),
  remainingOccurrences: integer("remaining_occurrences"),
});

export const reviewDeviceSessions = review.table("device_sessions", {
  deviceId: text("device_id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  refreshTokenHash: text("refresh_token_hash"),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  revokedAt: text("revoked_at"),
});

export const reviewHouseholdInvitations = review.table("household_invitations", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  creatorUserId: text("creator_user_id").notNull(),
  displayName: text("display_name"),
  userId: text("user_id"),
  authorizedRole: text("authorized_role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  status: text("status").notNull(),
  source: text("source").notNull().default("http"),
});

export const reviewSyncEvents = review.table("sync_events", {
  sequence: serial("sequence").primaryKey(),
  groupId: text("group_id").notNull(),
  operationId: text("operation_id").notNull().unique(),
  type: text("type").notNull(),
  transactionId: text("transaction_id"),
  occurredAt: text("occurred_at").notNull(),
  actorUserId: text("actor_user_id"),
}, (table) => [index("idx_sync_group_sequence").on(table.groupId, table.sequence)]);

export const reviewAuditEvents = review.table("audit_events", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  actorUserId: text("actor_user_id"),
  deviceId: text("device_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detailsJson: text("details_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const reviewRuntimeState = review.table("runtime_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const reviewSharedExpenseFunding = review.table("shared_expense_funding", {
  groupId: text("group_id").notNull(),
  expenseTransactionId: text("expense_transaction_id").primaryKey(),
  fundingTransactionId: text("funding_transaction_id").notNull().unique(),
}, (table) => [index("idx_expense_funding_group").on(table.groupId)]);

export const reviewSharedExpensePayers = review.table("shared_expense_payers", {
  groupId: text("group_id").notNull(),
  expenseTransactionId: text("expense_transaction_id").primaryKey(),
  personalAccountId: text("personal_account_id").notNull(),
}, (table) => [index("idx_expense_payers_group").on(table.groupId)]);

