import * as SecureStore from 'expo-secure-store';
import type { AppLockAttempts } from './app-lock-policy';

export const APP_LOCK_STORAGE_KEY = 'home-ledger.app-lock';

export type AppLockSettings = AppLockAttempts & {
  version: 1;
  enabled: boolean;
  pin: string | null;
};

export const defaultAppLockSettings: AppLockSettings = {
  version: 1,
  enabled: false,
  pin: null,
  failedAttempts: 0,
  lockoutUntil: 0,
};

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function isValidSettings(value: unknown): value is AppLockSettings {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AppLockSettings>;
  return record.version === 1
    && typeof record.enabled === 'boolean'
    && (record.pin === null || (typeof record.pin === 'string' && /^\d{4}$/.test(record.pin)))
    && Number.isInteger(record.failedAttempts)
    && typeof record.failedAttempts === 'number'
    && record.failedAttempts >= 0
    && typeof record.lockoutUntil === 'number'
    && Number.isFinite(record.lockoutUntil)
    && record.lockoutUntil >= 0;
}

export async function loadAppLockSettings(): Promise<AppLockSettings> {
  const raw = await SecureStore.getItemAsync(APP_LOCK_STORAGE_KEY, options);
  if (raw === null) return { ...defaultAppLockSettings };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Saved app-lock settings are damaged. Retry storage access; do not continue unlocked.');
  }
  if (!isValidSettings(parsed)) {
    throw new Error('Saved app-lock settings are invalid. Retry storage access; do not continue unlocked.');
  }
  return parsed;
}

export async function saveAppLockSettings(settings: AppLockSettings): Promise<void> {
  if (!isValidSettings(settings)) throw new Error('App-lock settings are invalid.');
  const serialized = JSON.stringify(settings);
  await SecureStore.setItemAsync(APP_LOCK_STORAGE_KEY, serialized, options);
  if (await SecureStore.getItemAsync(APP_LOCK_STORAGE_KEY, options) !== serialized) {
    throw new Error('App-lock settings could not be verified in secure storage.');
  }
}

