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
const id = () => `qa-goal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const goal = (state, name) => state.savingsGoals.find((item) => item.name === name);
const stateWith = async (token) => request("/bootstrap", { headers: { "x-device-token": token } });

const master = await request("/household/setup", {
  method: "POST", ...json({ householdName: "Goal QA", displayName: "Alex", currency: "USD", deviceId: id(), deviceName: "goal QA" }),
});
const member = await createHttpInvitationSession(
  (path, body, token) => response(path, { method: "POST", ...json(body, token ? { "x-device-token": token } : {}) }),
  master, { displayName: "Sam" }, id(), "goal QA member",
);
const mh = { "x-device-token": master.deviceToken };
const memberAccount = member.state.accounts.find((account) => account.ownerUserId === member.user.id && account.role === "main");
const masterAccount = master.state.accounts.find((item) => item.ownerUserId === master.user.id && item.role === "main");
if (!memberAccount || !masterAccount) throw new Error("Missing household Main accounts");
const savings = await request("/accounts", { method: "POST", ...json({ name: "QA linked savings" }, mh) });
const account = savings;
const dueDate = "2099-01-01";
const create = (name, linkedAccountId, initialSavedMinor = 0, operationId = id()) => request("/savings-goals", {
  method: "POST",
  ...json({ name, targetMinor: 10000, initialSavedMinor, isShared: false, accountId: account.id, linkedAccountId, dueDate, priority: "medium", operationId }, mh),
});

const linkedOperation = id();
const linked = await create("QA linked", account.id, 100, linkedOperation);
let linkedGoal = goal(linked, "QA linked");
if (!linkedGoal?.linkedAccountId || linkedGoal.contributions[0]?.transactionId === null) throw new Error("Linked initial contribution was not associated with a transfer");
const initialTx = linkedGoal.contributions[0].transactionId;
const initialBalance = linked.accounts.find((item) => item.id === account.id)?.balanceMinor;
const initialTransaction = linked.transactions.find((item) => item.id === initialTx);
if (initialBalance !== 100 || initialTransaction?.kind !== "transfer" || initialTransaction.destinationAccountId !== account.id) throw new Error("Linked initial transfer or balance is incorrect");
const linkedRetry = await create("QA linked duplicate", account.id, 100, linkedOperation);
if (goal(linkedRetry, "QA linked")?.currentMinor !== 100 || linkedRetry.transactions.filter((item) => item.destinationAccountId === account.id).length !== 1) throw new Error("Linked goal create retry was not idempotent");
const renamedLinked = await request(`/transactions/${initialTx}/correction`, {
  method: "POST", ...json({
    operationId: id(), amountMinor: 100, categoryId: "transfer", note: "QA linked label corrected",
    occurredAt: `${initialTransaction.occurredAt.slice(0, 10)}T12:00:00.000Z`,
  }, mh),
});
const renamedContribution = goal(renamedLinked, "QA linked")?.contributions.find((item) => item.transactionId === initialTx);
if (renamedContribution?.note !== "QA linked label corrected"
  || goal(renamedLinked, "QA linked")?.currentMinor !== 100
  || renamedLinked.transactions.find((item) => item.id === initialTx)?.note !== "QA linked label corrected"
  || renamedLinked.transactions.find((item) => item.id === initialTx)?.occurredAt !== initialTransaction.occurredAt
  || renamedLinked.transactions.length !== linkedRetry.transactions.length) {
  throw new Error("Description-only edit changed a linked goal's transfer or failed to update its label");
}

const reused = await request("/savings-goals", { method: "POST", ...json({ name: "QA reused account", targetMinor: 1000, initialSavedMinor: 40, isShared: false, accountId: account.id, linkedAccountId: account.id, dueDate, priority: "low", operationId: id() }, mh) });
const reusedGoal = goal(reused, "QA reused account");
const reusedTx = reusedGoal?.contributions[0]?.transactionId;
if (reusedGoal?.linkedAccountId !== account.id || !reusedTx) throw new Error("Savings account could not be reused by another goal");
const reusedAllocation = reused.accounts.find((item) => item.id === account.id);
if (!reusedAllocation?.allocations?.some((item) => item.goalId === linkedGoal.id && item.amountMinor === 100)
  || !reusedAllocation.allocations.some((item) => item.goalId === reusedGoal.id && item.amountMinor === 40)) throw new Error("Savings account allocations did not list both goal totals");
await request(`/transactions/${reusedTx}/cancellation`, { method: "POST", ...json({ operationId: id() }, mh) });
const unchanged = await request(`/savings-goals/${linkedGoal.id}`, { method: "PATCH", ...json({ linkedAccountId: account.id }, mh) });
linkedGoal = goal(unchanged, "QA linked");
if (linkedGoal.linkedAccountId !== account.id) throw new Error("Editing an unchanged link failed");

const followUpOperation = id();
const afterContribution = await request(`/savings-goals/${linkedGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 50, note: "follow-up", operationId: followUpOperation }, mh) });
linkedGoal = goal(afterContribution, "QA linked");
if (linkedGoal.currentMinor !== 150 || linkedGoal.contributions.filter((item) => item.transactionId).length !== 2) throw new Error("Linked contribution did not update exactly once");
const retryFollowUp = await request(`/savings-goals/${linkedGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 50, note: "follow-up", operationId: followUpOperation }, mh) });
if (goal(retryFollowUp, "QA linked").currentMinor !== 150 || goal(retryFollowUp, "QA linked").contributions.length !== 2) throw new Error("Linked contribution retry was not idempotent");

const unlinkedOperation = id();
const unlinked = await request("/savings-goals", { method: "POST", ...json({ name: "QA unlinked", targetMinor: 1000, initialSavedMinor: 0, isShared: false, accountId: masterAccount.id, dueDate, priority: "low", operationId: unlinkedOperation }, mh) });
const unlinkedGoal = goal(unlinked, "QA unlinked");
const unlinkedContributionOperation = id();
const unlinkedContribution = await request(`/savings-goals/${unlinkedGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 25, operationId: unlinkedContributionOperation }, mh) });
const unlinkedResult = goal(unlinkedContribution, "QA unlinked");
if (unlinkedResult.contributions[0].transactionId !== null || unlinkedContribution.transactions.some((item) => item.destinationAccountId === masterAccount.id && item.amountMinor === 25)) throw new Error("Unlinked contribution created a transaction");
const retryUnlinked = await request(`/savings-goals/${unlinkedGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 25, operationId: unlinkedContributionOperation }, mh) });
if (goal(retryUnlinked, "QA unlinked").currentMinor !== 25 || goal(retryUnlinked, "QA unlinked").contributions.length !== 1) throw new Error("Unlinked contribution retry was not idempotent");

const sharedLink = await response("/savings-goals", { method: "POST", ...json({ name: "QA shared link reject", targetMinor: 1000, initialSavedMinor: 0, isShared: true, accountId: "shared-main", linkedAccountId: account.id, dueDate, priority: "low", operationId: id() }, mh) });
if (sharedLink.status !== 400) throw new Error("Shared goal accepted a personal linked account");
const crossUserLink = await response("/savings-goals", { method: "POST", ...json({ name: "QA cross user link reject", targetMinor: 1000, initialSavedMinor: 0, isShared: false, accountId: memberAccount.id, linkedAccountId: account.id, dueDate, priority: "low", operationId: id() }, { "x-device-token": member.deviceToken }) });
if (crossUserLink.status !== 400) throw new Error("Cross-user linked account was accepted");

await request(`/accounts/${account.id}`, { method: "PATCH", ...json({ archived: true }, mh) });
const archived = await response(`/savings-goals/${linkedGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 10, operationId: id() }, mh) });
if (archived.status !== 400) throw new Error("Archived linked account accepted a contribution");
await request(`/accounts/${account.id}`, { method: "PATCH", ...json({ archived: false }, mh) });

