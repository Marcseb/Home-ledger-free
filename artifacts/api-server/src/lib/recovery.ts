import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import {
  accessSync, chmodSync, closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync,
  renameSync, statfsSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  createCipheriv, createDecipheriv, randomBytes, randomInt, scryptSync,
} from "node:crypto";
// @ts-ignore The offline Node CLI loads this TypeScript module directly with strip-types.
import { resolveDatabasePath, resolveRecoveryKeyringPath } from "./database-path.ts";
// @ts-ignore The offline Node CLI loads this TypeScript module directly with strip-types.
import { openMemorySnapshot, snapshotDatabaseInMemory } from "./memory-snapshot.ts";

const ARCHIVE_MAGIC = Buffer.from("HLBACKUP");
const ARCHIVE_VERSION = 1;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const RETENTION_DEFAULT_DAYS = 30;
const TMPFS_MAGIC = 0x01021994;

type Keyring = {
  version: 1;
  enrolledAt: string;
  dataKey: string;
  salt: string;
  wrapNonce: string;
  wrappedKey: string;
  wrapTag: string;
  lastSuccessfulAt: string | null;
  lastError: string | null;
};

type ArchiveMetadata = {
  version: 1;
  algorithm: "aes-256-gcm";
  kdf: "scrypt";
  createdAt: string;
  salt: string;
  wrapNonce: string;
  wrappedKey: string;
  wrapTag: string;
  payloadNonce: string;
  payloadTag: string;
  payloadBytes: number;
};

export function getKeyringPath() {
  return resolveRecoveryKeyringPath();
}

function readKeyring(): Keyring | null {
  const path = getKeyringPath();
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Keyring;
  if (parsed.version !== 1 || !/^[0-9a-f]{64}$/i.test(parsed.dataKey)) {
    throw new Error("Recovery keyring is malformed");
  }
  return parsed;
}

function saveKeyring(keyring: Keyring) {
  const path = getKeyringPath();
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  setPrivateMode(directory, 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(keyring), { mode: 0o600, flag: "wx" });
  setPrivateMode(temporary, 0o600);
  renameSync(temporary, path);
  setPrivateMode(path, 0o600);
}

function createKeyring(keyring: Keyring) {
  const path = getKeyringPath();
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  setPrivateMode(directory, 0o700);
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temporary, JSON.stringify(keyring), { mode: 0o600, flag: "wx" });
  let linked = false;
  try {
    const keyFd = openSync(temporary, fsConstants.O_RDWR);
    try { fsyncSync(keyFd); } finally { closeSync(keyFd); }
    linkSync(temporary, path);
    linked = true;
    setPrivateMode(path, 0o600);
    fsyncDirectory(directory);
    return statSync(path);
  } catch (error) {
    if (linked) {
      try { unlinkSync(path); } catch { /* Retain the original keyring error. */ }
    }
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}

function fsyncDirectory(path: string) {
  if (process.platform !== "linux") return;
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function setPrivateMode(path: string, mode: number) {
  if (process.platform !== "win32") chmodSync(path, mode);
}

function fdPath(fd: number) {
  if (process.platform === "linux") return `/proc/self/fd/${fd}`;
  if (process.platform === "darwin") return `/dev/fd/${fd}`;
  throw new Error("Directory-handle paths are unavailable on this platform");
}

function syncDirectoryHandle(fd: number) {
  if (process.platform === "linux") fsyncSync(fd);
}

function phraseKey(phrase: string, salt: Buffer) {
  if (phrase.length < 32 || phrase.length > 256) throw new Error("Recovery phrase is invalid");
  return scryptSync(phrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function wrapDataKey(dataKey: Buffer, phrase: string, salt = randomBytes(16)) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", phraseKey(phrase, salt), nonce);
  cipher.setAAD(Buffer.from(`HomeLedger recovery key v${ARCHIVE_VERSION}`));
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return { salt: salt.toString("base64"), wrapNonce: nonce.toString("base64"),
    wrappedKey: wrapped.toString("base64"), wrapTag: cipher.getAuthTag().toString("base64") };
}

function unwrapDataKey(metadata: Pick<ArchiveMetadata, "salt" | "wrapNonce" | "wrappedKey" | "wrapTag">, phrase: string) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", phraseKey(phrase, Buffer.from(metadata.salt, "base64")),
      Buffer.from(metadata.wrapNonce, "base64"));
    decipher.setAAD(Buffer.from(`HomeLedger recovery key v${ARCHIVE_VERSION}`));
    decipher.setAuthTag(Buffer.from(metadata.wrapTag, "base64"));
    const key = Buffer.concat([decipher.update(Buffer.from(metadata.wrappedKey, "base64")), decipher.final()]);
    if (key.length !== 32) throw new Error("invalid key size");
    return key;
  } catch {
    throw new Error("Archive authentication failed: recovery phrase is incorrect or archive is damaged");
  }
}

