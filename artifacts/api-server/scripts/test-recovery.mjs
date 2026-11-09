import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHttpInvitationSession } from "./invitation-test-helpers.mjs";

const directory = await mkdtemp(join(tmpdir(), "home-ledger-recovery-test-"));
const sourcePath = join(directory, "source.sqlite");
const restoredPath = join(directory, "restored.sqlite");
process.env["NODE_ENV"] = "production";
process.env["HOME"] = directory;
process.env["XDG_CONFIG_HOME"] = join(directory, "config");
process.env["BUDGET_DB_PATH"] = sourcePath;
process.env["BUDGET_RECOVERY_DIR"] = "";
const {
  enrollRecovery, decryptArchive, previewArchive, restoreArchive, recoveryStatus,
  runEncryptedBackup, createEncryptedExport, cleanupRestoreOrphans,
} = await import("../src/lib/recovery.ts");
const { resolveRecoveryKeyringPath } = await import("../src/lib/database-path.ts");
assert.notEqual(
  resolveRecoveryKeyringPath({ ...process.env, APP_VARIANT: "accelerated-test", NODE_ENV: "production" }),
  resolveRecoveryKeyringPath({ ...process.env, APP_VARIANT: "", NODE_ENV: "production" }),
);
assert.notEqual(
  resolveRecoveryKeyringPath({ ...process.env, APP_VARIANT: "", NODE_ENV: "development" }),
  resolveRecoveryKeyringPath({ ...process.env, APP_VARIANT: "", NODE_ENV: "test" }),
);
assert.equal(runEncryptedBackup(), null, "An unenrolled server must not write a backup");
const staleStage = join(directory, ".home-ledger-restore-999999999-abcdef");
mkdirSync(staleStage);
writeFileSync(join(staleStage, "restored.sqlite"), "orphan");
cleanupRestoreOrphans(sourcePath);
assert.equal(existsSync(staleStage), false);
const staleTmpfsStage = "/dev/shm/home-ledger-snapshot-999999999-abcdef";
if (existsSync("/dev/shm")) {
  mkdirSync(staleTmpfsStage, { recursive: true, mode: 0o700 });
  cleanupRestoreOrphans(sourcePath);
  assert.equal(existsSync(staleTmpfsStage), false);
}
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const base = `http://127.0.0.1:${port}/api`;
let child;
let logs = "";
let db;
const diagnosticLogs = () => logs.replace(/Local Master recovery invitation: [A-F0-9]+/g, "Local Master recovery invitation: [redacted]");

async function startServer(databasePath, recoveryDir = "") {
  process.env["BUDGET_DB_PATH"] = databasePath;
  const server = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env, NODE_ENV: "production", BUDGET_DB_PATH: databasePath,
      HOST: "127.0.0.1", PORT: String(port), BUDGET_RECOVERY_DIR: recoveryDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });
  const deadline = Date.now() + 10_000;
  while (true) {
    if (server.exitCode !== null) throw new Error(`Server exited:\n${diagnosticLogs()}`);
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return server;
    } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start:\n${diagnosticLogs()}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function stopServer(server) {
  server?.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server?.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (server?.exitCode === null) server.kill("SIGKILL");
}

async function request(path, token, method = "GET") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: token ? { "x-device-token": token } : {},
  });
  return response;
}

