import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

const artifactDir = new URL("..", import.meta.url);

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Could not allocate a test port");
  return port;
}

async function waitForServer(base, child, output) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before startup (${child.exitCode})\n${output()}`);
    }
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // The child has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for server\n${output()}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function runCase({ name, nodeEnv, allowDemoReset, expectedStatus, assertLogs, establishHousehold = false }) {
  const directory = await mkdtemp(join(tmpdir(), "home-ledger-demo-reset-"));
  const port = await availablePort();
  let logs = "";
  const environment = {
    ...process.env,
    NODE_ENV: nodeEnv,
    ALLOW_DEMO_RESET: allowDemoReset,
    PORT: String(port),
    HOST: "127.0.0.1",
    HOME: directory,
    XDG_DATA_HOME: directory,
    BUDGET_DB_PATH: join(directory, "ledger.sqlite"),
    LOG_LEVEL: "info",
  };
  let child = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
    cwd: artifactDir,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  try {
    const base = `http://127.0.0.1:${port}/api`;
    await waitForServer(base, child, () => logs);
    if (establishHousehold) {
      const setup = await fetch(`${base}/household/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdName: "Established household",
          displayName: "Owner",
          currency: "EUR",
          deviceId: "setup-device",
          deviceName: "Setup device",
        }),
      });
      if (setup.status !== 201) throw new Error(`Could not establish household (${setup.status})`);
      await stop(child);
      logs = "";
      child = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
        cwd: artifactDir,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => { logs += chunk; });
      child.stderr.on("data", (chunk) => { logs += chunk; });
      await waitForServer(base, child, () => logs);
    }
    const response = await fetch(`${base}/demo/reset`, { method: "POST" });
    if (response.status !== expectedStatus) {
      throw new Error(`${name}: expected ${expectedStatus}, received ${response.status}`);
    }
    assertLogs?.(logs);
  } finally {
    await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
}

await runCase({
  name: "development default",
  nodeEnv: "development",
  allowDemoReset: "",
  expectedStatus: 404,
  assertLogs(logs) {
    if (logs.includes("[Home Ledger] Pairing code:")) throw new Error("Fresh uninitialized startup printed a pairing code");
  },
});
await runCase({
  name: "explicit development demo mode",
  nodeEnv: "development",
  allowDemoReset: "true",
  expectedStatus: 200,
});
await runCase({
  name: "production cannot enable demo reset",
  nodeEnv: "production",
  allowDemoReset: "true",
  expectedStatus: 404,
  assertLogs(logs) {
    if (logs.includes("[Home Ledger] Pairing code:")) {
      throw new Error("Fresh production startup printed a pairing code");
    }
  },
});
await runCase({
  name: "established household startup",
  nodeEnv: "production",
  allowDemoReset: "",
  expectedStatus: 404,
  establishHousehold: true,
  assertLogs(logs) {
    if (!logs.includes("[Home Ledger] Pairing code:")) throw new Error("Established startup did not print the pairing code");
  },
});

console.log("Demo reset security checks passed");