export function enrollRecovery() {
  if (readKeyring()) throw new Error("Recovery is already enrolled; refusing to replace its keyring");
  const phrase = randomBytes(32).toString("base64url");
  const dataKey = randomBytes(32);
  const wrapped = wrapDataKey(dataKey, phrase);
  const keyring: Keyring = {
    version: 1, enrolledAt: new Date().toISOString(), dataKey: dataKey.toString("hex"),
    ...wrapped, lastSuccessfulAt: null, lastError: null,
  };
  createKeyring(keyring);
  return phrase;
}

function archiveAad(metadata: Omit<ArchiveMetadata, "payloadTag">) {
  return Buffer.from(JSON.stringify(metadata));
}

function createArchiveFromSnapshot(payload: Uint8Array, keyring: Keyring) {
  if (payload.length > MAX_ARCHIVE_BYTES - MAX_METADATA_BYTES - 12) throw new Error("Household database exceeds archive size limit");
  const wrappedFields = {
    salt: keyring.salt, wrapNonce: keyring.wrapNonce, wrappedKey: keyring.wrappedKey, wrapTag: keyring.wrapTag,
  };
  const base = {
    version: ARCHIVE_VERSION as 1, algorithm: "aes-256-gcm" as const, kdf: "scrypt" as const,
    createdAt: new Date().toISOString(), ...wrappedFields, payloadNonce: randomBytes(12).toString("base64"),
    payloadBytes: payload.length,
  };
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyring.dataKey, "hex"), Buffer.from(base.payloadNonce, "base64"));
  cipher.setAAD(archiveAad(base));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const metadata: ArchiveMetadata = { ...base, payloadTag: cipher.getAuthTag().toString("base64") };
  const metadataBytes = Buffer.from(JSON.stringify(metadata));
  return Buffer.concat([ARCHIVE_MAGIC, Buffer.from([metadataBytes.length >>> 24, metadataBytes.length >>> 16 & 255,
    metadataBytes.length >>> 8 & 255, metadataBytes.length & 255]), metadataBytes, encrypted]);
}