const corrected = await request(`/transactions/${initialTx}/correction`, {
  method: "POST", ...json({ operationId: id(), amountMinor: 120, categoryId: "transfer", note: "corrected", occurredAt: "2098-05-06T12:00:00.000Z" }, mh),
});
linkedGoal = goal(corrected, "QA linked");
const correctedContribution = linkedGoal.contributions.find((item) => item.id === linkedGoal.contributions[0].id);
if (linkedGoal.currentMinor !== 170 || correctedContribution.amountMinor !== 120 || !correctedContribution.transactionId
  || corrected.transactions.find((item) => item.id === correctedContribution.transactionId)?.occurredAt !== "2098-05-06T12:00:00.000Z") throw new Error("Linked correction changed progress or date incorrectly");
const replacement = correctedContribution.transactionId;
const cancelled = await request(`/transactions/${replacement}/cancellation`, { method: "POST", ...json({ operationId: id() }, mh) });
linkedGoal = goal(cancelled, "QA linked");
const reversed = linkedGoal.contributions.find((item) => item.id === correctedContribution.id);
if (linkedGoal.currentMinor !== 50 || !reversed.reversedAt) throw new Error("Linked cancellation did not remove contribution effect exactly once");
const remainingTransfer = linkedGoal.contributions.find((item) => item.amountMinor === 50)?.transactionId;
const reversalSync = await request("/sync", { method: "POST", ...json({ cursor: 0, operations: [{ operationId: id(), deviceId: "qa", clientCreatedAt: new Date().toISOString(), type: "transaction.reverse", payload: { transactionId: remainingTransfer, reversalId: id(), occurredAt: new Date().toISOString() } }] }, mh) });
if (reversalSync.acknowledgements[0]?.status !== "applied") throw new Error("Sync reversal was not applied");
const reversedState = await stateWith(master.deviceToken);
if (goal(reversedState, "QA linked").currentMinor !== 0) throw new Error("Sync reversal did not remove goal effect");
const txCount = reversedState.transactions.length;
const unlinkedGoalId = unlinkedGoal.id;
const unlinkedBeforeDelete = await request(`/savings-goals/${unlinkedGoalId}`, { method: "PATCH", ...json({ name: "QA unlinked retained" }, mh) });
await request(`/savings-goals/${unlinkedGoalId}/cancellation`, { method: "POST", ...json({ operationId: id() }, mh) });
const afterDelete = await stateWith(master.deviceToken);
if (afterDelete.transactions.length !== txCount || !afterDelete.accounts.some((item) => item.id === account.id && item.balanceMinor === 0)) throw new Error("Goal deletion changed transaction history or balances");

