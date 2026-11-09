export const APP_PIN_LENGTH = 4;
export const APP_LOCK_ATTEMPTS_BEFORE_DELAY = 5;
export const APP_LOCK_INITIAL_DELAY_MS = 30_000;
export const APP_LOCK_MAX_DELAY_MS = 24 * 60 * 60 * 1000;
export const APP_BACKGROUND_LOCK_DELAY_MS = 30_000;

export type AppLockAttempts = {
  failedAttempts: number;
  lockoutUntil: number;
};

export function isValidAppPin(pin: string): boolean {
  return new RegExp(`^\\d{${APP_PIN_LENGTH}}$`).test(pin);
}

export function getAppLockWaitMs(attempts: AppLockAttempts, now = Date.now()): number {
  return Math.max(0, attempts.lockoutUntil - now);
}

export function nextAppLockAttempts(attempts: AppLockAttempts, now = Date.now()): AppLockAttempts {
  const failedAttempts = Math.min(1_000, Math.max(0, attempts.failedAttempts) + 1);
  if (failedAttempts < APP_LOCK_ATTEMPTS_BEFORE_DELAY) {
    return { failedAttempts, lockoutUntil: 0 };
  }
  const exponent = failedAttempts - APP_LOCK_ATTEMPTS_BEFORE_DELAY;
  const delay = Math.min(APP_LOCK_INITIAL_DELAY_MS * (2 ** exponent), APP_LOCK_MAX_DELAY_MS);
  return { failedAttempts, lockoutUntil: now + delay };
}

export function resetAppLockAttempts(): AppLockAttempts {
  return { failedAttempts: 0, lockoutUntil: 0 };
}

export function shouldRelockAfterBackground(
  durationMs: number,
  enabled: boolean,
  alreadyLocked: boolean,
): boolean {
  return enabled && !alreadyLocked && durationMs > APP_BACKGROUND_LOCK_DELAY_MS;
}

