export const REPLACEMENT_JOURNAL = 'home-ledger.replacement-journal';
export const HOUSEHOLD_CACHE_KEYS = ['home-ledger.state', 'home-ledger.outbox', 'home-ledger.cursor'] as const;

type CacheStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};
type SessionStore = {
  save: (value: string, isCurrent?: () => boolean) => Promise<boolean>;
  saveRecoverySession: () => Promise<void>;
  restoreRecoverySession: () => Promise<void>;
};
type Snapshot = { values: (string | null)[] };

export class HouseholdStorageError extends Error {
  readonly recoveryRequired: boolean;
  constructor(recoveryRequired: boolean) {
    super(recoveryRequired
      ? 'Device storage could not finish restoring the previous household. Saved pending changes are protected in a recovery journal. Retry or restart the app before continuing.'
      : 'Could not save household access and data together. The previous saved household and pending changes have been restored. Please retry.');
    this.name = 'HouseholdStorageError';
    this.recoveryRequired = recoveryRequired;
  }
}

// Called only inside the ledger's serial queue. A durable rollback journal
// contains cache data only; its corresponding credential is stored securely.
export function createHouseholdStorage(cache: CacheStore, sessions: SessionStore) {
  async function restore(snapshot: Snapshot) {
    if (!Array.isArray(snapshot.values) || snapshot.values.length !== HOUSEHOLD_CACHE_KEYS.length
      || snapshot.values.some((value) => value !== null && typeof value !== 'string')) {
      throw new Error('Invalid household recovery journal');
    }
    for (const [index, key] of HOUSEHOLD_CACHE_KEYS.entries()) {
      const value = snapshot.values[index];
      if (value === null) await cache.removeItem(key);
      else await cache.setItem(key, value);
      if (await cache.getItem(key) !== value) throw new Error('Cache recovery verification failed');
    }
    await sessions.restoreRecoverySession();
    await cache.removeItem(REPLACEMENT_JOURNAL);
    if (await cache.getItem(REPLACEMENT_JOURNAL) !== null) throw new Error('Journal removal verification failed');
    // Keep one bounded secure rollback slot until the next replacement or
    // sign-out. Removing it before the journal would make crash recovery unsafe.
  }

  return {
    async recover() {
      try {
        const journal = await cache.getItem(REPLACEMENT_JOURNAL);
        if (journal !== null) await restore(JSON.parse(journal) as Snapshot);
      } catch {
        throw new HouseholdStorageError(true);
      }
    },
    async commit(session: string, values: string[], isCurrent: () => boolean): Promise<boolean> {
      await this.recover();
      if (!isCurrent()) return false;
      const snapshot: Snapshot = { values: await Promise.all(HOUSEHOLD_CACHE_KEYS.map((key) => cache.getItem(key))) };
      await sessions.saveRecoverySession();
      if (!isCurrent()) return false;
      const journal = JSON.stringify(snapshot);
      try {
        // Journal is verified before the first credential/cache replacement.
        await cache.setItem(REPLACEMENT_JOURNAL, journal);
        if (await cache.getItem(REPLACEMENT_JOURNAL) !== journal) throw new Error('Journal verification failed');
        if (!isCurrent() || !await sessions.save(session, isCurrent)) throw new Error('Superseded household commit');
        for (const [index, key] of HOUSEHOLD_CACHE_KEYS.entries()) {
          if (!isCurrent()) throw new Error('Superseded household commit');
          await cache.setItem(key, values[index]);
          if (await cache.getItem(key) !== values[index]) throw new Error('Cache commit verification failed');
        }
        if (!isCurrent()) throw new Error('Superseded household commit');
        await cache.removeItem(REPLACEMENT_JOURNAL);
        if (await cache.getItem(REPLACEMENT_JOURNAL) !== null) throw new Error('Journal removal verification failed');
        return isCurrent();
      } catch {
        try {
          // Finalization may already have deleted the marker before its
          // verification read failed. Never begin rollback mutations until a
          // durable, verified recovery marker exists again. If this fails,
          // leave the disk untouched: it is either journaled or fully committed.
          await cache.setItem(REPLACEMENT_JOURNAL, journal);
          if (await cache.getItem(REPLACEMENT_JOURNAL) !== journal) throw new Error('Recovery journal verification failed');
          await restore(snapshot);
        }
        catch { throw new HouseholdStorageError(true); }
        if (!isCurrent()) return false;
        throw new HouseholdStorageError(false);
      }
    },
  };
}