import assert from "node:assert/strict";
import { resolveDatabasePath, resolveRecoveryKeyringPath } from "../src/lib/database-path.ts";

const linux = { NODE_ENV: "production", HOME: "/home/example" };
assert.equal(resolveDatabasePath(linux, "linux"), "/home/example/.local/share/home-ledger/home-ledger.sqlite");
assert.equal(resolveRecoveryKeyringPath(linux, "linux"), "/home/example/.config/home-ledger/recovery-keyring.json");
assert.equal(resolveDatabasePath({ ...linux, XDG_DATA_HOME: "/data" }, "linux"), "/data/home-ledger/home-ledger.sqlite");
assert.equal(resolveDatabasePath({ ...linux, BUDGET_DB_PATH: "/custom/normal-copy.sqlite" }, "linux"), "/custom/normal-copy.sqlite");
const mac = { NODE_ENV: "production", HOME: "/Users/example" };
assert.equal(resolveDatabasePath(mac, "darwin"), "/Users/example/Library/Application Support/Home Ledger/home-ledger.sqlite");
assert.equal(resolveRecoveryKeyringPath(mac, "darwin"), "/Users/example/Library/Application Support/Home Ledger/home-ledger/recovery-keyring.json");
const windows = { NODE_ENV: "production", USERPROFILE: "C:\\Users\\Example", LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" };
assert.equal(resolveDatabasePath(windows, "win32"), "C:\\Users\\Example\\AppData\\Local\\Home Ledger\\home-ledger.sqlite");
assert.equal(resolveRecoveryKeyringPath(windows, "win32"), "C:\\Users\\Example\\AppData\\Local\\Home Ledger\\home-ledger\\recovery-keyring.json");
assert.equal(resolveDatabasePath({ ...windows, LOCALAPPDATA: "" }, "win32"), resolveDatabasePath(windows, "win32"));
assert.equal(resolveDatabasePath({ ...windows, XDG_DATA_HOME: "D:\\data" }, "win32"), "D:\\data\\home-ledger\\home-ledger.sqlite");
assert.equal(resolveDatabasePath({ ...windows, BUDGET_DB_PATH: "D:\\Household\\ledger.sqlite" }, "win32"), "D:\\Household\\ledger.sqlite");
for (const [env, platform] of [[linux, "linux"], [mac, "darwin"], [windows, "win32"]]) {
  assert.notEqual(resolveDatabasePath(env, platform), resolveDatabasePath({ ...env, APP_VARIANT: "accelerated-test" }, platform));
  assert.notEqual(resolveRecoveryKeyringPath(env, platform), resolveRecoveryKeyringPath({ ...env, APP_VARIANT: "accelerated-test" }, platform));
  assert.throws(() => resolveDatabasePath({ ...env, BUDGET_DB_PATH: "relative.sqlite" }, platform), /absolute/);
  assert.throws(() => resolveDatabasePath({ ...env, APP_VARIANT: "accelerated-test", BUDGET_DB_PATH: resolveDatabasePath(env, platform) }, platform), /accelerated-test/);
  const acceleratedPath = resolveDatabasePath({ ...env, APP_VARIANT: "accelerated-test" }, platform);
  assert.equal(resolveDatabasePath({ ...env, APP_VARIANT: "accelerated-test", BUDGET_DB_PATH: acceleratedPath }, platform), acceleratedPath);
}
console.log("Platform path checks passed: Linux paths preserved; Windows/macOS defaults and variant isolation verified.");