const shared = await request("/savings-goals", { method: "POST", ...json({ name: "QA shared trip", targetMinor: 1000, initialSavedMinor: 0, isShared: true, accountId: "shared-main", dueDate, priority: "medium", operationId: id() }, mh) });
const sharedGoal = goal(shared, "QA shared trip");
const autoSharedState = await request("/savings-goals", { method: "POST", ...json({ name: "QA auto personal", targetMinor: 900, initialSavedMinor: 0, isShared: true, accountId: "shared-main", dueDate, priority: "low", operationId: id() }, mh) });
const autoSharedGoal = autoSharedState.savingsGoals.find((item) => item.isShared && item.name === "QA auto personal");
const autoInviteState = await request(`/savings-goals/${autoSharedGoal.id}/participants`, { method: "POST", ...json({ userId: master.user.id, committedMinor: 325, operationId: id() }, mh) });
const autoParticipant = autoInviteState.savingsGoals.find((item) => item.id === autoSharedGoal.id).participants.find((item) => item.userId === master.user.id);
const autoAcceptOperation = id();
const autoAccepted = await request(`/savings-goal-participants/${autoParticipant.id}`, { method: "PATCH", ...json({ status: "accepted", createPersonalGoal: true, operationId: autoAcceptOperation }, mh) });
const autoPersonalGoal = autoAccepted.savingsGoals.find((item) => !item.isShared && item.sharedParticipation?.id === autoParticipant.id);
if (!autoPersonalGoal
  || autoPersonalGoal.name !== autoSharedGoal.name
  || autoPersonalGoal.targetMinor !== 325
  || autoPersonalGoal.dueDate !== autoSharedGoal.dueDate
  || autoPersonalGoal.priority !== autoSharedGoal.priority
  || autoPersonalGoal.accountId !== masterAccount.id
  || autoPersonalGoal.linkedAccountId !== null) throw new Error("Accepted invitation did not create the expected mapped personal goal");
