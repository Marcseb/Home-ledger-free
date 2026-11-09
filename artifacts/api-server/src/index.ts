export {};

if (process.argv.slice(2).includes("--invite-master")) {
  try {
    const { createLocalMasterInvitation } = await import("./lib/budget-store");
    const result = createLocalMasterInvitation();
    console.log("A one-use, 10-minute invitation was created for the current Master.");
    console.log(`Master recovery code: ${result.invitationCode}`);
    console.log(`Expires: ${result.invitation.expiresAt}`);
    console.log("Existing devices were not revoked.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not create Master invitation");
    process.exitCode = 1;
  }
} else {
  const [{ default: app }, store, { logger }] = await Promise.all([
    import("./app"),
    import("./lib/budget-store"),
    import("./lib/logger"),
  ]);
  const {
    backupDatabase, createLocalMasterInvitation, ensureDemo, getDatabaseStatus,
    hasUnrevokedMasterDevice, processDueRecurringRules,
  } = store;
  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);
  const host = process.env["HOST"] ?? "0.0.0.0";

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }
  if (process.env["NODE_ENV"] === "production" && process.env["APP_VARIANT"] === "accelerated-test" && port === 5000) {
    throw new Error("Accelerated-test production mode cannot use the production port 5000");
  }

  const backupIntervalHours = Number(process.env["BACKUP_INTERVAL_HOURS"] ?? "24");
  if (!Number.isFinite(backupIntervalHours) || backupIntervalHours <= 0) {
    throw new Error(`Invalid BACKUP_INTERVAL_HOURS value: "${process.env["BACKUP_INTERVAL_HOURS"]}"`);
  }

  const runBackup = () => {
    try {
      const backupPath = backupDatabase();
      if (backupPath) logger.info({ backupPath }, "Encrypted household backup completed");
    } catch (err) {
      logger.error({ err }, "Encrypted household backup failed");
    }
  };

  ensureDemo();
  if (store.isReviewerDemoMode()) {
    const { setHostedServerIdentity } = await import("./lib/server-discovery");
    setHostedServerIdentity(store.getReviewerDemoServerIdentity());
  }
  logger.info(getDatabaseStatus(), "Persistent database opened");
  if (!store.isReviewerDemoMode() && getDatabaseStatus().households > 0 && !hasUnrevokedMasterDevice()) {
    try {
      const recoveryInvitation = createLocalMasterInvitation();
      console.log(`[Home Ledger] Local Master recovery invitation: ${recoveryInvitation.invitationCode} (expires ${recoveryInvitation.invitation.expiresAt})`);
    } catch (error) {
      logger.error({ err: error }, "Could not issue local Master recovery invitation");
    }
  }
  runBackup();
  setInterval(runBackup, backupIntervalHours * 60 * 60 * 1000).unref();
  const runRecurringRules = () => {
    try {
      const created = processDueRecurringRules();
      if (created > 0) logger.info({ created }, "Recurring transactions created");
    } catch (err) {
      logger.error({ err }, "Recurring transaction processing failed");
    }
  };
  runRecurringRules();
  setInterval(runRecurringRules, 60 * 1000).unref();

  app.listen(port, host, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ host, port }, "Server listening");
  });
}
