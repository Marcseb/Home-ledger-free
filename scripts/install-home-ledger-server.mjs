import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin, stdout } from "node:process";
import readline from "node:readline/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedPlatform = process.argv[2];
const checkOnly = process.argv.includes("--check-only");
const platformByNode = { win32: "windows", darwin: "macos", linux: "linux" };
const actualPlatform = platformByNode[process.platform];

if (!["windows", "macos", "linux"].includes(expectedPlatform) || expectedPlatform !== actualPlatform) {
  console.error(`Run the ${expectedPlatform || "platform-specific"} installer on its matching operating system.`);
  process.exit(2);
}

for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "artifacts/api-server", "scripts"]) {
  if (!existsSync(resolve(root, file))) {
    console.error(`This does not look like the extracted Home Ledger server project: missing ${file}`);
    process.exit(2);
  }
}

const shortcutCreator = expectedPlatform === "windows"
  ? "scripts/create-home-ledger-shortcut-windows.ps1"
  : `scripts/create-home-ledger-shortcut-${expectedPlatform}.sh`;
if (!existsSync(resolve(root, shortcutCreator))) {
  console.error(`The desktop shortcut creator is missing: ${shortcutCreator}`);
  process.exit(2);
}

const minimumNode = [24, 16, 0];
const currentNode = process.versions.node.split(".").map(Number);
const compareVersions = (left, right) => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

if (compareVersions(currentNode, minimumNode) < 0) {
  console.error(`Home Ledger requires Node.js 24.16.0 or newer (Node 24 LTS recommended). Found ${process.version}.`);
  console.error("Install or update Node.js from the official page: https://nodejs.org/en/download");
  console.error("This setup script will not install or update Node.js for you.");
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageManager = packageJson.packageManager ?? "";
const pinnedPnpm = packageManager.match(/^pnpm@(\d+\.\d+\.\d+)$/)?.[1];
if (!pinnedPnpm) {
  console.error("Could not read the pinned pnpm version from package.json.");
  process.exit(1);
}

let childPath = process.env.PATH ?? "";
const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, PATH: childPath },
  stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
});

const runPnpm = (args, options = {}) => process.platform === "win32"
  ? run("cmd.exe", ["/d", "/s", "/c", `pnpm ${args.join(" ")}`], options)
  : run("pnpm", args, options);
const runNpm = (args) => process.platform === "win32"
  ? run("cmd.exe", ["/d", "/s", "/c", `npm ${args.map((argument) => `"${argument}"`).join(" ")}`])
  : run("npm", args);

const localPnpmRoot = resolve(root, ".tools/pnpm");
const localPnpmBin = resolve(localPnpmRoot, "node_modules/.bin");
if (existsSync(localPnpmBin)) childPath = `${localPnpmBin}${delimiter}${childPath}`;
let pnpmCheck = runPnpm(["--version"], { capture: true });
let installedPnpm = pnpmCheck.status === 0 ? pnpmCheck.stdout.trim() : "";
if (installedPnpm !== pinnedPnpm) {
  const issue = installedPnpm
    ? `Found pnpm ${installedPnpm}; this server requires ${pinnedPnpm}.`
    : `pnpm ${pinnedPnpm} is not available on this computer.`;
  if (checkOnly) {
    console.error(issue);
    console.error("No dependency was downloaded. Rerun without --check-only to choose whether to set up pnpm locally.");
    process.exit(1);
  }
  if (!stdin.isTTY) {
    console.error(issue);
    console.error("Run this setup in a terminal to approve a local pnpm download.");
    process.exit(1);
  }
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  let answer;
  try {
    answer = await prompt.question(
      `${issue}\nDownload pnpm ${pinnedPnpm} into this server folder only? [y/N] `,
    );
  } finally {
    prompt.close();
  }
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.error(`Setup cancelled. You can install pnpm ${pinnedPnpm} yourself, then rerun this installer.`);
    process.exit(1);
  }
  const npm = runNpm([
    "install",
    "--prefix",
    localPnpmRoot,
    "--no-save",
    "--no-audit",
    "--no-fund",
    `pnpm@${pinnedPnpm}`,
  ]);
  if (npm.error || npm.status !== 0) {
    console.error("Could not install pnpm locally. No global package-manager settings were changed.");
    console.error("Install Node.js with npm from https://nodejs.org/en/download, then retry.");
    process.exit(npm.status ?? 1);
  }
  childPath = `${localPnpmBin}${delimiter}${childPath}`;
  pnpmCheck = runPnpm(["--version"], { capture: true });
  installedPnpm = pnpmCheck.status === 0 ? pnpmCheck.stdout.trim() : "";
  if (installedPnpm !== pinnedPnpm) {
    console.error(`The local pnpm check failed. Expected ${pinnedPnpm}, found ${installedPnpm || "no version"}.`);
    process.exit(1);
  }
}

if (checkOnly) {
  console.log(`Prerequisite check passed: Node.js ${process.version}, pnpm ${installedPnpm}, ${expectedPlatform}.`);
  console.log("No dependencies were installed and no desktop shortcut or household data was changed.");
  process.exit(0);
}

console.log("Installing Home Ledger server dependencies. This step needs an internet connection.");
const install = runPnpm(["install", "--frozen-lockfile"]);
if (install.error) {
  console.error(`Could not start pnpm: ${install.error.message}`);
  process.exit(1);
}
if (install.status !== 0) process.exit(install.status ?? 1);

console.log("Building the server so the desktop shortcut starts the installed release.");
const build = runPnpm(["--filter", "@workspace/api-server", "run", "build"]);
if (build.error) {
  console.error(`Could not start the server build: ${build.error.message}`);
  process.exit(1);
}
if (build.status !== 0) process.exit(build.status ?? 1);

let shortcutCommand;
let shortcutArgs;
if (expectedPlatform === "windows") {
  shortcutCommand = "powershell.exe";
  shortcutArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    resolve(root, "scripts/create-home-ledger-shortcut-windows.ps1"),
  ];
} else {
  shortcutCommand = "bash";
  shortcutArgs = [resolve(root, `scripts/create-home-ledger-shortcut-${expectedPlatform}.sh`)];
}

const shortcut = spawnSync(shortcutCommand, shortcutArgs, { cwd: root, stdio: "inherit" });
if (shortcut.error) {
  console.error(`Could not create the desktop shortcut: ${shortcut.error.message}`);
  process.exit(1);
}
if (shortcut.status !== 0) process.exit(shortcut.status ?? 1);

console.log("\nInstallation is ready. The server has not been started and no household database was changed.");
console.log("Open the new Home Ledger Server desktop shortcut when you are ready to start it.");