const autoAcceptedRetry = await request(`/savings-goal-participants/${autoParticipant.id}`, { method: "PATCH", ...json({ status: "accepted", createPersonalGoal: true, operationId: autoAcceptOperation }, mh) });
if (autoAcceptedRetry.savingsGoals.filter((item) => !item.isShared && item.sharedParticipation?.id === autoParticipant.id).length !== 1) throw new Error("Automatic personal goal acceptance retry created a duplicate");
const memberSavings = await request("/accounts", { method: "POST", ...json({ name: "QA member savings" }, { "x-device-token": member.deviceToken }) });
const personal = await request("/savings-goals", { method: "POST", ...json({ name: "QA member share", targetMinor: 500, initialSavedMinor: 0, isShared: false, accountId: memberAccount.id, linkedAccountId: memberSavings.id, dueDate, priority: "medium", operationId: id() }, { "x-device-token": member.deviceToken }) });
const personalGoal = goal(personal, "QA member share");
const secondPersonal = await request("/savings-goals", { method: "POST", ...json({ name: "QA member other goal", targetMinor: 400, initialSavedMinor: 0, isShared: false, accountId: memberAccount.id, linkedAccountId: memberSavings.id, dueDate, priority: "low", operationId: id() }, { "x-device-token": member.deviceToken }) });
const secondPersonalGoal = goal(secondPersonal, "QA member other goal");
const invitationOperation = id();
const invited = await request(`/savings-goals/${sharedGoal.id}/participants`, { method: "POST", ...json({ userId: member.user.id, committedMinor: 500, operationId: invitationOperation }, mh) });
const participant = goal(invited, "QA shared trip").participants.find((item) => item.userId === member.user.id);
if (!participant || participant.status !== "pending") throw new Error("Shared goal participant invitation was not created");
const invitationRetry = await request(`/savings-goals/${sharedGoal.id}/participants`, { method: "POST", ...json({ userId: member.user.id, committedMinor: 500, operationId: invitationOperation }, mh) });
if (goal(invitationRetry, "QA shared trip").participants.find((item) => item.id === participant.id)?.status !== "pending") throw new Error("Invitation retry was not a no-op");
const crossUserMapping = await response(`/savings-goal-participants/${participant.id}`, { method: "PATCH", ...json({ status: "accepted", personalGoalId: personalGoal.id, operationId: id() }, mh) });
if (crossUserMapping.status !== 403) throw new Error("Master could select a private member goal");
const acceptOperation = id();
const accepted = await request(`/savings-goal-participants/${participant.id}`, { method: "PATCH", ...json({ status: "accepted", personalGoalId: personalGoal.id, operationId: acceptOperation }, { "x-device-token": member.deviceToken }) });
const acceptedParticipant = goal(accepted, "QA shared trip").participants.find((item) => item.id === participant.id);
if (acceptedParticipant?.status !== "accepted" || acceptedParticipant.personalGoalId !== personalGoal.id) throw new Error("Member-selected personal goal was not accepted");
if (!acceptedParticipant.acceptedAt || Number.isNaN(new Date(acceptedParticipant.acceptedAt).getTime())) throw new Error("Accepted shared-goal participant is missing a valid acceptance timestamp");
const masterAfterAcceptance = await stateWith(master.deviceToken);
const masterParticipant = goal(masterAfterAcceptance, "QA shared trip").participants.find((item) => item.id === participant.id);
if (masterParticipant?.personalGoalId !== null) throw new Error("Master can see another member's private personal goal mapping");
const acceptRetry = await request(`/savings-goal-participants/${participant.id}`, { method: "PATCH", ...json({ status: "accepted", personalGoalId: personalGoal.id, operationId: acceptOperation }, { "x-device-token": member.deviceToken }) });
if (goal(acceptRetry, "QA shared trip").participants.find((item) => item.id === participant.id)?.status !== "accepted") throw new Error("Invitation acceptance retry was not idempotent");
const mirrored = await request(`/savings-goals/${personalGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 75, operationId: id() }, { "x-device-token": member.deviceToken }) });
if (goal(mirrored, "QA shared trip").currentMinor !== 75 || goal(mirrored, "QA member share").currentMinor !== 75) throw new Error("Personal contribution did not mirror shared progress exactly once");
const mirroredTx = goal(mirrored, "QA member share").contributions[0].transactionId;
const correctedMirror = await request(`/transactions/${mirroredTx}/correction`, { method: "POST", ...json({ operationId: id(), amountMinor: 100, categoryId: "transfer", note: "correct mirrored" }, { "x-device-token": member.deviceToken }) });
if (goal(correctedMirror, "QA shared trip").currentMinor !== 100 || goal(correctedMirror, "QA member share").currentMinor !== 100) throw new Error("Mirrored correction did not update both totals once");
const correctedTx = goal(correctedMirror, "QA member share").contributions[0].transactionId;
const cancelledMirror = await request(`/transactions/${correctedTx}/cancellation`, { method: "POST", ...json({ operationId: id() }, { "x-device-token": member.deviceToken }) });
if (goal(cancelledMirror, "QA shared trip").currentMinor !== 0 || goal(cancelledMirror, "QA member share").currentMinor !== 0) throw new Error("Mirrored cancellation did not update both totals once");
const reversalContribution = await request(`/savings-goals/${personalGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 20, operationId: id() }, { "x-device-token": member.deviceToken }) });
const reversalTx = goal(reversalContribution, "QA member share").contributions.find((item) => item.amountMinor === 20)?.transactionId;
const mirroredReversalSync = await request("/sync", { method: "POST", ...json({ cursor: 0, operations: [{ operationId: id(), deviceId: "qa", clientCreatedAt: new Date().toISOString(), type: "transaction.reverse", payload: { transactionId: reversalTx, reversalId: id(), occurredAt: new Date().toISOString() } }] }, { "x-device-token": member.deviceToken }) });
if (mirroredReversalSync.acknowledgements[0]?.status !== "applied") throw new Error("Mirrored sync reversal was not applied");
const afterReversal = await stateWith(member.deviceToken);
if (goal(afterReversal, "QA shared trip").currentMinor !== 0 || goal(afterReversal, "QA member share").currentMinor !== 0) throw new Error("Mirrored reversal did not update both totals once");
const preservedMirror = await request(`/savings-goals/${personalGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 25, operationId: id() }, { "x-device-token": member.deviceToken }) });
if (goal(preservedMirror, "QA shared trip").currentMinor !== 25 || goal(preservedMirror, "QA member share").currentMinor !== 25) throw new Error("Active mirrored history was not established before removal");
const removedOperation = id();
const removed = await request(`/savings-goal-participants/${participant.id}`, { method: "PATCH", ...json({ status: "removed", operationId: removedOperation }, { "x-device-token": member.deviceToken }) });
const removedRetry = await request(`/savings-goal-participants/${participant.id}`, { method: "PATCH", ...json({ status: "removed", operationId: removedOperation }, { "x-device-token": member.deviceToken }) });
if (goal(removedRetry, "QA shared trip").participants.find((item) => item.id === participant.id)?.status !== "removed") throw new Error("Participation removal retry was not idempotent");
const stopped = await request(`/savings-goals/${personalGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 15, operationId: id() }, { "x-device-token": member.deviceToken }) });
if (goal(stopped, "QA member share").currentMinor !== 40 || goal(stopped, "QA shared trip").currentMinor !== 25) throw new Error("Removed participation changed historical mirroring or mirrored a new contribution");
const declinedSharedState = await request("/savings-goals", { method: "POST", ...json({ name: "QA declined trip", targetMinor: 500, initialSavedMinor: 0, isShared: true, accountId: "shared-main", dueDate, priority: "low", operationId: id() }, mh) });
const declinedShared = goal(declinedSharedState, "QA declined trip");
const declinedInvite = await request(`/savings-goals/${declinedShared.id}/participants`, { method: "POST", ...json({ userId: member.user.id, committedMinor: 200, operationId: id() }, mh) });
const declinedParticipant = goal(declinedInvite, "QA declined trip").participants.find((item) => item.userId === member.user.id);
await request(`/savings-goal-participants/${declinedParticipant.id}`, { method: "PATCH", ...json({ status: "declined", operationId: id() }, { "x-device-token": member.deviceToken }) });
const declinedContribution = await request(`/savings-goals/${secondPersonalGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 10, operationId: id() }, { "x-device-token": member.deviceToken }) });
if (goal(declinedContribution, "QA declined trip").currentMinor !== 0) throw new Error("Declined participation mirrored a contribution");
const directShared = await request(`/savings-goals/${sharedGoal.id}/contributions`, { method: "POST", ...json({ amountMinor: 30, operationId: id() }, mh) });
if (goal(directShared, "QA shared trip").currentMinor !== 55) throw new Error("Direct shared contribution failed");
const txCountBeforePersonalDelete = directShared.transactions.length;
await request(`/savings-goals/${personalGoal.id}/cancellation`, { method: "POST", ...json({ operationId: id() }, { "x-device-token": member.deviceToken }) });
const afterPersonalDelete = await stateWith(master.deviceToken);
if (afterPersonalDelete.transactions.length !== txCountBeforePersonalDelete || goal(afterPersonalDelete, "QA shared trip").currentMinor !== 55) throw new Error("Deleting mapped personal goal lost shared history");
const memberAfterPersonalDelete = await stateWith(member.deviceToken);
const unmappedAfterDelete = goal(memberAfterPersonalDelete, "QA shared trip").participants.find((item) => item.id === participant.id);
if (goal(memberAfterPersonalDelete, "QA member share").status !== "cancelled") throw new Error("Cancelling a mapped personal goal did not preserve lifecycle history");
console.log(JSON.stringify({ reusableSavingsAccount: "verified", allocationBreakdown: "verified", initialTransfer: "verified", unlinkedContribution: "verified", archiveRejection: "verified", correctionCancellationReversal: "verified", automaticPersonalGoal: "verified", sharedParticipantMirror: "verified", participantIdempotency: "verified", directSharedContribution: "verified", cancellationPreservesHistory: "verified" }));