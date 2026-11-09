import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveRecoveryKeyringPath } from "./database-path";

let identity: string | undefined;

export function setHostedServerIdentity(value: string) {
  if (process.env.APP_VARIANT !== "review-demo") throw new Error("Hosted identity requires reviewer mode");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) {
    throw new Error("Invalid hosted server identity");
  }
  identity = value;
}

export function getServerIdentity() {
  if (identity) return identity;
  if (process.env.APP_VARIANT === "review-demo") throw new Error("Hosted server identity has not been initialized");
  const directory = dirname(resolveRecoveryKeyringPath());
  const path = join(directory, "server-instance-id");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, randomUUID(), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const stored = readFileSync(path, "utf8").trim();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(stored)) throw new Error("Invalid local server identity");
  identity = stored;
  return identity;
}

export const serverVariant = () => process.env.APP_VARIANT === "accelerated-test"
  ? "accelerated-test" as const : "production" as const;

export function discoveryProof(
  token: Uint8Array,
  input: { nonce: string; deviceId: string; userId: string; groupId: string },
  id: string,
  variant: string,
) {
  // Identical serialization in the client. The device token never travels in
  // discovery requests; an untrusted LAN responder cannot forge this proof.
  const message = JSON.stringify(["home-ledger-discovery-v1", id, variant, input.nonce, input.deviceId, input.userId, input.groupId]);
  return createHmac("sha256", token).update(message).digest("hex");
}
