import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "home-ledger-expense-shares-"));
process.env.NODE_ENV = "test";
process.env.APP_VARIANT = "";
process.env.BUDGET_DB_PATH = join(directory, "ledger.sqlite");
process.env.BUDGET_BACKUP_DIR = join(directory, "backups");

try {
  const store = await import("../src/lib/budget-store.ts");
  const { inviteHouseholdMember } = await import("./invitation-test-helpers.mjs");
  const setup = store.setupHousehold({
    householdName: "Test household", displayName: "Master", currency: "EUR",
    deviceId: "master-device", deviceName: "Test phone",
  });
  const member = inviteHouseholdMember(store, setup, "master-device", "Member", "member-device", "Second phone");
  const groupId = setup.state.groupId;
  store.updateHouseholdAllocations(groupId, setup.user.id, "master-device", {
    allocations: [
      { userId: setup.user.id, basisPoints: 6000 },
      { userId: member.user.id, basisPoints: 4000 },
    ],
  });
  const categoryState = store.createCategory(groupId, setup.user.id, "master-device", {
    name: "Housing", scope: "shared", color: "#558877",
  });
  const categoryId = categoryState.categories.find((item) => item.name === "Housing").id;
  store.resetLedger(groupId, setup.user.id, "master-device");
  const afterReset = store.getState(groupId, setup.user.id);
  assert.equal(afterReset.transactions.length, 0);
  assert.equal(afterReset.users.length, 2);
  assert.equal(afterReset.categories.some((item) => item.id === categoryId), true);
  assert.equal(afterReset.users.find((item) => item.id === member.user.id).defaultShareBps, 4000);

  const oldClientShares = [
    { userId: setup.user.id, basisPoints: 10000, amountMinor: 101 },
    { userId: member.user.id, basisPoints: 0, amountMinor: 0 },
  ];
  const transaction = {
    id: "stale-device-expense", kind: "expense", accountId: "shared-main",
    destinationAccountId: null, amountMinor: 101, currency: "EUR",
    categoryId, note: "Shared expense",
    occurredAt: new Date().toISOString(), createdByUserId: setup.user.id,
    status: "posted", reversesTransactionId: null, allocationShares: oldClientShares,
  };
  const result = store.sync(groupId, setup.user.id, "master-device", 0, [{
    operationId: "stale-device-operation", deviceId: "master-device",
    clientCreatedAt: transaction.occurredAt, type: "transaction.create",
    payload: { transaction },
  }]);
  assert.equal(result.acknowledgements[0].status, "applied", JSON.stringify(result.acknowledgements));
  const saved = store.getState(groupId, setup.user.id).transactions.find((item) => item.id === transaction.id);
  assert.deepEqual(
    saved.allocationShares.map(({ userId, basisPoints, amountMinor }) => ({ userId, basisPoints, amountMinor }))
      .sort((a, b) => a.userId.localeCompare(b.userId)),
    [
      { userId: setup.user.id, basisPoints: 6000, amountMinor: 61 },
      { userId: member.user.id, basisPoints: 4000, amountMinor: 40 },
    ].sort((a, b) => a.userId.localeCompare(b.userId)),
  );
  assert.equal(store.dashboard(groupId, setup.user.id).monthExpenseMinor, 101);
  store.updateHouseholdAllocations(groupId, setup.user.id, "master-device", {
    allocations: [
      { userId: setup.user.id, basisPoints: 5000 },
      { userId: member.user.id, basisPoints: 5000 },
    ],
  });
  assert.deepEqual(
    store.getState(groupId, member.user.id).transactions.find((item) => item.id === transaction.id)?.allocationShares,
    saved.allocationShares,
    "later quote changes must not rewrite saved expense shares",
  );
  console.log("Shared expense shares: server quotes override stale client values; saved history remains stable.");
} finally {
  await rm(directory, { recursive: true, force: true });
}