async function invitationRequest(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-device-token": token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function runInteractiveRestore(archivePath, recoveryPhrase, databasePath, configHome) {
  if (!existsSync("/usr/bin/script")) {
    restoreArchive(archivePath, recoveryPhrase);
    return;
  }
  const cli = spawn("/usr/bin/script", [
    "-qefc", "node --experimental-strip-types ./scripts/backup-restore.mjs", "/dev/null",
  ], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env, NODE_ENV: "production", BUDGET_DB_PATH: databasePath,
      XDG_CONFIG_HOME: configHome, BUDGET_RECOVERY_DIR: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  cli.stdout.on("data", (chunk) => { output += chunk; });
  cli.stderr.on("data", (chunk) => { output += chunk; });
  const waitFor = async (text) => {
    const deadline = Date.now() + 5000;
    while (!output.includes(text)) {
      if (cli.exitCode !== null) throw new Error(`Restore CLI exited before ${text}:\n${output}`);
      if (Date.now() > deadline) throw new Error(`Restore CLI did not prompt for ${text}:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  cli.stdin.write(`${archivePath}\n`);
  await waitFor("Recovery phrase (input hidden):");
  cli.stdin.write(`${recoveryPhrase}\n`);
  await waitFor("Type RESTORE to install");
  cli.stdin.write("RESTORE\n");
  const deadline = Date.now() + 5000;
  while (cli.exitCode === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  if (cli.exitCode === null) cli.kill("SIGKILL");
  assert.equal(cli.exitCode, 0, output);
  assert.match(output, /Restore completed/);
  assert.equal(output.includes(recoveryPhrase), false, "Recovery phrase must not be echoed by the restore CLI");
}

try {
  child = await startServer(sourcePath);
  const setupResponse = await fetch(`${base}/household/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      householdName: "Recovery home", displayName: "Owner", currency: "USD",
      deviceId: "recovery-master", deviceName: "Master device",
    }),
  });
  assert.equal(setupResponse.status, 201);
  const setup = await setupResponse.json();
  const member = await createHttpInvitationSession(
    invitationRequest, setup, { displayName: "Member" }, "recovery-member", "Member device",
  );
  const pendingInvitation = await invitationRequest(
    "/household/invitations", { displayName: "Pending recovery invite" }, setup.deviceToken,
  );
  assert.equal(pendingInvitation.status, 201);
  assert.equal((await request("/backups/status")).status, 401);
  assert.equal((await request("/backups/export", undefined, "POST")).status, 401);
  assert.equal((await request("/backups/save-to-server", undefined, "POST")).status, 401);
  assert.equal((await request("/backups/status", member.deviceToken)).status, 403);
  assert.equal((await request("/backups/export", member.deviceToken, "POST")).status, 403);
  assert.equal((await request("/backups/save-to-server", member.deviceToken, "POST")).status, 403);
  const unenrolled = await request("/backups/save-to-server", setup.deviceToken, "POST");
  assert.equal(unenrolled.status, 409);
  assert.match((await unenrolled.json()).error, /not enrolled/i);
  const phrase = enrollRecovery();
  const unconfigured = await request("/backups/save-to-server", setup.deviceToken, "POST");
  assert.equal(unconfigured.status, 409);
  assert.match((await unconfigured.json()).error, /not configured/i);

  db = new DatabaseSync(sourcePath);
  db.exec("BEGIN IMMEDIATE");
  db.prepare("UPDATE groups SET name=?").run("WAL snapshot household");
  db.exec("COMMIT");
  const ordinaryDirectory = join(directory, "not-a-mountpoint");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(ordinaryDirectory);
  process.env["BUDGET_RECOVERY_DIR"] = ordinaryDirectory;
  assert.equal(recoveryStatus().destinationConfigured, true);
  assert.equal(recoveryStatus().destinationAvailable, false);
  assert.equal(runEncryptedBackup(), null);
  assert.match(recoveryStatus().lastError ?? "", /mountpoint/i);
  process.env["BUDGET_RECOVERY_DIR"] = "";
  await stopServer(child);
  child = await startServer(sourcePath, join(directory, "missing-mount"));
  const unavailable = await request("/backups/save-to-server", setup.deviceToken, "POST");
  assert.equal(unavailable.status, 409);
  assert.match((await unavailable.json()).error, /mountpoint does not exist/i);
  assert.equal(existsSync(join(directory, "missing-mount")), false, "Never create a fallback destination");
  await stopServer(child);
  child = await startServer(sourcePath);

  const shmPathForFailure = "/dev/shm";
  if (existsSync(shmPathForFailure)) {
    const shm = statSync(realpathSync(shmPathForFailure));
    const shmParent = statSync(dirname(realpathSync(shmPathForFailure)));
    if (shm.dev !== shmParent.dev && shm.dev !== statSync(sourcePath).dev) {
      process.env["BUDGET_DB_PATH"] = directory;
      process.env["BUDGET_RECOVERY_DIR"] = shmPathForFailure;
      assert.throws(() => runEncryptedBackup());
      assert.match(recoveryStatus().lastError ?? "", /snapshot|database|unable/i);
      process.env["BUDGET_DB_PATH"] = sourcePath;
      process.env["BUDGET_RECOVERY_DIR"] = "";
    }
  }
  const statusResponse = await request("/backups/status", setup.deviceToken);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.deepEqual({
    enrolled: status.enrolled, destinationConfigured: status.destinationConfigured,
    destinationAvailable: status.destinationAvailable, lastSuccessfulAt: status.lastSuccessfulAt,
  }, { enrolled: true, destinationConfigured: false, destinationAvailable: false, lastSuccessfulAt: null });
  assert.ok(status.lastError === null || /database|snapshot|open|mountpoint/i.test(status.lastError));
  const exportResponse = await request("/backups/export", setup.deviceToken, "POST");
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get("content-type"), "application/octet-stream");
  assert.match(exportResponse.headers.get("content-disposition"), /\.hlbackup/);
  assert.equal(exportResponse.headers.get("cache-control"), "no-store");
  const archive = Buffer.from(await exportResponse.arrayBuffer());
  const decrypted = decryptArchive(archive, phrase);
  const archivePath = join(directory, "household.hlbackup");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(archivePath, archive, { mode: 0o600 });
  assert.equal(previewArchive(archivePath, phrase).household, "WAL snapshot household");
  assert.throws(() => decryptArchive(archive, `${phrase}wrong`), /authentication failed/i);
  const tampered = Buffer.from(archive);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptArchive(tampered, phrase), /authentication failed/i);
  const shmPath = "/dev/shm";
  if (existsSync(shmPath)) {
    const shm = statSync(realpathSync(shmPath));
    const shmParent = statSync(dirname(realpathSync(shmPath)));
    if (shm.dev !== shmParent.dev && shm.dev !== statSync(sourcePath).dev) {
      process.env["BUDGET_RECOVERY_DIR"] = shmPath;
      await stopServer(child);
      const existing = new Set(
        (await import("node:fs")).readdirSync(shmPath).filter((name) => /^home-ledger-.*\.hlbackup$/.test(name)),
      );
      child = await startServer(sourcePath, shmPath);
      const before = new Set(
        (await import("node:fs")).readdirSync(shmPath).filter((name) => /^home-ledger-.*\.hlbackup$/.test(name)),
      );
      const immediate = await request("/backups/save-to-server", setup.deviceToken, "POST");
      assert.equal(immediate.status, 200);
      assert.match(immediate.headers.get("content-type"), /application\/json/);
      assert.equal(immediate.headers.get("cache-control"), "no-store");
      const saved = await immediate.json();
      assert.ok(Date.parse(saved.savedAt) > 0);
      assert.equal(Object.hasOwn(saved, "path"), false);
      const after = (await import("node:fs")).readdirSync(shmPath)
        .filter((name) => /^home-ledger-.*\.hlbackup$/.test(name) && !before.has(name));
      assert.equal(after.length, 1, "Immediate request creates exactly one new encrypted archive");
       assert.match(after[0], /-[a-f0-9]{32}\.hlbackup$/, "Use a collision-resistant name for atomic rename");
       assert.equal(
         (await import("node:fs")).readdirSync(shmPath).some((name) => name.startsWith(`.${after[0]}.`) && name.endsWith(".tmp")),
         false, "Do not leave the temporary archive after finalizing it",
       );
      const immediatePath = join(shmPath, after[0]);
      assert.equal(statSync(immediatePath).mode & 0o777, 0o600);
      assert.equal(decryptArchive(readFileSync(immediatePath), phrase).metadata.algorithm, "aes-256-gcm");
      assert.equal((await (await request("/backups/status", setup.deviceToken)).json()).lastSuccessfulAt, saved.savedAt);
      unlinkSync(immediatePath);
      await stopServer(child);
      for (const name of (await import("node:fs")).readdirSync(shmPath)) {
        if (/^home-ledger-.*\.hlbackup$/.test(name) && !existing.has(name)) unlinkSync(join(shmPath, name));
      }
      child = await startServer(sourcePath);
      const scheduledPath = runEncryptedBackup();
      assert.ok(scheduledPath?.endsWith(".hlbackup"));
      try {
        const details = statSync(scheduledPath);
        assert.equal(details.mode & 0o777, 0o600);
        assert.equal(decryptArchive(readFileSync(scheduledPath), phrase).metadata.algorithm, "aes-256-gcm");
      } finally {
        if (scheduledPath) unlinkSync(scheduledPath);
      }
      process.env["BUDGET_RECOVERY_DIR"] = "";
    }
  }

  assert.throws(() => restoreArchive(archivePath, phrase), /target database or SQLite sidecar already exists/);
  await stopServer(child);
  child = undefined;
  db.close();
  db = undefined;

  process.env["BUDGET_DB_PATH"] = restoredPath;
  process.env["XDG_CONFIG_HOME"] = join(directory, "unrelated-config");
  enrollRecovery();
  assert.throws(() => restoreArchive(archivePath, phrase), /authentication failed/i);
  process.env["XDG_CONFIG_HOME"] = join(directory, "restored-config");
  assert.equal(existsSync(resolveRecoveryKeyringPath()), false);
  await runInteractiveRestore(archivePath, phrase, restoredPath, process.env["XDG_CONFIG_HOME"]);
  assert.equal(recoveryStatus().enrolled, true);
  assert.equal(decryptArchive(createEncryptedExport(), phrase).metadata.algorithm, "aes-256-gcm");
  const restored = new DatabaseSync(restoredPath);
  const restoredGroupId = restored.prepare("SELECT id FROM groups WHERE name=?").get("WAL snapshot household").id;
  assert.ok(restoredGroupId);
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM groups WHERE name=?").get("WAL snapshot household").count, 1);
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM device_sessions").get().count, 0);
  const restoredInvitation = restored.prepare("SELECT status FROM household_invitations WHERE id=?").get(pendingInvitation.body.invitation.id);
  assert.equal(restoredInvitation?.status, "revoked", "restore must revoke every pending invitation");
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM household_invitations WHERE status='pending'").get().count, 0);
  restored.close();

  child = await startServer(restoredPath);
  assert.equal((await request("/bootstrap", setup.deviceToken)).status, 401);
  await stopServer(child);
  child = undefined;
  process.env["BUDGET_DB_PATH"] = restoredPath;
  const restoredStore = await import("../src/lib/budget-store.ts");
  const { invitationCode } = restoredStore.createLocalMasterInvitation();
  const localMaster = restoredStore.redeemHouseholdInvitation({
    invitationCode, deviceId: "restored-local-master", deviceName: "Local recovery device",
  });
  assert.equal(localMaster.user.role, "master");
  assert.equal(localMaster.state.groupId, restoredGroupId);
  console.log("Recovery encryption, tamper detection, WAL snapshots, role guards, restore refusal, and session invalidation passed");
} finally {
  db?.close();
  await stopServer(child);
  await rm(directory, { recursive: true, force: true });
}