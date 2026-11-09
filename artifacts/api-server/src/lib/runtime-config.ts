export function isDemoResetEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env["NODE_ENV"] === "development" && env["ALLOW_DEMO_RESET"] === "true";
}

export function isAcceleratedTestEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env["APP_VARIANT"] === "accelerated-test";
}
