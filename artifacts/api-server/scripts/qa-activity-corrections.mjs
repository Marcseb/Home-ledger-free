import { createHttpInvitationSession } from "./invitation-test-helpers.mjs";

const base = process.env.HOME_LEDGER_API;
if (!base) throw new Error("Set HOME_LEDGER_API to an isolated temporary API server started with NODE_ENV=development");
const response = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};
const request = async (path, options = {}) => {
  const result = await response(path, options);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${path} ${result.status}: ${result.body?.error ?? "request failed"}`);
  }
  return result.body;
};
const json = (body, headers = {}) => ({ headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const operationId = () => `qa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createExpense = async (headers, userId, accountId, categoryId, amountMinor, note, occurredAt = new Date().toISOString()) => {
  const transaction = {
    id: operationId(), kind: "expense", accountId, destinationAccountId: null, amountMinor, currency: "USD",
    categoryId, note, occurredAt, createdByUserId: userId, status: "posted",
    reversesTransactionId: null, allocationShares: [],
  };
  const operation = {
    operationId: operationId(), deviceId: "qa", clientCreatedAt: new Date().toISOString(),
    type: "transaction.create", payload: { transaction },
  };
  const synced = await request("/sync", { method: "POST", ...json({ cursor: 0, operations: [operation] }, headers) });
  if (synced.acknowledgements[0]?.status !== "applied") throw new Error("Create was not applied");
  return transaction;
};

const master = await request("/household/setup", {
  method: "POST", ...json({ householdName: "Activity QA", displayName: "Alex", currency: "USD", deviceId: operationId(), deviceName: "activity QA" }),
});
const createMember = (displayName, deviceName) => createHttpInvitationSession(
  (path, body, token) => response(path, { method: "POST", ...json(body, token ? { "x-device-token": token } : {}) }),
  master, { displayName }, operationId(), deviceName,
);
const member = await createMember("Sam", "permission QA");
const otherMember = await createMember("Taylor", "other member QA");
const headers = { "x-device-token": master.deviceToken };
const memberHeaders = { "x-device-token": member.deviceToken };
const otherMemberHeaders = { "x-device-token": otherMember.deviceToken };
const shared = master.state.accounts.find((account) => account.kind === "shared");
const categoryResult = await request("/categories", {
  method: "POST", ...json({ name: "Groceries", scope: "shared", color: "#E67E5F" }, headers),
});
const groceries = categoryResult.categories.find((category) => category.name === "Groceries");
if (!shared || !groceries) throw new Error("Demo household is missing required fixtures");

const startingBalance = (await request("/dashboard", { headers })).sharedBalanceMinor;
const original = await createExpense(headers, master.user.id, shared.id, groceries.id, 1000, "QA original",
  `${new Date().toISOString().slice(0, 10)}T08:17:42.000Z`);
const beforeRename = await request("/bootstrap", { headers });
const renameOperationId = operationId();
const renameInput = {
  operationId: renameOperationId, amountMinor: 1000, categoryId: groceries.id, note: "QA spelling fixed",
  occurredAt: `${original.occurredAt.slice(0, 10)}T12:00:00.000Z`,
};
if (renameInput.occurredAt === original.occurredAt) throw new Error("Same-day correction fixture must change the time");
const forbiddenRename = await response(`/transactions/${original.id}/correction`, {
  method: "POST", ...json({ ...renameInput, operationId: operationId() }, memberHeaders),
});
if (forbiddenRename.status !== 403) throw new Error(`Member label edit should be forbidden, received ${forbiddenRename.status}`);
const renamed = await request(`/transactions/${original.id}/correction`, {
  method: "POST", ...json(renameInput, headers),
});
const renamedOriginal = renamed.transactions.find((transaction) => transaction.id === original.id);
if (renamedOriginal?.note !== renameInput.note || renamedOriginal.status !== "posted"
  || renamed.transactions.length !== beforeRename.transactions.length
  || renamedOriginal.amountMinor !== original.amountMinor || renamedOriginal.categoryId !== original.categoryId
  || renamedOriginal.createdByUserId !== original.createdByUserId
  || renamedOriginal.occurredAt !== original.occurredAt
  || JSON.stringify(renamedOriginal.allocationShares) !== JSON.stringify(beforeRename.transactions.find((transaction) => transaction.id === original.id)?.allocationShares)) {
  throw new Error("Description-only edit changed financial history or failed to keep the original activity");
}
if ((await request("/dashboard", { headers })).sharedBalanceMinor !== startingBalance - 1000) {
  throw new Error("Description-only edit changed the balance");
}
const renameSync = await request("/sync", { method: "POST", ...json({ cursor: beforeRename.serverSequence, operations: [] }, memberHeaders) });
if (!renameSync.events.some((event) => event.type === "transaction.note.updated"
  && event.transaction?.id === original.id && event.transaction.note === renameInput.note)) {
  throw new Error("Other devices cannot sync the corrected description");
}
const renameRetry = await request(`/transactions/${original.id}/correction`, { method: "POST", ...json(renameInput, headers) });
if (renameRetry.serverSequence !== renamed.serverSequence || renameRetry.transactions.length !== renamed.transactions.length) {
  throw new Error("Repeated description-only edit was not idempotent");
}
if (process.env.HOME_LEDGER_TEST_DB_PATH) {
  const { DatabaseSync } = await import("node:sqlite");
  const auditDb = new DatabaseSync(process.env.HOME_LEDGER_TEST_DB_PATH, { readOnly: true });
  const records = auditDb.prepare("SELECT actor_user_id,device_id,details_json,created_at FROM audit_events WHERE group_id=? AND action=? AND entity_id=?")
    .all(master.state.groupId, "transaction.note.updated", original.id);
  auditDb.close();
  const details = records[0] && JSON.parse(records[0].details_json);
  if (records.length !== 1 || records[0].actor_user_id !== master.user.id || !records[0].device_id
    || !Number.isFinite(Date.parse(records[0].created_at))
    || details?.previousNote !== original.note || details?.newNote !== renameInput.note || details?.operationId !== renameOperationId) {
    throw new Error("Description-only edit did not preserve one complete audit record");
  }
}
const correctionOperationId = operationId();
const correctionInput = { operationId: correctionOperationId, amountMinor: 1400, categoryId: groceries.id, note: "QA corrected" };
const forbidden = await response(`/transactions/${original.id}/correction`, {
  method: "POST", ...json({ ...correctionInput, operationId: operationId() }, memberHeaders),
});
if (forbidden.status !== 403) throw new Error(`Member correction should be forbidden, received ${forbidden.status}`);
const corrected = await request(`/transactions/${original.id}/correction`, {
  method: "POST", ...json(correctionInput, headers),
});
const preservedOriginal = corrected.transactions.find((transaction) => transaction.id === original.id);
const replacement = corrected.transactions.find((transaction) => transaction.note === "QA corrected");
if (preservedOriginal?.status !== "reversed" || replacement?.amountMinor !== 1400) {
  throw new Error("Correction did not preserve history and create replacement");
}
const correctedBalance = (await request("/dashboard", { headers })).sharedBalanceMinor;
if (correctedBalance !== startingBalance - 1400) throw new Error("Correction produced the wrong net balance");
const repeated = await request(`/transactions/${original.id}/correction`, {
  method: "POST", ...json(correctionInput, headers),
});
if (corrected.transactions.length !== repeated.transactions.length) throw new Error("Repeated correction changed history");

const cancellable = await createExpense(headers, master.user.id, shared.id, groceries.id, 600, "QA cancellation");
const cancellationOperationId = operationId();
const cancelled = await request(`/transactions/${cancellable.id}/cancellation`, {
  method: "POST", ...json({ operationId: cancellationOperationId }, headers),
});
if (cancelled.transactions.find((transaction) => transaction.id === cancellable.id)?.status !== "reversed") {
  throw new Error("Cancellation did not preserve and mark the original");
}
const cancelledBalance = (await request("/dashboard", { headers })).sharedBalanceMinor;
if (cancelledBalance !== correctedBalance) throw new Error("Cancellation did not remove the transaction's financial effect");
const repeatedCancellation = await request(`/transactions/${cancellable.id}/cancellation`, {
  method: "POST", ...json({ operationId: cancellationOperationId }, headers),
});
if (cancelled.transactions.length !== repeatedCancellation.transactions.length) throw new Error("Repeated cancellation changed history");

const memberOriginal = await createExpense(memberHeaders, member.user.id, shared.id, groceries.id, 700, "Member expense");
const outsiderCorrection = await response(`/transactions/${memberOriginal.id}/correction`, {
  method: "POST", ...json({ ...correctionInput, operationId: operationId() }, otherMemberHeaders),
});
if (outsiderCorrection.status !== 403) throw new Error(`Another member corrected a shared expense: ${outsiderCorrection.status}`);
const masterEdited = await request(`/transactions/${memberOriginal.id}/correction`, {
  method: "POST", ...json({ operationId: operationId(), amountMinor: 900, categoryId: groceries.id, note: "Master corrected member expense" }, headers),
});
const masterReplacement = masterEdited.transactions.find((transaction) => transaction.note === "Master corrected member expense");
if (!masterReplacement || masterReplacement.createdByUserId !== member.user.id) {
  throw new Error("Master correction reassigned the member's activity");
}
const memberEdited = await request(`/transactions/${masterReplacement.id}/correction`, {
  method: "POST", ...json({ operationId: operationId(), amountMinor: 1100, categoryId: groceries.id, note: "Member corrected own expense" }, memberHeaders),
});
if (memberEdited.transactions.find((transaction) => transaction.note === "Member corrected own expense")?.createdByUserId !== member.user.id) {
  throw new Error("Member could not correct their own shared activity");
}
const memberCancellable = await createExpense(memberHeaders, member.user.id, shared.id, groceries.id, 300, "Member cancellation");
const outsiderCancellation = await response(`/transactions/${memberCancellable.id}/cancellation`, {
  method: "POST", ...json({ operationId: operationId() }, otherMemberHeaders),
});
if (outsiderCancellation.status !== 403) throw new Error(`Another member cancelled a shared expense: ${outsiderCancellation.status}`);
const memberCancelled = await request(`/transactions/${memberCancellable.id}/cancellation`, {
  method: "POST", ...json({ operationId: operationId() }, memberHeaders),
});
if (memberCancelled.transactions.find((transaction) => transaction.id === memberCancellable.id)?.status !== "reversed") {
  throw new Error("Member could not cancel their own shared activity");
}
const activeExpenses = memberCancelled.transactions.filter((transaction) => transaction.kind === "expense"
  && transaction.accountId === shared.id && transaction.status === "posted");
const memberTotal = activeExpenses.filter((transaction) => transaction.createdByUserId === member.user.id)
  .reduce((sum, transaction) => sum + transaction.amountMinor, 0);
if (memberTotal !== 1100 || activeExpenses.reduce((sum, transaction) => sum + transaction.amountMinor, 0) !== 2500) {
  throw new Error("Monthly spending cannot be reconciled by activity creator");
}

const dateOriginal = await createExpense(headers, master.user.id, shared.id, groceries.id, 250, "QA date original");
const beforeDateCorrection = await request("/bootstrap", { headers });
const beforeDateBalance = (await request("/dashboard", { headers })).sharedBalanceMinor;
const nextUtcDay = new Date(Date.parse(dateOriginal.occurredAt) + 86_400_000).toISOString().slice(0, 10);
const newDate = `${nextUtcDay}T12:00:00.000Z`;
const dateCorrected = await request(`/transactions/${dateOriginal.id}/correction`, {
  method: "POST",
  ...json({ operationId: operationId(), amountMinor: 250, categoryId: groceries.id, note: "QA date moved", occurredAt: newDate }, headers),
});
const dateReplacement = dateCorrected.transactions.find((transaction) => transaction.note === "QA date moved");
if (dateCorrected.transactions.find((transaction) => transaction.id === dateOriginal.id)?.status !== "reversed"
  || !dateReplacement || dateReplacement.id === dateOriginal.id || dateReplacement.occurredAt !== newDate
  || dateCorrected.transactions.length !== beforeDateCorrection.transactions.length + 2
  || (await request("/dashboard", { headers })).sharedBalanceMinor !== beforeDateBalance) {
  throw new Error("Changing only the UTC calendar date did not create a balanced replacement");
}

console.log(JSON.stringify({
  permissions: "shared-creator-or-master; other-members-denied",
  description: "same-utc-day-noon-keeps-original-id-and-time; audit-and-sync-event",
  dateCorrection: "different-utc-day-reverses-and-replaces",
  attribution: "master-corrections-preserve-original-creator",
  correction: "history-preserved-and-net-balance-correct",
  cancellation: "history-preserved-and-net-zero",
  idempotency: "correction-and-cancellation-verified",
}));