import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = await mkdtemp(join(tmpdir(), "home-ledger-invitations-"));
const dataPath = join(directory, "ledger.sqlite");
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const child = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: "production",
    APP_VARIANT: "",
    HOME: directory,
    XDG_DATA_HOME: directory,
    BUDGET_DB_PATH: dataPath,
    HOST: "127.0.0.1",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });
let db;
const base = `http://127.0.0.1:${port}/api`;

async function request(path, method = "GET", body, token) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { "x-device-token": token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const deadline = Date.now() + 10_000;
  while (true) {
    if (child.exitCode !== null) throw new Error(`Server exited:\n${logs}`);
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start:\n${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const setup = await request("/household/setup", "POST", {
    householdName: "Invitation home", displayName: "Owner", currency: "USD",
    deviceId: "master-device", deviceName: "Master phone",
  });
  assert.equal(setup.status, 201);
  assert.equal("pairingCode" in setup.body, false);
  assert.equal("pairingCodeExpiresAt" in setup.body, false);
  const masterToken = setup.body.deviceToken;

  const duplicateName = await request("/household/invitations", "POST", { displayName: "oWnEr" }, masterToken);
  assert.equal(duplicateName.status, 400);
  assert.equal((await request("/household/invitations", "POST", {
    displayName: "Two fields", userId: setup.body.user.id,
  }, masterToken)).status, 400);
  assert.equal((await request("/household/invitations", "POST", {
    displayName: "Malformed fields", userId: null,
  }, masterToken)).status, 400);
  const memberInviteResponse = await request("/household/invitations", "POST", { displayName: "New member" }, masterToken);
  assert.equal(memberInviteResponse.status, 201);
  const memberInvite = memberInviteResponse.body;
  assert.deepEqual(Object.keys(memberInvite.invitation).sort(),
    ["id", "displayName", "userId", "role", "createdAt", "expiresAt", "status"].sort());
  assert.equal(memberInvite.invitation.displayName, "New member");
  assert.equal(memberInvite.invitation.userId, null);
  assert.equal(memberInvite.invitation.role, "member");
  assert.equal(memberInvite.invitation.status, "pending");
  assert.match(memberInvite.invitationCode, /^[A-F0-9]{20}$/);
  const inviteLifetime = Date.parse(memberInvite.invitation.expiresAt) - Date.parse(memberInvite.invitation.createdAt);
  assert.ok(inviteLifetime >= 600_000 && inviteLifetime <= 600_005);

  const memberAttempt = await request("/household/invitations", "POST", { displayName: "Nope" }, "not-a-session");
  assert.equal(memberAttempt.status, 401);
  const list = await request("/household/invitations", "GET", undefined, masterToken);
  assert.equal(list.status, 200);
  assert.equal(list.body.invitations.some((item) => item.id === memberInvite.invitation.id), true);
  const wrongIdentity = await request("/pairing/invitations/redeem", "POST", {
    invitationCode: memberInvite.invitationCode, deviceId: "new-member-device",
    deviceName: "Phone", displayName: "Owner", role: "master",
  });
  assert.equal(wrongIdentity.status, 400);
  const memberRedemption = await request("/pairing/invitations/redeem", "POST", {
    invitationCode: memberInvite.invitationCode, deviceId: "new-member-device", deviceName: "Phone",
  });
  assert.equal(memberRedemption.status, 200);
  assert.equal(memberRedemption.body.user.displayName, "New member");
  assert.equal(memberRedemption.body.user.role, "member");
  assert.equal((await request(`/household/invitations/${memberInvite.invitation.id}`, "DELETE",
    undefined, masterToken)).status, 400);
  const redeemedList = await request("/household/invitations", "GET", undefined, masterToken);
  const redeemedInvite = redeemedList.body.invitations.find((item) => item.id === memberInvite.invitation.id);
  assert.equal(redeemedInvite.status, "redeemed");
  assert.equal(redeemedInvite.userId, memberRedemption.body.user.id);
  assert.equal((await request("/household/invitations", "POST", { displayName: "Member forbidden" },
    memberRedemption.body.deviceToken)).status, 403);
  assert.equal((await request("/household/invitations", "GET", undefined,
    memberRedemption.body.deviceToken)).status, 403);
  assert.equal((await request("/pairing/invitations/redeem", "POST", {
    invitationCode: memberInvite.invitationCode, deviceId: "second-device", deviceName: "Second phone",
  })).status, 400);
  assert.equal((await request("/bootstrap", "GET", undefined, masterToken)).status, 200);
  assert.equal((await request("/bootstrap", "GET", undefined, memberRedemption.body.deviceToken)).status, 200);

  const targetMemberId = memberRedemption.body.user.id;
  const targeted = await request("/household/invitations", "POST", { userId: targetMemberId }, masterToken);
  assert.equal(targeted.status, 201);
  assert.equal(targeted.body.invitation.role, "member");
  assert.equal(targeted.body.invitation.displayName, "New member");
  const identitySession = await request("/pairing/invitations/redeem", "POST", {
    invitationCode: targeted.body.invitationCode, deviceId: "targeted-member-device", deviceName: "Targeted device",
  });
  assert.equal(identitySession.status, 200);
  assert.equal(identitySession.body.user.id, targetMemberId);
  assert.equal(identitySession.body.user.role, "member");
  const targetedMaster = await request("/household/invitations", "POST", { userId: setup.body.user.id }, masterToken);
  assert.equal(targetedMaster.status, 201);
  assert.equal(targetedMaster.body.invitation.role, "master");
  assert.equal(targetedMaster.body.invitation.displayName, "Owner");
  const conflictingDevice = await request("/pairing/invitations/redeem", "POST", {
    invitationCode: targetedMaster.body.invitationCode, deviceId: "master-device", deviceName: "Impersonating device",
  });
  assert.equal(conflictingDevice.status, 400);
  const masterRecoverySession = await request("/pairing/invitations/redeem", "POST", {
    invitationCode: targetedMaster.body.invitationCode, deviceId: "second-master-device", deviceName: "New Master phone",
  });
  assert.equal(masterRecoverySession.status, 200);
  assert.equal(masterRecoverySession.body.user.id, setup.body.user.id);
  assert.equal(masterRecoverySession.body.user.role, "master");

  const revoked = await request("/household/invitations", "POST", { displayName: "Revoked user" }, masterToken);
  assert.equal(revoked.status, 201);
  assert.equal((await request(`/household/invitations/${revoked.body.invitation.id}`, "DELETE", undefined,
    memberRedemption.body.deviceToken)).status, 403);
  const revokeResult = await request(`/household/invitations/${revoked.body.invitation.id}`, "DELETE", undefined, masterToken);
  assert.equal(revokeResult.status, 200);
  assert.equal(revokeResult.body.status, "revoked");
  assert.equal((await request("/pairing/invitations/redeem", "POST", {
    invitationCode: revoked.body.invitationCode, deviceId: "revoked-device", deviceName: "Phone",
  })).status, 400);

  const expired = await request("/household/invitations", "POST", { displayName: "Expired user" }, masterToken);
  assert.equal(expired.status, 201);
  db = new DatabaseSync(dataPath);
  db.prepare("UPDATE household_invitations SET expires_at=? WHERE id=?")
    .run(new Date(Date.now() - 1000).toISOString(), expired.body.invitation.id);
  assert.equal((await request("/pairing/invitations/redeem", "POST", {
    invitationCode: expired.body.invitationCode, deviceId: "expired-device", deviceName: "Phone",
  })).status, 400);
  assert.equal((await request("/household/invitations", "GET", undefined, masterToken)).body.invitations
    .find((item) => item.id === expired.body.invitation.id).status, "expired");

  const raced = await request("/household/invitations", "POST", { displayName: "Race user" }, masterToken);
  assert.equal(raced.status, 201);
  const raceResults = await Promise.all([
    request("/pairing/invitations/redeem", "POST", {
      invitationCode: raced.body.invitationCode, deviceId: "race-device-one", deviceName: "Race one",
    }),
    request("/pairing/invitations/redeem", "POST", {
      invitationCode: raced.body.invitationCode, deviceId: "race-device-two", deviceName: "Race two",
    }),
  ]);
  assert.deepEqual(raceResults.map((result) => result.status).sort(), [200, 400]);
  const raceUser = raceResults.find((result) => result.status === 200).body.user.id;
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id=? AND display_name='Race user'").get(raceUser).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE owner_user_id=? AND role='main'").get(raceUser).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM device_sessions WHERE user_id=?").get(raceUser).count, 1);
  assert.equal(db.prepare("SELECT status FROM household_invitations WHERE id=?").get(raced.body.invitation.id).status, "redeemed");

  const removedName = await request("/household/invitations", "POST", { displayName: "Removed person" }, masterToken);
  const removedSession = await request("/pairing/invitations/redeem", "POST", {
    invitationCode: removedName.body.invitationCode, deviceId: "removed-person-device", deviceName: "Phone",
  });
  assert.equal(removedSession.status, 200);
  assert.equal((await request(`/household/members/${removedSession.body.user.id}`, "DELETE", undefined, masterToken)).status, 200);
  assert.equal((await request("/household/invitations", "POST", { displayName: "REMOVED PERSON" }, masterToken)).status, 400);

  const pendingAtTransfer = await request("/household/invitations", "POST", { displayName: "Pending at transfer" }, masterToken);
  assert.equal(pendingAtTransfer.status, 201);
  assert.equal((await request("/household/master", "PATCH", { targetUserId: targetMemberId }, masterToken)).status, 200);
  assert.equal((await request("/pairing/invitations/redeem", "POST", {
    invitationCode: pendingAtTransfer.body.invitationCode, deviceId: "transfer-invalidated", deviceName: "Phone",
  })).status, 400);
  assert.equal((await request("/household/master/claim", "POST", {}, memberRedemption.body.deviceToken)).status, 410);
  assert.equal((await request("/pairing/redeem", "POST", {
    pairingCode: "123456", displayName: "Attacker", deviceId: "old-pair", deviceName: "Phone",
  })).status, 410);
  assert.equal((await request("/pairing/current", "GET", undefined, masterToken)).status, 410);
  assert.match((await request("/pairing/current")).body.error, /Upgrade/);
  const raceWinner = raceResults.find((result) => result.status === 200);
  assert.equal((await request("/household/invitations", "GET", undefined, raceWinner.body.deviceToken)).status, 403);
  const remainingRedemptionAttempts = 20 - 12;
  for (let attempt = 0; attempt < remainingRedemptionAttempts; attempt += 1) {
    assert.equal((await request("/pairing/invitations/redeem", "POST", {
      invitationCode: "invalid", deviceId: `limited-${attempt}`, deviceName: "Phone",
    })).status, 400);
  }
  assert.equal((await request("/pairing/invitations/redeem", "POST", {
    invitationCode: "invalid", deviceId: "limited-final", deviceName: "Phone",
  })).status, 429);

  const preservedSession = db.prepare("SELECT token_hash,revoked_at FROM device_sessions WHERE device_id='master-device'").get();
  assert.equal(preservedSession.revoked_at, null);
  assert.equal(typeof preservedSession.token_hash, "string");
  db.close();
  db = null;

  const recoveryPath = join(directory, "recovery.sqlite");
  const recoveryCode = `
    const store = await import('./src/lib/budget-store.ts');
    const setup = store.setupHousehold({householdName:'Recovery',displayName:'Master Owner',currency:'EUR',deviceId:'kept-device',deviceName:'Kept phone'});
    const invitation = store.createLocalMasterInvitation();
    const redeemed = store.redeemHouseholdInvitation({invitationCode:invitation.invitationCode,deviceId:'restored-device',deviceName:'Restored phone'});
    if (redeemed.user.id !== setup.user.id || redeemed.user.role !== 'master') throw new Error('Recovery target mismatch');
    console.log(JSON.stringify({userId:redeemed.user.id,role:redeemed.user.role,invitationRole:invitation.invitation.role}));
  `;
  const { spawnSync } = await import("node:child_process");
  const recovery = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", recoveryCode], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NODE_ENV: "production", BUDGET_DB_PATH: recoveryPath },
    encoding: "utf8",
  });
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.deepEqual(JSON.parse(recovery.stdout), {
    userId: JSON.parse(recovery.stdout).userId, role: "master", invitationRole: "master",
  });
  const recoveryDb = new DatabaseSync(recoveryPath);
  assert.equal(recoveryDb.prepare("SELECT COUNT(*) AS count FROM device_sessions WHERE device_id='kept-device' AND revoked_at IS NULL").get().count, 1);
  recoveryDb.close();
  console.log("Household invitation security checks passed");
} finally {
  db?.close();
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(directory, { recursive: true, force: true });
}