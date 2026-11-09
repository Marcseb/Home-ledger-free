import { homedir } from "node:os";
import { posix, win32 } from "node:path";

type PathApi = typeof posix;
type Platform = NodeJS.Platform;

function getPathApi(platform: Platform): PathApi {
  return platform === "win32" ? win32 : posix;
}

function optionalAbsolutePath(rawValue: string | undefined, variableName: string, paths: PathApi) {
  const value = rawValue?.trim();
  if (!value) return undefined;
  if (!paths.isAbsolute(value)) throw new Error(`${variableName} must be an absolute path`);
  return paths.resolve(value);
}

function homePath(env: NodeJS.ProcessEnv, platform: Platform, paths: PathApi, fallbackHome: string) {
  const windowsHome = env["USERPROFILE"]?.trim()
    || (env["HOMEDRIVE"] && env["HOMEPATH"] ? `${env["HOMEDRIVE"]}${env["HOMEPATH"]}` : undefined);
  const candidate = platform === "win32"
    ? windowsHome || env["HOME"]?.trim() || fallbackHome
    : env["HOME"]?.trim() || fallbackHome;
  if (!candidate || !paths.isAbsolute(candidate)) {
    throw new Error(platform === "win32"
      ? "USERPROFILE must be set to an absolute path"
      : "HOME must be set to an absolute path");
  }
  return paths.resolve(candidate);
}

function getApplicationDataHome(
  env: NodeJS.ProcessEnv,
  platform: Platform,
  paths: PathApi,
  home: string,
  variableName: "XDG_DATA_HOME" | "XDG_CONFIG_HOME",
) {
  const override = optionalAbsolutePath(env[variableName], variableName, paths);
  if (override) return override;
  if (platform === "win32") {
    const localAppData = optionalAbsolutePath(env["LOCALAPPDATA"], "LOCALAPPDATA", paths)
      ?? paths.join(home, "AppData", "Local");
    return paths.join(localAppData, "Home Ledger");
  }
  if (platform === "darwin") return paths.join(home, "Library", "Application Support", "Home Ledger");
  return paths.join(home, variableName === "XDG_DATA_HOME" ? ".local/share" : ".config");
}

function isSameOrChildPath(parent: string, candidate: string, paths: PathApi) {
  const relative = paths.relative(parent, candidate);
  return relative !== "" && (relative !== ".."
    && !relative.startsWith(`..${paths.sep}`)
    && !paths.isAbsolute(relative));
}

export function resolveDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: Platform = process.platform,
  fallbackHome = homedir(),
) {
  const paths = getPathApi(platform);
  const runtime = env["NODE_ENV"]?.trim();
  const acceleratedTestEnabled = env["APP_VARIANT"] === "accelerated-test";
  if (runtime && !["development", "test", "production"].includes(runtime)) {
    throw new Error(`Unsupported NODE_ENV value: "${runtime}"`);
  }
  const home = homePath(env, platform, paths, fallbackHome);
  const dataHome = getApplicationDataHome(env, platform, paths, home, "XDG_DATA_HOME");
  const dataDirectoryName = env["XDG_DATA_HOME"]?.trim()
    ? acceleratedTestEnabled ? "home-ledger-accelerated-test" : "home-ledger"
    : platform === "win32"
    ? acceleratedTestEnabled ? "accelerated-test" : ""
    : platform === "darwin"
      ? acceleratedTestEnabled ? "home-ledger-accelerated-test" : ""
      : acceleratedTestEnabled ? "home-ledger-accelerated-test" : "home-ledger";
  const defaultDataDirectory = dataDirectoryName
    ? paths.join(dataHome, dataDirectoryName)
    : dataHome;
  const defaultDataPath = runtime === "development"
    ? paths.resolve("./data/local-budget.sqlite")
    : runtime === "test"
      ? paths.resolve("./data/test-budget.sqlite")
      : paths.join(defaultDataDirectory, "home-ledger.sqlite");
  const explicitDataPath = optionalAbsolutePath(env["BUDGET_DB_PATH"], "BUDGET_DB_PATH", paths);
  const dataPath = explicitDataPath ?? defaultDataPath;
  if (acceleratedTestEnabled && runtime === "production" && explicitDataPath
    && !isSameOrChildPath(defaultDataDirectory, explicitDataPath, paths)) {
    throw new Error("Accelerated-test production mode requires BUDGET_DB_PATH under the accelerated-test data directory");
  }
  return dataPath;
}

export function resolveRecoveryKeyringPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: Platform = process.platform,
  fallbackHome = homedir(),
) {
  const paths = getPathApi(platform);
  const home = homePath(env, platform, paths, fallbackHome);
  const configHome = getApplicationDataHome(env, platform, paths, home, "XDG_CONFIG_HOME");
  const runtime = env["NODE_ENV"]?.trim();
  const variant = env["APP_VARIANT"] === "accelerated-test"
    ? "home-ledger-accelerated-test"
    : runtime === "development"
      ? "home-ledger-development"
      : runtime === "test"
        ? "home-ledger-test"
        : "home-ledger";
  return paths.join(configHome, variant, "recovery-keyring.json");
}