// Keep this module platform-independent so migration/failure tests need no device.
export const LEGACY_SESSION_KEY = 'home-ledger.session';
export const SECURE_SESSION_KEY = 'home-ledger.secure-session';
export const RECOVERY_SESSION_KEY = 'home-ledger.session-recovery';

type Store = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export class SessionStorageError extends Error {
  constructor(action: string) {
    super(`Could not ${action} saved device access. Device storage is unavailable or could not be verified. Nothing was saved to plaintext as a fallback. Retry before continuing.`);
    this.name = 'SessionStorageError';
  }
}

// All callers use the ledger's serial storage queue. The generation check also
// runs after native awaits, so superseded work cannot delete the legacy copy.
export function createSessionStorage(legacy: Store, secure: Store | null) {
  async function save(value: string, isCurrent: () => boolean = () => true): Promise<boolean> {
    if (!isCurrent()) return false;
    if (!secure) {
      await legacy.setItem(LEGACY_SESSION_KEY, value);
      return isCurrent();
    }
    let previousCredential: string | null = null;
    let writeCompleted = false;
    try {
      const previousValue = await secure.getItem(SECURE_SESSION_KEY);
      const previousLegacyValue = await legacy.getItem(LEGACY_SESSION_KEY);
      previousCredential = previousValue ?? previousLegacyValue;
      if (!isCurrent()) return false;
      const undoSupersededWrite = async (legacyRemoved = false) => {
        // If superseded during legacy deletion, preserve that old credential
        // securely instead of recreating a plaintext copy or losing access.
        const restored = previousValue ?? (legacyRemoved ? previousLegacyValue : null);
        if (restored === null) await secure.removeItem(SECURE_SESSION_KEY);
        else await secure.setItem(SECURE_SESSION_KEY, restored);
        if (await secure.getItem(SECURE_SESSION_KEY) !== restored) throw new Error('Rollback verification failed');
        return false;
      };
      await secure.setItem(SECURE_SESSION_KEY, value);
      writeCompleted = true;
      if (!isCurrent()) return await undoSupersededWrite();
      if (await secure.getItem(SECURE_SESSION_KEY) !== value) throw new Error('Verification failed');
      if (!isCurrent()) return await undoSupersededWrite();
      await legacy.removeItem(LEGACY_SESSION_KEY);
      return isCurrent() ? true : await undoSupersededWrite(true);
    } catch {
      // A replacement that fails verification/legacy cleanup must not leave a
      // new household token beside the previous household's cache and outbox.
      if (writeCompleted && previousCredential !== value) {
        try {
          if (previousCredential === null) await secure.removeItem(SECURE_SESSION_KEY);
          else await secure.setItem(SECURE_SESSION_KEY, previousCredential);
          if (await secure.getItem(SECURE_SESSION_KEY) !== previousCredential) throw new Error('Rollback verification failed');
        } catch {
          // Still fail explicitly; never write a plaintext recovery copy.
          throw new SessionStorageError('save or restore previous');
        }
      }
      throw new SessionStorageError('securely save');
    }
  }

  return {
    save,
    async saveRecoverySession(): Promise<void> {
      // The rollback credential must never appear in the plaintext journal.
      const session = await this.load();
      const target = secure ?? legacy;
      const value = JSON.stringify({ session });
      try {
        await target.setItem(RECOVERY_SESSION_KEY, value);
        if (await target.getItem(RECOVERY_SESSION_KEY) !== value) throw new Error('Verification failed');
      } catch {
        throw new SessionStorageError('save recovery for');
      }
    },
    async restoreRecoverySession(): Promise<void> {
      try {
        const value = await (secure ?? legacy).getItem(RECOVERY_SESSION_KEY);
        if (value === null) throw new Error('Missing recovery credential');
        const backup = JSON.parse(value) as { session: string | null };
        if (backup.session === null) await this.clear();
        else if (typeof backup.session === 'string') await save(backup.session);
        else throw new Error('Invalid recovery credential');
      } catch {
        throw new SessionStorageError('restore recovery for');
      }
    },
    async clearRecoverySession(): Promise<void> {
      try {
        const target = secure ?? legacy;
        await target.removeItem(RECOVERY_SESSION_KEY);
        if (await target.getItem(RECOVERY_SESSION_KEY) !== null) throw new Error('Verification failed');
      } catch {
        throw new SessionStorageError('remove recovery for');
      }
    },
    async load(isCurrent: () => boolean = () => true): Promise<string | null> {
      if (!secure) return legacy.getItem(LEGACY_SESSION_KEY);
      try {
        const protectedValue = await secure.getItem(SECURE_SESSION_KEY);
        if (!isCurrent()) return null;
        if (protectedValue !== null) {
          // Also retry cleanup if a previous migration was interrupted.
          await legacy.removeItem(LEGACY_SESSION_KEY);
          return isCurrent() ? protectedValue : null;
        }
        const oldValue = await legacy.getItem(LEGACY_SESSION_KEY);
        if (oldValue === null || !isCurrent()) return null;
        return await save(oldValue, isCurrent) ? oldValue : null;
      } catch (error) {
        if (error instanceof SessionStorageError) throw error;
        throw new SessionStorageError('read');
      }
    },
    async clear(): Promise<void> {
      try {
        // Remove the legacy copy first: if secure deletion fails, there is still
        // one authoritative credential, not a plaintext token to resurrect.
        await legacy.removeItem(LEGACY_SESSION_KEY);
        if (secure) {
          await secure.removeItem(SECURE_SESSION_KEY);
          if (await secure.getItem(SECURE_SESSION_KEY) !== null) throw new Error('Verification failed');
        }
      } catch {
        throw new SessionStorageError('remove');
      }
    },
  };
}