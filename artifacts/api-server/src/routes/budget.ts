import { Router, type IRouter } from "express";
import {
  acknowledgeBudgetAlert,
  authenticate,
  isActiveHouseholdMaster,
  cancelTransaction,
  createCategory,
  createSavingsAccount,
  createBudget,
  createRecurringRule,
  createSavingsGoal,
  correctTransaction,
  contributeToSavingsGoal,
  cancelSavingsGoalContribution,
  dashboard,
  deleteRecurringRule,
  deleteSavingsGoal,
  cancelSavingsGoal,
  settleSavingsGoal,
  deleteBudget,
  createHouseholdInvitation,
  listHouseholdInvitations,
  revokeHouseholdInvitation,
  redeemHouseholdInvitation,
  redeemReviewerDemoAccess,
  isReviewerDemoMode,
  getState,
  getBusinessClockStatus,
  advanceBusinessClock,
  processDueRecurringRules,
  businessMonth,
  inviteSavingsGoalParticipant,
  removeHouseholdMember,
  resetDemo,
  resetLedger,
  setupHousehold,
  reinitializeHousehold,
  revoke,
  sync,
  transferHouseholdMaster,
  updateCategory,
  updateSavingsAccount,
  updateBudget,
  updateCurrentDeviceName,
  updateHouseholdAllocations,
  updateRecurringRule,
  updateSavingsGoal,
  respondToSavingsGoalInvitation,
} from "../lib/budget-store";
import { isAcceleratedTestEnabled, isDemoResetEnabled } from "../lib/runtime-config";
import { createEncryptedExport, recoveryStatus, runEncryptedBackup } from "../lib/recovery";

const router: IRouter = Router();
const redemptionAttempts = new Map<string, { windowStartedAt: number; count: number }>();

function redemptionRateLimited(key: string) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const limit = 20;
  for (const [entry, value] of redemptionAttempts) {
    if (now - value.windowStartedAt >= windowMs) redemptionAttempts.delete(entry);
  }
  const current = redemptionAttempts.get(key);
  if (!current || now - current.windowStartedAt >= windowMs) {
    redemptionAttempts.set(key, { windowStartedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

router.get("/backups/status", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  if (current.user.role !== "master" || !isActiveHouseholdMaster(current.user.id, current.groupId)) {
    res.status(403).json({ error: "Only the master user can view recovery status" }); return;
  }
  res.setHeader("Cache-Control", "no-store");
  if (isReviewerDemoMode()) {
    res.json({
      reviewDemo: true, enrolled: false, destinationConfigured: false,
      destinationAvailable: false, lastSuccessfulAt: null, lastError: null,
    });
    return;
  }
  res.json(recoveryStatus());
});

router.post("/backups/save-to-server", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  if (isReviewerDemoMode()) {
    res.status(409).json({ error: "Local recovery files are unavailable on the hosted reviewer demo" }); return;
  }
  if (current.user.role !== "master" || !isActiveHouseholdMaster(current.user.id, current.groupId)) {
    res.status(403).json({ error: "Only the master user can save a recovery backup on the server" }); return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const savedPath = runEncryptedBackup();
    if (!savedPath) {
      const status = recoveryStatus();
      res.status(409).json({
        error: !status.enrolled ? "Recovery is not enrolled"
          : status.lastError ?? "Recovery mountpoint is unavailable",
      });
      return;
    }
    // Do not return the server's filesystem path or the archive itself to the phone.
    res.json({ savedAt: recoveryStatus().lastSuccessfulAt });
  } catch (error) {
    req.log.error({ err: error }, "Immediate encrypted backup failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Encrypted backup failed" });
  }
});