function openVerifiedTmpfs() {
  const base = "/dev/shm";
  if (!statSync(base).isDirectory() || statfsSync(base).type !== TMPFS_MAGIC) throw new Error("not a tmpfs mount");
  const realBase = realpathSync(base);
  const expected = statSync(realBase);
  const fd = openSync(realBase, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== expected.dev || opened.ino !== expected.ino
      || statfsSync(`/proc/self/fd/${fd}`).type !== TMPFS_MAGIC) {
      throw new Error("tmpfs mount changed during verification");
    }
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function createEncryptedExport() {
  const keyring = readKeyring();
  if (!keyring) throw new Error("Recovery is not enrolled");
  let snapshot: Uint8Array;
  try {
    snapshot = snapshotDatabaseInMemory(resolveDatabasePath(), MAX_ARCHIVE_BYTES - MAX_METADATA_BYTES - 12);
  } catch (error) {
    recordFailure(error instanceof Error ? error.message : "Encrypted export snapshot failed");
    throw error;
  }
  try {
    return createArchiveFromSnapshot(snapshot, keyring);
  } finally {
    snapshot.fill(0);
  }
}

function configuredDestination() {
  const rawDestination = process.env["BUDGET_RECOVERY_DIR"]?.trim();
  if (!rawDestination) return { configured: false as const, available: false as const, path: null, reason: "BUDGET_RECOVERY_DIR is not configured" };
  if (process.platform === "win32") {
    return { configured: true as const, available: false as const, path: null,
      reason: "Scheduled encrypted backups to external drives are not supported by this Free server package yet" };
  }
  if (!isAbsolute(rawDestination)) return { configured: true as const, available: false as const, path: null, reason: "BUDGET_RECOVERY_DIR must be an absolute path" };
  const destination = resolve(rawDestination);
  if (!existsSync(destination)) return { configured: true as const, available: false as const, path: null, reason: "Recovery mountpoint does not exist" };
  try {
    const realDirectory = realpathSync(destination);
    const destinationStat = statSync(realDirectory);
    if (!destinationStat.isDirectory()) return { configured: true as const, available: false as const, path: null, reason: "Recovery path is not a directory" };
    const parentStat = statSync(dirname(realDirectory));
    // Comparing devices fails closed for subdirectories and same-device bind mounts.
    if (destinationStat.dev === parentStat.dev) {
      return { configured: true as const, available: false as const, path: null, reason: "Recovery path must be an exact filesystem mountpoint" };
    }
    const dbStat = statSync(resolveDatabasePath());
    if (destinationStat.dev === dbStat.dev) {
      return { configured: true as const, available: false as const, path: null, reason: "Recovery mountpoint is on the database filesystem" };
    }
    accessSync(realDirectory, fsConstants.W_OK);
    return {
      configured: true as const, available: true as const, path: realDirectory, reason: null,
      dev: destinationStat.dev, ino: destinationStat.ino,
    };
  } catch {
    return { configured: true as const, available: false as const, path: null, reason: "Recovery mountpoint is unavailable" };
  }
}

export function recoveryStatus() {
  let keyring: Keyring | null = null;
  let lastError: string | null = null;
  try {
    keyring = readKeyring();
    lastError = keyring?.lastError ?? null;
  } catch {
    lastError = "Recovery keyring is unreadable";
  }
  const destination = configuredDestination();
  if (keyring?.lastSuccessfulAt && Date.now() - Date.parse(keyring.lastSuccessfulAt)
    > Number(process.env["BACKUP_INTERVAL_HOURS"] ?? 24) * 3600000) {
    lastError ??= "Last encrypted backup is stale";
  }
  return {
    enrolled: keyring !== null,
    destinationConfigured: destination.configured,
    destinationAvailable: destination.available,
    lastSuccessfulAt: keyring?.lastSuccessfulAt ?? null,
    lastError,
  };
}

export function runEncryptedBackup() {
  const keyring = readKeyring();
  if (!keyring) return recordFailure("Recovery is not enrolled");
  const destination = configuredDestination();
  if (!destination.available || !destination.path) return recordFailure(destination.reason ?? "Recovery mountpoint is unavailable");
  let destinationFd: number | null = null;
  let snapshot: Uint8Array | null = null;
  let temporaryPath: string | null = null;
  try {
    destinationFd = openVerifiedDestination(destination);
    snapshot = snapshotDatabaseInMemory(resolveDatabasePath(), MAX_ARCHIVE_BYTES - MAX_METADATA_BYTES - 12);
    const archive = createArchiveFromSnapshot(snapshot, keyring);
    snapshot.fill(0);
    snapshot = null;
    verifyOpenDestination(destinationFd, destination);
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
    // Use an unpredictable name so an atomic rename cannot collide with another backup.
    const filename = `home-ledger-${timestamp}-${randomBytes(16).toString("hex")}.hlbackup`;
    const anchoredDirectory = fdPath(destinationFd);
    temporaryPath = `${anchoredDirectory}/.${filename}.${process.pid}.tmp`;
    const anchoredFinalPath = `${anchoredDirectory}/${filename}`;
    const archiveFd = openSync(temporaryPath, "wx", 0o600);
    try {
      writeFileSync(archiveFd, archive);
      fsyncSync(archiveFd);
    } finally {
      closeSync(archiveFd);
    }
    verifyOpenDestination(destinationFd, destination);
    try {
      lstatSync(anchoredFinalPath);
      throw new Error("Backup filename already exists; refusing to overwrite");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // A rename within the held mount remains atomic on filesystems without hard links
    // (such as FAT/exFAT), without following the original mount pathname if it disappears.
    renameSync(temporaryPath, anchoredFinalPath);
    temporaryPath = null;
    syncDirectoryHandle(destinationFd);
    verifyOpenDestination(destinationFd, destination);
    const completedAt = new Date().toISOString();
    keyring.lastSuccessfulAt = completedAt;
    keyring.lastError = null;
    saveKeyring(keyring);
    const retentionDays = Number(process.env["BACKUP_RETENTION_DAYS"] ?? RETENTION_DEFAULT_DAYS);
    const cutoff = Date.now() - (Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : RETENTION_DEFAULT_DAYS) * 86400000;
    let removedArchive = false;
    for (const name of readdirSync(anchoredDirectory)) {
      if (!/^home-ledger-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}(?:[a-f0-9]{24})?\.hlbackup$/.test(name)) continue;
      const file = `${anchoredDirectory}/${name}`;
      try {
        const info = statSync(file);
        if (info.isFile() && info.mtimeMs < cutoff) {
          rmSync(file);
          removedArchive = true;
        }
      } catch { /* A concurrently removed archive does not affect this backup. */ }
    }
    if (removedArchive) syncDirectoryHandle(destinationFd);
    return resolve(destination.path, filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Encrypted backup failed";
    recordFailure(message);
    throw error;
  } finally {
    if (temporaryPath) rmSync(temporaryPath, { force: true });
    snapshot?.fill(0);
    if (destinationFd !== null) closeSync(destinationFd);
  }
}

function openVerifiedDestination(destination: { path: string; dev: number; ino: number }) {
  const fd = openSync(destination.path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    verifyOpenDestination(fd, destination);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function verifyOpenDestination(fd: number, destination: { path: string; dev: number; ino: number }) {
  const opened = fstatSync(fd);
  const current = statSync(destination.path);
  if (!opened.isDirectory() || opened.dev !== destination.dev || opened.ino !== destination.ino
    || current.dev !== destination.dev || current.ino !== destination.ino) {
    throw new Error("Recovery mountpoint changed during backup; refusing to write");
  }
}

function recordFailure(message: string): null {
  try {
    const keyring = readKeyring();
    if (keyring) {
      keyring.lastError = message;
      saveKeyring(keyring);
    }
  } catch { /* Preserve the primary backup failure without logging secrets. */ }
  return null;
}

export function decryptArchive(archive: Buffer, phrase: string) {
  if (archive.length < 12 || archive.length > MAX_ARCHIVE_BYTES || !archive.subarray(0, 8).equals(ARCHIVE_MAGIC)) {
    throw new Error("Invalid or oversized Home Ledger backup archive");
  }
  const metadataLength = archive.readUInt32BE(8);
  if (metadataLength <= 0 || metadataLength > MAX_METADATA_BYTES || 12 + metadataLength >= archive.length) {
    throw new Error("Malformed Home Ledger backup metadata");
  }
  let metadata: ArchiveMetadata;
  try {
    metadata = JSON.parse(archive.subarray(12, 12 + metadataLength).toString("utf8")) as ArchiveMetadata;
  } catch {
    throw new Error("Malformed Home Ledger backup metadata");
  }
  if (metadata.version !== ARCHIVE_VERSION || metadata.algorithm !== "aes-256-gcm" || metadata.kdf !== "scrypt"
    || !Number.isSafeInteger(metadata.payloadBytes) || metadata.payloadBytes <= 0
    || archive.length - 12 - metadataLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Unsupported or invalid Home Ledger backup archive");
  }
  const key = unwrapDataKey(metadata, phrase);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(metadata.payloadNonce, "base64"));
    const { payloadTag: _tag, ...aadMetadata } = metadata;
    decipher.setAAD(archiveAad(aadMetadata));
    decipher.setAuthTag(Buffer.from(metadata.payloadTag, "base64"));
    const payload = Buffer.concat([decipher.update(archive.subarray(12 + metadataLength)), decipher.final()]);
    if (payload.length !== metadata.payloadBytes) throw new Error("Archive payload size mismatch");
    return { payload, metadata };
  } catch {
    throw new Error("Archive authentication failed: recovery phrase is incorrect or archive is damaged");
  }
}

function readArchiveFile(path: string) {
  const info = statSync(path);
  if (!info.isFile() || info.size > MAX_ARCHIVE_BYTES) throw new Error("Invalid or oversized Home Ledger backup archive");
  const archive = readFileSync(path);
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error("Invalid or oversized Home Ledger backup archive");
  return archive;
}

export function previewArchive(archivePath: string, phrase: string) {
  const { payload, metadata } = decryptArchive(readArchiveFile(archivePath), phrase);
  let db: DatabaseSync | null = null;
  try {
    db = openMemorySnapshot(payload);
    validateAndPrepareRestoreDatabase(db);
    const household = (db.prepare("SELECT name FROM groups LIMIT 1").get() as { name: string }).name;
    const counts: Record<string, number> = {};
    for (const table of ["users", "accounts", "categories", "transactions", "budgets", "savings_goals"]) {
      counts[table] = Number((db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count);
    }
    return { household, createdAt: metadata.createdAt, counts };
  } finally {
    db?.close();
    payload.fill(0);
  }
}

export function restoreArchive(archivePath: string, phrase: string) {
  const archive = readArchiveFile(archivePath);
  const { payload, metadata } = decryptArchive(archive, phrase);
  const dataKey = unwrapDataKey(metadata, phrase);
  const existingKeyring = readKeyring();
  let keyringToInstall: Keyring | null = null;
  if (existingKeyring) {
    const existingDataKey = unwrapDataKey(existingKeyring, phrase);
    if (!existingDataKey.equals(dataKey)) {
      throw new Error("Restore refused: the existing recovery keyring belongs to a different household or recovery phrase");
    }
  } else {
    keyringToInstall = {
      version: 1,
      enrolledAt: metadata.createdAt,
      dataKey: dataKey.toString("hex"),
      salt: metadata.salt,
      wrapNonce: metadata.wrapNonce,
      wrappedKey: metadata.wrappedKey,
      wrapTag: metadata.wrapTag,
      lastSuccessfulAt: null,
      lastError: null,
    };
  }
  const dbPath = resolveDatabasePath();
  for (const sidecar of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(sidecar)) throw new Error("Restore refused: the target database or SQLite sidecar already exists");
  }
  const parent = dirname(dbPath);
  mkdirSync(parent, { recursive: true });
  cleanupRestoreOrphans(dbPath);
  const stagingDirectory = mkdtempSync(resolve(parent, `.home-ledger-restore-${process.pid}-`));
  setPrivateMode(stagingDirectory, 0o700);
  const stage = resolve(stagingDirectory, "restored.sqlite");
  try {
    writeFileSync(stage, payload, { flag: "wx", mode: 0o600 });
    validateAndPrepareRestore(stage);
    if (targetDatabaseArtifactsExist(dbPath)) {
      throw new Error("Restore refused: target database appeared during restore");
    }
    const stagedStat = statSync(stage);
    const stageFd = openSync(stage, fsConstants.O_RDWR);
    try { fsyncSync(stageFd); } finally { closeSync(stageFd); }
    const parentFd = process.platform === "linux"
      ? openSync(parent, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY) : null;
    const anchoredParent = parentFd === null ? parent : fdPath(parentFd);
    const anchoredTarget = resolve(anchoredParent, basename(dbPath));
    let installedStat: ReturnType<typeof statSync> | null = null;
    let createdKeyringStat: ReturnType<typeof statSync> | null = null;
    try {
      if (targetDatabaseArtifactsExistAt(anchoredParent, basename(dbPath))) {
        throw new Error("Restore refused: target database or SQLite sidecar appeared during restore");
      }
      if (keyringToInstall) createdKeyringStat = createKeyring(keyringToInstall);
      linkSync(stage, anchoredTarget);
      installedStat = statSync(anchoredTarget);
      unlinkSync(stage);
      if (parentFd !== null) fsyncSync(parentFd);
      if (targetSidecarsExistAt(anchoredParent, basename(dbPath))) {
        throw new Error("Restore refused: SQLite sidecar appeared during restore");
      }
    } catch (error) {
      try {
        const current = statSync(anchoredTarget);
        if (installedStat && current.dev === installedStat.dev && current.ino === installedStat.ino
          && current.dev === stagedStat.dev && current.ino === stagedStat.ino) {
          unlinkSync(anchoredTarget);
          if (parentFd !== null) fsyncSync(parentFd);
        }
      } catch { /* Keep the original failure if the installation was concurrently removed. */ }
      if (createdKeyringStat) {
        try {
          const keyringPath = getKeyringPath();
          const keyringStat = statSync(keyringPath);
          if (keyringStat.dev === createdKeyringStat.dev && keyringStat.ino === createdKeyringStat.ino) {
            unlinkSync(keyringPath);
            fsyncDirectory(dirname(keyringPath));
          }
        } catch { /* Retain the restore error if keyring rollback is not possible. */ }
      }
      throw error;
    } finally {
      if (parentFd !== null) closeSync(parentFd);
    }
    return metadata;
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

export function cleanupRestoreOrphans(dbPath = resolveDatabasePath()) {
  const parent = dirname(dbPath);
  if (existsSync(parent)) {
    for (const name of readdirSync(parent)) {
      const match = /^\.home-ledger-restore-(\d+)-[a-zA-Z0-9]+$/.exec(name);
      if (!match) continue;
      removeDeadProcessDirectory(parent, name, Number(match[1]));
    }
  }
  const temporaryRoot = process.platform === "linux" ? "/dev/shm" : tmpdir();
  if (existsSync(temporaryRoot)) {
    let temporaryRootFd: number | null = null;
    try {
      temporaryRootFd = process.platform === "linux" ? openVerifiedTmpfs() : null;
      const anchoredRoot = temporaryRootFd === null ? temporaryRoot : fdPath(temporaryRootFd);
      for (const name of readdirSync(anchoredRoot)) {
        const match = /^home-ledger-(?:snapshot|restore-preview)-(\d+)-[a-zA-Z0-9]+$/.exec(name);
        if (!match) continue;
        removeDeadProcessDirectory(anchoredRoot, name, Number(match[1]));
      }
    } catch {
      // Startup cleanup is best effort; plaintext staging itself fails closed.
    } finally {
      if (temporaryRootFd !== null) closeSync(temporaryRootFd);
    }
  }
}

function removeDeadProcessDirectory(parent: string, name: string, ownerPid: number) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid === process.pid || processIsAlive(ownerPid)) return;
  const candidate = resolve(parent, name);
  try {
    if (lstatSync(candidate).isDirectory()) rmSync(candidate, { recursive: true, force: true });
  } catch { /* Ignore concurrent cleanup or inaccessible staging directories. */ }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function targetSidecarsExist(dbPath: string) {
  return existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`);
}

function targetSidecarsExistAt(anchoredParent: string, databaseName: string) {
  return existsSync(resolve(anchoredParent, `${databaseName}-wal`))
    || existsSync(resolve(anchoredParent, `${databaseName}-shm`));
}

function targetDatabaseArtifactsExist(dbPath: string) {
  return existsSync(dbPath) || targetSidecarsExist(dbPath);
}

function targetDatabaseArtifactsExistAt(anchoredParent: string, databaseName: string) {
  return existsSync(resolve(anchoredParent, databaseName))
    || targetSidecarsExistAt(anchoredParent, databaseName);
}

export function validateAndPrepareRestore(path: string) {
  const db = new DatabaseSync(path);
  try {
    validateAndPrepareRestoreDatabase(db);
  } finally {
    db.close();
  }
}

function validateAndPrepareRestoreDatabase(db: DatabaseSync) {
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error("SQLite integrity check failed");
    const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length) throw new Error("SQLite foreign-key check failed");
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((item) => item.name));
    for (const table of [
      "groups", "users", "accounts", "categories", "transactions", "allocation_shares", "budgets", "budget_alerts",
      "savings_goals", "savings_goal_participants", "savings_goal_contributions", "recurring_rules", "device_sessions",
      "sync_events", "audit_events", "runtime_state",
    ]) {
      if (!tables.has(table)) throw new Error("Backup does not contain a compatible Home Ledger schema");
    }
    const groups = Number((db.prepare("SELECT COUNT(*) AS count FROM groups").get() as { count: number }).count);
    const masters = Number((db.prepare("SELECT COUNT(*) AS count FROM users WHERE active=1 AND role='master'").get() as { count: number }).count);
    if (groups !== 1 || masters !== 1) throw new Error("Backup must contain exactly one household and one active master");
    db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; DELETE FROM device_sessions;");
    if (tables.has("household_invitations")) {
      db.exec("UPDATE household_invitations SET status='revoked' WHERE status='pending';");
    }
    db.prepare("UPDATE groups SET pairing_code=?,pairing_code_expires_at=?")
      .run(String(randomInt(100000, 1000000)), new Date(Date.now() + 10 * 60000).toISOString());
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* No active transaction. */ }
    throw error;
  }
}