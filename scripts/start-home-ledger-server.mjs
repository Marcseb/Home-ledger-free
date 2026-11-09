import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32") process.umask(0o077);
const args = process.argv.slice(2);
const inviteMaster = args.includes("--invite-master");
const invalidArgs = args.some((argument) => argument !== "--invite-master");
if (invalidArgs) {
  console.error("Usage: node scripts/start-home-ledger-server.mjs [--invite-master]");
  process.exit(2);
}

const env = {
  ...process.env,
  APP_VARIANT: process.env["APP_VARIANT"] || "production",
  NODE_ENV: process.env["NODE_ENV"] || "production",
  HOST: process.env["HOST"] || "0.0.0.0",
  BACKUP_INTERVAL_HOURS: process.env["BACKUP_INTERVAL_HOURS"] || "24",
  BACKUP_RETENTION_DAYS: process.env["BACKUP_RETENTION_DAYS"] || "30",
  PAIRING_CODE_TTL_MINUTES: process.env["PAIRING_CODE_TTL_MINUTES"] || "10",
  SESSION_TTL_DAYS: process.env["SESSION_TTL_DAYS"] || "30",
};
if (!process.env["PORT"]) env["PORT"] = "5000";
if (env["APP_VARIANT"] !== "production") {
  console.error("The Free server requires APP_VARIANT=production.");
  process.exit(2);
}

const apiEntry = resolve(root, "artifacts/api-server/dist/index.mjs");
if (!inviteMaster || !existsSync(apiEntry)) {
  console.log("Building the Home Ledger Free server...");
  const build = spawnSync(
    "pnpm",
    ["--filter", "@workspace/api-server", "run", "build"],
    { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (build.error) {
    console.error(`Could not start the server build: ${build.error.message}`);
    process.exit(1);
  }
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const childArgs = ["--enable-source-maps", apiEntry];
if (inviteMaster) childArgs.push("--invite-master");
console.log(`Starting Home Ledger Free on port ${env["PORT"]}...`);
const server = spawn(process.execPath, childArgs, {
  cwd: root,
  env,
  stdio: "inherit",
});
server.on("error", (error) => {
  console.error(`Could not start the Home Ledger API: ${error.message}`);
  process.exitCode = 1;
});
server.on("exit", (code, signal) => {
  if (signal) console.log(`Home Ledger server stopped (${signal}).`);
  process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (server.exitCode === null) server.kill(signal);
  });
}