router.post("/backups/export", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  if (isReviewerDemoMode()) {
    res.status(409).json({ error: "Local recovery files are unavailable on the hosted reviewer demo" }); return;
  }
  if (current.user.role !== "master" || !isActiveHouseholdMaster(current.user.id, current.groupId)) {
    res.status(403).json({ error: "Only the master user can export a recovery backup" }); return;
  }
  try {
    const archive = createEncryptedExport();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="home-ledger-${date}.hlbackup"`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(archive);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Encrypted backup export failed";
    res.status(409).json({ error: message });
  }
});

function session(req: { header(name: string): string | undefined }) {
  const current = authenticate(req.header("x-device-token"));
  if (current) updateCurrentDeviceName(current.device_id, req.header("x-device-name"));
  return current;
}

router.post("/demo/reset", (_req, res): void => {
  if (!isDemoResetEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  resetDemo();
  res.json({ serverName: "Home Ledger PC" });
});

router.post("/ledger/reset", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid or revoked" });
    return;
  }
  if (current.user.role !== "master") {
    res.status(403).json({ error: "Only the master user can reset the ledger" });
    return;
  }
  res.json(resetLedger(current.groupId, current.user.id, current.device_id));
});

router.post("/household/reinitialize", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    res.status(200).json(reinitializeHousehold(current.groupId, current.user.id, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Household reinitialization failed";
    res.status(message === "Master role required" ? 403 : 400).json({ error: message });
  }
});

router.post("/pairing/redeem", (_req, res): void => {
  res.status(410).json({ error: "This pairing flow is no longer supported. Upgrade the Home Ledger client." });
});

router.post("/pairing/invitations/redeem", (req, res): void => {
  const address = req.ip || req.socket.remoteAddress || "unknown";
  if (redemptionRateLimited(address)) {
    res.setHeader("Retry-After", "600");
    res.status(429).json({ error: "Too many invitation attempts. Try again later." });
    return;
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(isReviewerDemoMode() ? redeemReviewerDemoAccess(req.body) : redeemHouseholdInvitation(req.body));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invitation redemption failed" });
  }
});

router.post("/household/invitations", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  if (current.user.role !== "master" || !isActiveHouseholdMaster(current.user.id, current.groupId)) {
    res.status(403).json({ error: "Master role required" }); return;
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(createHouseholdInvitation(current.groupId, current.user.id, current.device_id, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create invitation";
    res.status(message === "Master role required" || message.includes("Master device") ? 403 : 400).json({ error: message });
  }
});

router.get("/household/invitations", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  if (current.user.role !== "master" || !isActiveHouseholdMaster(current.user.id, current.groupId)) {
    res.status(403).json({ error: "Master role required" }); return;
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(listHouseholdInvitations(current.groupId, current.user.id));
  }
  catch (error) { res.status(403).json({ error: error instanceof Error ? error.message : "Could not list invitations" }); }
});

router.delete("/household/invitations/:invitationId", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  if (current.user.role !== "master" || !isActiveHouseholdMaster(current.user.id, current.groupId)) {
    res.status(403).json({ error: "Master role required" }); return;
  }
  try {
    const invitationId = Array.isArray(req.params.invitationId) ? req.params.invitationId[0] : req.params.invitationId;
    res.json(revokeHouseholdInvitation(current.groupId, current.user.id, current.device_id, invitationId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not revoke invitation";
    res.status(message === "Master role required" || message.includes("Master device") ? 403 : 400).json({ error: message });
  }
});

router.post("/household/setup", (req, res): void => {
  try {
    res.status(201).json(setupHousehold(req.body));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Household setup failed" });
  }
});

router.get("/bootstrap", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid or revoked" });
    return;
  }
  res.json(getState(current.groupId, current.user.id));
});

router.get("/test-clock", (req, res): void => {
  if (!isAcceleratedTestEnabled()) { res.sendStatus(404); return; }
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  if (current.user.role !== "master") { res.status(403).json({ error: "Master role required" }); return; }
  res.json(getBusinessClockStatus());
});

router.post("/test-clock/advance", (req, res): void => {
  if (!isAcceleratedTestEnabled()) { res.sendStatus(404); return; }
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  if (current.user.role !== "master") { res.status(403).json({ error: "Master role required" }); return; }
  const unit = req.body?.unit;
  if (unit !== "day" && unit !== "week" && unit !== "month") {
    res.status(400).json({ error: "Advance unit must be day, week, or month" });
    return;
  }
  try {
    const advanced = advanceBusinessClock(unit, () => processDueRecurringRules(current.groupId));
    const { createdRecurringTransactions, ...clock } = advanced;
    res.json({ clock, createdRecurringTransactions, state: getState(current.groupId, current.user.id) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not advance test clock" });
  }
});

router.post("/accounts", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try { res.status(201).json(createSavingsAccount(current.groupId, current.user.id, current.device_id, req.body)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not create savings account" }); }
});

router.patch("/accounts/:accountId", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const accountId = Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId;
    res.json(updateSavingsAccount(current.groupId, current.user.id, current.device_id, accountId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update savings account";
    res.status(message.includes("cannot manage") ? 403 : 400).json({ error: message });
  }
});

router.post("/sync", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid or revoked" });
    return;
  }
  const cursor = Number(req.body?.cursor ?? 0);
  const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
  if (!Number.isInteger(cursor) || cursor < 0 || operations.length > 100) {
    res.status(400).json({ error: "Invalid sync request" });
    return;
  }
  res.json(sync(current.groupId, current.user.id, current.device_id, cursor, operations));
});

router.get("/dashboard", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid or revoked" });
    return;
  }
  res.json(dashboard(current.groupId, current.user.id));
});

router.get("/budgets", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  const state = getState(current.groupId, current.user.id);
  const month = businessMonth();
  res.json({ current: state.budgets.filter((budget) => budget.month === month), history: state.budgets.filter((budget) => budget.month !== month) });
});

router.post("/budgets", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try { res.json(createBudget(current.groupId, current.user.id, current.device_id, req.body)); }
  catch (error) { const message = error instanceof Error ? error.message : "Could not save budget"; res.status(message.includes("Master role") || message.includes("cannot manage") ? 403 : 400).json({ error: message }); }
});

router.patch("/budgets/:categoryId", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const categoryId = Array.isArray(req.params.categoryId) ? req.params.categoryId[0] : req.params.categoryId;
    res.json(updateBudget(current.groupId, current.user.id, current.device_id, categoryId, req.body));
  } catch (error) { const message = error instanceof Error ? error.message : "Could not update budget"; res.status(message.includes("Master role") || message.includes("cannot manage") ? 403 : 400).json({ error: message }); }
});

router.delete("/budgets/:categoryId", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const categoryId = Array.isArray(req.params.categoryId) ? req.params.categoryId[0] : req.params.categoryId;
    deleteBudget(current.groupId, current.user.id, current.device_id, categoryId);
    res.sendStatus(204);
  } catch (error) { const message = error instanceof Error ? error.message : "Could not disable budget"; res.status(message.includes("Master role") || message.includes("cannot manage") ? 403 : 400).json({ error: message }); }
});

router.post("/budget-alerts/:alertId/acknowledgement", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const alertId = Array.isArray(req.params.alertId) ? req.params.alertId[0] : req.params.alertId;
    res.json(acknowledgeBudgetAlert(current.groupId, current.user.id, current.device_id, alertId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not dismiss budget alert";
    res.status(message.includes("cannot manage") ? 403 : 400).json({ error: message });
  }
});

router.post("/transactions/:transactionId/correction", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const transactionId = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    res.json(correctTransaction(current.groupId, current.user.id, current.device_id, transactionId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not correct activity";
    res.status(message.includes("Only the master") || message.includes("cannot manage") ? 403 : 400).json({ error: message });
  }
});

router.post("/transactions/:transactionId/cancellation", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const transactionId = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    res.json(cancelTransaction(current.groupId, current.user.id, current.device_id, transactionId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel activity";
    res.status(message.includes("Only the master") || message.includes("cannot manage") ? 403 : 400).json({ error: message });
  }
});

router.post("/categories", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid, expired, or revoked" });
    return;
  }
  try {
    res.status(201).json(createCategory(current.groupId, current.user.id, current.device_id, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create category";
    res.status(message === "Master role required" ? 403 : 400).json({ error: message });
  }
});

router.patch("/categories/:categoryId", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid, expired, or revoked" });
    return;
  }
  try {
    const categoryId = Array.isArray(req.params.categoryId) ? req.params.categoryId[0] : req.params.categoryId;
    res.json(updateCategory(current.groupId, current.user.id, current.device_id, categoryId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update category";
    res.status(message === "Master role required" || message === "You cannot manage this personal category" ? 403 : 400).json({ error: message });
  }
});

router.post("/recurring-rules", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid, expired, or revoked" });
    return;
  }
  try {
    res.status(201).json(createRecurringRule(current.groupId, current.user.id, current.device_id, req.body));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not create recurring rule" });
  }
});

router.patch("/recurring-rules/:ruleId", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid, expired, or revoked" });
    return;
  }
  try {
    const ruleId = Array.isArray(req.params.ruleId) ? req.params.ruleId[0] : req.params.ruleId;
    res.json(updateRecurringRule(current.groupId, current.user.id, current.device_id, ruleId, req.body));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not update recurring rule" });
  }
});

router.delete("/recurring-rules/:ruleId", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid, expired, or revoked" });
    return;
  }
  try {
    const ruleId = Array.isArray(req.params.ruleId) ? req.params.ruleId[0] : req.params.ruleId;
    deleteRecurringRule(current.groupId, current.user.id, current.device_id, ruleId);
    res.sendStatus(204);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not delete recurring rule" });
  }
});

router.post("/savings-goals", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid, expired, or revoked" }); return; }
  try {
    res.status(201).json(createSavingsGoal(current.groupId, current.user.id, current.device_id, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create savings goal";
    res.status(message === "Master role required" ? 403 : 400).json({ error: message });
  }
});

router.patch("/savings-goals/:goalId", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid, expired, or revoked" }); return; }
  try {
    const goalId = Array.isArray(req.params.goalId) ? req.params.goalId[0] : req.params.goalId;
    res.json(updateSavingsGoal(current.groupId, current.user.id, current.device_id, goalId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update savings goal";
    res.status(message.includes("Master role") || message.includes("cannot manage") ? 403 : 400).json({ error: message });
  }
});

router.delete("/savings-goals/:goalId", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid, expired, or revoked" }); return; }
  try {
    const goalId = Array.isArray(req.params.goalId) ? req.params.goalId[0] : req.params.goalId;
     res.status(410).json({ error: "Savings goals are cancelled rather than deleted; use the cancellation endpoint" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete savings goal";
    res.status(message.includes("Master role") || message.includes("cannot manage") ? 403 : 400).json({ error: message });
  }
});

router.post("/savings-goals/:goalId/cancellation", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const goalId = Array.isArray(req.params.goalId) ? req.params.goalId[0] : req.params.goalId;
    res.json(cancelSavingsGoal(current.groupId, current.user.id, current.device_id, goalId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel savings goal";
    res.status(message.includes("Master role") || message.includes("cannot manage") ? 403 : 400).json({ error: message });
  }
});

router.post("/savings-goals/:goalId/settlement", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const goalId = Array.isArray(req.params.goalId) ? req.params.goalId[0] : req.params.goalId;
    res.json(settleSavingsGoal(current.groupId, current.user.id, current.device_id, goalId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not settle savings goal funds";
    res.status(message.includes("User is not") ? 403 : 400).json({ error: message });
  }
});

router.post("/savings-goals/:goalId/contributions", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid, expired, or revoked" }); return; }
  try {
    const goalId = Array.isArray(req.params.goalId) ? req.params.goalId[0] : req.params.goalId;
    res.json(contributeToSavingsGoal(current.groupId, current.user.id, current.device_id, goalId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add contribution";
    res.status(message.includes("cannot manage") ? 403 : 400).json({ error: message });
  }
});

router.post("/savings-goals/:goalId/contributions/:contributionId/cancellation", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid, expired, or revoked" }); return; }
  try {
    const goalId = Array.isArray(req.params.goalId) ? req.params.goalId[0] : req.params.goalId;
    const contributionId = Array.isArray(req.params.contributionId) ? req.params.contributionId[0] : req.params.contributionId;
    res.json(cancelSavingsGoalContribution(current.groupId, current.user.id, current.device_id, goalId, contributionId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel contribution";
    res.status(message.includes("own contributions") || message.includes("User is not") ? 403 : 400).json({ error: message });
  }
});

router.post("/savings-goals/:goalId/participants", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const goalId = Array.isArray(req.params.goalId) ? req.params.goalId[0] : req.params.goalId;
    res.status(201).json(inviteSavingsGoalParticipant(current.groupId, current.user.id, current.device_id, goalId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not invite goal participant";
    res.status(message.includes("Master role") ? 403 : 400).json({ error: message });
  }
});

router.patch("/savings-goal-participants/:participantId", (req, res): void => {
  const current = session(req);
  if (!current) { res.status(401).json({ error: "Session is invalid or revoked" }); return; }
  try {
    const participantId = Array.isArray(req.params.participantId) ? req.params.participantId[0] : req.params.participantId;
    res.json(respondToSavingsGoalInvitation(current.groupId, current.user.id, current.device_id, participantId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not respond to invitation";
    res.status(message.includes("only respond") ? 403 : 400).json({ error: message });
  }
});

router.post("/devices/:deviceId/revoke", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid or revoked" });
    return;
  }
  try {
    const deviceId = Array.isArray(req.params.deviceId) ? req.params.deviceId[0] : req.params.deviceId;
    revoke(current.groupId, current.user.id, deviceId);
    res.sendStatus(204);
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
  }
});

router.patch("/household/allocations", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid, expired, or revoked" });
    return;
  }
  try {
    res.json(updateHouseholdAllocations(current.groupId, current.user.id, current.device_id, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update allocations";
    res.status(message === "Master role required" ? 403 : 400).json({ error: message });
  }
});

router.patch("/household/master", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid, expired, or revoked" });
    return;
  }
  try {
    res.json(transferHouseholdMaster(current.groupId, current.user.id, current.device_id, req.body?.targetUserId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not transfer the master role";
    res.status(message === "Master role required" ? 403 : 400).json({ error: message });
  }
});

router.post("/household/master/claim", (req, res): void => {
  res.status(410).json({ error: "Master assignment by claim is disabled. Use a targeted Master invitation or explicit transfer." });
});

router.delete("/household/members/:userId", (req, res): void => {
  const current = session(req);
  if (!current) {
    res.status(401).json({ error: "Session is invalid, expired, or revoked" });
    return;
  }
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    res.json(removeHouseholdMember(current.groupId, current.user.id, current.device_id, userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove household member";
    res.status(message === "Master role required" ? 403 : 400).json({ error: message });
  }
});

router.get("/pairing/current", (_req, res): void => {
  res.status(410).json({ error: "Pairing codes are no longer supported. Upgrade the Home Ledger client." });
});

export default router;