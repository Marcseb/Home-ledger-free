import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_BACKGROUND_LOCK_DELAY_MS,
  APP_LOCK_ATTEMPTS_BEFORE_DELAY,
  APP_LOCK_INITIAL_DELAY_MS,
  APP_LOCK_MAX_DELAY_MS,
  getAppLockWaitMs,
  isValidAppPin,
  nextAppLockAttempts,
  resetAppLockAttempts,
  shouldRelockAfterBackground,
} from './app-lock-policy.ts';

test('app PIN validation accepts exactly four digits', () => {
  assert.equal(isValidAppPin('0042'), true);
  assert.equal(isValidAppPin('42'), false);
  assert.equal(isValidAppPin('12345'), false);
  assert.equal(isValidAppPin('12a4'), false);
});

test('wrong attempts are persisted and receive progressively longer delays', () => {
  const now = 1_800_000_000_000;
  let attempts = resetAppLockAttempts();
  for (let count = 1; count < APP_LOCK_ATTEMPTS_BEFORE_DELAY; count += 1) {
    attempts = nextAppLockAttempts(attempts, now);
    assert.equal(attempts.lockoutUntil, 0);
  }
  attempts = nextAppLockAttempts(attempts, now);
  assert.equal(attempts.failedAttempts, APP_LOCK_ATTEMPTS_BEFORE_DELAY);
  assert.equal(getAppLockWaitMs(attempts, now), APP_LOCK_INITIAL_DELAY_MS);
  attempts = nextAppLockAttempts(attempts, now);
  assert.equal(getAppLockWaitMs(attempts, now), APP_LOCK_INITIAL_DELAY_MS * 2);
});

test('lockout delay is capped and expires without clearing the failure history', () => {
  const now = 1_800_000_000_000;
  const attempts = nextAppLockAttempts({ failedAttempts: 100, lockoutUntil: 0 }, now);
  assert.equal(getAppLockWaitMs(attempts, now), APP_LOCK_MAX_DELAY_MS);
  assert.equal(getAppLockWaitMs(attempts, now + APP_LOCK_MAX_DELAY_MS), 0);
  assert.equal(attempts.failedAttempts, 101);
});

test('background re-lock threshold is strictly more than 30 seconds', () => {
  assert.equal(APP_BACKGROUND_LOCK_DELAY_MS, 30_000);
  assert.equal(shouldRelockAfterBackground(30_000, true, false), false);
  assert.equal(shouldRelockAfterBackground(30_001, true, false), true);
  assert.equal(shouldRelockAfterBackground(60_000, false, false), false);
  assert.equal(shouldRelockAfterBackground(60_000, true, true), false);
});
