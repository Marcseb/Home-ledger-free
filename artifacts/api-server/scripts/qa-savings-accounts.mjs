import { createHttpInvitationSession } from "./invitation-test-helpers.mjs";

const base = process.env.HOME_LEDGER_API;
if (!base) throw new Error("Set HOME_LEDGER_API to an isolated temporary API server started with NODE_ENV=development");
const response = async (path, options = {}) => {
  const result = await fetch(`${base}${path}`, options);
  const body = await result.json().catch(() => null);
  return { status: result.status, body };
};
const request = async (path, options = {}) => {
  const result = await response(path, options);
  if (result.status < 200 || result.status >= 300) throw new Error(`${path} ${result.status}: ${result.body?.error ?? "request failed"}`);
  return result.body;
};
const json = (body, headers = {}) => ({ headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const id = () => `qa-savings-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const master = await request("/household/setup", {
  method: "POST", ...json({ householdName: "Savings QA", displayName: "Alex", currency: "USD", deviceId: id(), deviceName: "savings QA" }),
});
const member = await createHttpInvitationSession(
  (path, body, token) => response(path, { method: "POST", ...json(body, token ? { "x-device-token": token } : {}) }),
  master, { displayName: "Sam" }, id(), "reversal QA",
);
const masterHeaders = { "x-device-token": master.deviceToken };
const memberHeaders = { "x-device-token": member.deviceToken };
const savings = await request("/accounts", { method: "POST", ...json({ name: "QA savings" }, masterHeaders) });
if (savings.name !== "QA savings" || savings.role !== "savings" || savings.currency !== master.state.baseCurrency || savings.balanceMinor !== 0
  || savings.allocatedMinor !== 0 || savings.unallocatedMinor !== 0 || !Array.isArray(savings.allocations)) throw new Error("Savings account create response is incomplete");
const renamed = await request(`/accounts/${savings.id}`, { method: "PATCH", ...json({ name: "QA renamed savings" }, masterHeaders) });
if (renamed.id !== savings.id || renamed.name !== "QA renamed savings") throw new Error("Savings account rename response is incomplete");
const memberSavings = await request("/accounts", { method: "POST", ...json({ name: "Member savings" }, memberHeaders) });
if (memberSavings.name !== "Member savings" || memberSavings.ownerUserId !== member.user.id) throw new Error("Member account create response is incomplete");
const memberArchived = await request(`/accounts/${memberSavings.id}`, { method: "PATCH", ...json({ archived: true }, memberHeaders) });
if (memberArchived.name !== "Member savings" || !memberArchived.archived) throw new Error("Member account archive response is incomplete");

const personalCategory = await request("/categories", { method: "POST", ...json({ name: "QA personal", scope: "personal", color: "#123456" }, memberHeaders) });
const category = personalCategory.categories.find((item) => item.name === "QA personal");
const memberAccount = member.state.accounts.find((account) => account.ownerUserId === member.user.id && account.role === "main");
if (!category || !memberAccount) throw new Error("Missing member fixtures");
const transaction = {
  id: id(), kind: "expense", accountId: memberAccount.id, destinationAccountId: null, amountMinor: 100,
  currency: master.state.baseCurrency, categoryId: category.id, note: "QA protected reversal",
  occurredAt: new Date().toISOString(), createdByUserId: member.user.id, status: "posted",
  reversesTransactionId: null, allocationShares: [],
};
const created = await request("/sync", { method: "POST", ...json({
  cursor: 0, operations: [{ operationId: id(), deviceId: "qa", clientCreatedAt: new Date().toISOString(), type: "transaction.create", payload: { transaction } }],
}, memberHeaders) });
if (created.acknowledgements[0]?.status !== "applied") throw new Error("Member transaction was not created");
const reversal = await request("/sync", { method: "POST", ...json({
  cursor: 0, operations: [{ operationId: id(), deviceId: "qa", clientCreatedAt: new Date().toISOString(), type: "transaction.reverse", payload: { transactionId: transaction.id, reversalId: id(), occurredAt: new Date().toISOString() } }],
}, masterHeaders) });
if (reversal.acknowledgements[0]?.status !== "rejected") throw new Error("Cross-user reversal was accepted");

const goal = await request("/savings-goals", {
  method: "POST",
  ...json({ name: "QA archived goal", targetMinor: 1000, initialSavedMinor: 0, isShared: false, accountId: savings.id, linkedAccountId: savings.id, dueDate: "2099-01-01", priority: "low", operationId: id() }, masterHeaders),
});
const goalId = goal.savingsGoals.find((item) => item.name === "QA archived goal")?.id;
if (!goalId) throw new Error("Archived-goal fixture was not created");
const archived = await request(`/accounts/${savings.id}`, { method: "PATCH", ...json({ archived: true }, masterHeaders) });
if (archived.name !== "QA renamed savings" || !archived.archived || !Array.isArray(archived.allocations)
  || typeof archived.allocatedMinor !== "number" || typeof archived.unallocatedMinor !== "number") throw new Error("Savings account archive response is incomplete");
const contribution = await response(`/savings-goals/${goalId}/contributions`, {
  method: "POST", ...json({ amountMinor: 100, operationId: id() }, masterHeaders),
});
if (contribution.status !== 400) throw new Error("Archived goal accepted a contribution");
const archivedTransfer = await response("/sync", { method: "POST", ...json({
  cursor: 0, operations: [{ operationId: id(), deviceId: "qa", clientCreatedAt: new Date().toISOString(), type: "transaction.create", payload: {
    transaction: { ...transaction, id: id(), kind: "transfer", accountId: savings.id, destinationAccountId: memberAccount.id, categoryId: "transfer", note: "QA archived transfer" },
  } }],
}, masterHeaders) });
if (archivedTransfer.body?.acknowledgements?.[0]?.status !== "rejected") throw new Error("Archived account accepted a transfer");

console.log(JSON.stringify({ reversalAuthorization: "verified", archivedGoal: "blocked", archivedTransfer: "blocked" }));