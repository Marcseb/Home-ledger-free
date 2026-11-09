import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHouseholdStorage, HOUSEHOLD_CACHE_KEYS as KEYS, REPLACEMENT_JOURNAL, HouseholdStorageError } from './household-storage.ts';
import { createSessionStorage, SECURE_SESSION_KEY, RECOVERY_SESSION_KEY, LEGACY_SESSION_KEY } from './session-storage.ts';
import { createSerialQueue, preservePendingForReplacement } from './storage-queue.ts';

const oldSession = JSON.stringify({ token: 'synthetic-old-household', deviceId: 'old-device' });
const nextSession = JSON.stringify({ token: 'synthetic-new-household', deviceId: 'new-device' });
const oldValues = ['{"household":"old"}', '[{"operationId":"pending-old-household"}]', '7'];
const nextValues = ['{"household":"new"}', '[]', '1'];
function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
    async removeItem(key) { data.delete(key); },
  };
}
function fixture() {
  const cache = store({ ...Object.fromEntries(KEYS.map((key, index) => [key, oldValues[index]])), 'home-ledger.quarantined-outbox': 'saved-quarantine' });
  const secure = store({ [SECURE_SESSION_KEY]: oldSession });
  const sessions = createSessionStorage(cache, secure);
  const household = createHouseholdStorage(cache, sessions);
  return { cache, secure, sessions, household };
}
async function restart(cache, secure) {
  const sessions = createSessionStorage(cache, secure);
  // Exactly the provider's startup order: recovery finishes before reading any
  // credentials/cache; if recovery rejects, there is no session to sync with.
  await createHouseholdStorage(cache, sessions).recover();
  return { session: await sessions.load(), values: await Promise.all(KEYS.map((key) => cache.getItem(key))) };
}

for (const [index, failedKey] of KEYS.entries()) {
  test(`replacement ${failedKey} write failure after secure save rolls back credentials, cache and pending entries`, async () => {
    const { cache, secure, household } = fixture();
    const set = cache.setItem;
    cache.setItem = async (key, value) => {
      if (key === failedKey && value === nextValues[index]) {
        assert.equal(secure.data.get(SECURE_SESSION_KEY), nextSession);
        throw new Error('injected cache write failure');
      }
      await set(key, value);
    };
    await assert.rejects(household.commit(nextSession, nextValues, () => true), (error) => error instanceof HouseholdStorageError && !error.recoveryRequired);
    assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
    assert.equal(cache.data.has(LEGACY_SESSION_KEY), false);
    assert.equal(cache.data.has(REPLACEMENT_JOURNAL), false);
    assert.equal(cache.data.get('home-ledger.quarantined-outbox'), 'saved-quarantine');
  });

  test(`persistent ${failedKey} failure blocks startup; after retry old pending data and credentials recover`, async () => {
    const { cache, secure, household } = fixture();
    const set = cache.setItem;
    cache.setItem = async (key, value) => {
      if (key === failedKey) throw new Error('persistent cache failure');
      await set(key, value);
    };
    await assert.rejects(household.commit(nextSession, nextValues, () => true), (error) => error.recoveryRequired === true);
    assert.equal(cache.data.has(REPLACEMENT_JOURNAL), true);
    assert.equal(secure.data.has(RECOVERY_SESSION_KEY), true);
    assert.doesNotMatch(cache.data.get(REPLACEMENT_JOURNAL), /synthetic-.*household/);
    await assert.rejects(restart(cache, secure), HouseholdStorageError);
    cache.setItem = set;
    assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
    assert.equal(cache.data.has(REPLACEMENT_JOURNAL), false);
  });
}

test('completed replacement restarts with a consistent new snapshot and no old pending work', async () => {
  const { cache, secure, household } = fixture();
  assert.equal(await household.commit(nextSession, nextValues, () => true), true);
  assert.deepEqual(await restart(cache, secure), { session: nextSession, values: nextValues });
  assert.equal(cache.data.has(REPLACEMENT_JOURNAL), false);
  assert.equal(cache.data.get('home-ledger.quarantined-outbox'), 'saved-quarantine');
});

test('reauthorization clears the active queue but retains unsynced expenses for review after restart', async () => {
  const { cache, secure, household } = fixture();
  const reviewKey = 'home-ledger.quarantined-outbox';
  await cache.setItem(reviewKey, '[]');
  await preservePendingForReplacement(cache, {
    outboxKey: KEYS[1], reviewKey, operations: [{ operationId: 'memory-only-expense' }],
    quarantinedAt: 'test-time', isCurrent: () => true,
  });
  assert.equal(await household.commit(nextSession, nextValues, () => true), true);
  assert.deepEqual(await restart(cache, secure), { session: nextSession, values: nextValues });
  assert.deepEqual(JSON.parse(await cache.getItem(reviewKey)).map((entry) => entry.operation.operationId),
    ['pending-old-household', 'memory-only-expense']);
});

test('journal failure never starts replacing credentials or cache', async () => {
  const { cache, secure, household } = fixture();
  const set = cache.setItem;
  cache.setItem = async (key, value) => {
    if (key === REPLACEMENT_JOURNAL) throw new Error('journal denied');
    await set(key, value);
  };
  await assert.rejects(household.commit(nextSession, nextValues, () => true), HouseholdStorageError);
  assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
});

test('secure rollback-snapshot save failure leaves the previous household untouched', async () => {
  const { cache, secure, household } = fixture();
  const set = secure.setItem;
  secure.setItem = async (key, value) => {
    if (key === RECOVERY_SESSION_KEY) throw new Error('secure backup denied');
    await set(key, value);
  };
  await assert.rejects(household.commit(nextSession, nextValues, () => true));
  assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
  assert.equal(cache.data.has(REPLACEMENT_JOURNAL), false);
});

test('secure replacement failure rolls back the journal without losing pending operations', async () => {
  const { cache, secure, household } = fixture();
  const set = secure.setItem;
  secure.setItem = async (key, value) => {
    if (key === SECURE_SESSION_KEY && value === nextSession) throw new Error('secure replacement denied');
    await set(key, value);
  };
  await assert.rejects(household.commit(nextSession, nextValues, () => true), HouseholdStorageError);
  assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
});

test('superseded replacement mid-cache-write restores the entire previous snapshot', async () => {
  const { cache, secure, household } = fixture();
  let current = true;
  const set = cache.setItem;
  cache.setItem = async (key, value) => {
    await set(key, value);
    if (key === KEYS[1] && value === '[]') current = false;
  };
  assert.equal(await household.commit(nextSession, nextValues, () => current), false);
  assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
});

test('an interrupted process restores journaled pending data before startup loads a session', async () => {
  const { cache, secure, sessions } = fixture();
  await sessions.saveRecoverySession();
  cache.data.set(REPLACEMENT_JOURNAL, JSON.stringify({ values: oldValues }));
  secure.data.set(SECURE_SESSION_KEY, nextSession);
  cache.data.set(KEYS[0], nextValues[0]); // Killed between STATE and OUTBOX.
  assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
});

test('missing secure recovery slot blocks startup, never falls back to an unsafe mixed snapshot', async () => {
  const { cache, secure } = fixture();
  cache.data.set(REPLACEMENT_JOURNAL, JSON.stringify({ values: oldValues }));
  secure.data.set(SECURE_SESSION_KEY, nextSession);
  await assert.rejects(restart(cache, secure), HouseholdStorageError);
  assert.equal(cache.data.has(REPLACEMENT_JOURNAL), true);
});

test('first pairing failure restores the unpaired snapshot without creating plaintext access', async () => {
  const cache = store();
  const secure = store();
  const sessions = createSessionStorage(cache, secure);
  const household = createHouseholdStorage(cache, sessions);
  const set = cache.setItem;
  cache.setItem = async (key, value) => {
    if (key === KEYS[1] && value === '[]') throw new Error('outbox denied');
    await set(key, value);
  };
  await assert.rejects(household.commit(nextSession, nextValues, () => true), HouseholdStorageError);
  assert.deepEqual(await restart(cache, secure), { session: null, values: [null, null, null] });
  assert.equal(cache.data.has(LEGACY_SESSION_KEY), false);
});

test('queued recovery/sign-out cannot delete a later successful replacement', async () => {
  const { cache, secure, sessions, household } = fixture();
  const queue = createSerialQueue();
  const signout = queue(async () => {
    await household.recover();
    await sessions.clear();
    await sessions.clearRecoverySession();
    for (const key of KEYS) await cache.removeItem(key);
  });
  const pairing = queue(() => household.commit(nextSession, nextValues, () => true));
  await Promise.all([signout, pairing]);
  assert.deepEqual(await restart(cache, secure), { session: nextSession, values: nextValues });
});

test('provider uses the tested replacement transaction and recovers before startup session load', () => {
  const provider = readFileSync(new URL('./ledger-context.tsx', import.meta.url), 'utf8');
  assert.match(provider, /if \(isPairCommit\) \{\s*const committed = await householdStorage\.commit/);
  assert.match(provider, /await householdStorage\.recover\(\);\s*const savedSession = await deviceSessionStorage\.load/);
  assert.match(provider, /storageRecoveryRequired\.current \|\| previouslyRequiringPair/);
});

test('journal removal failure before deletion retains durable recovery and restores the old snapshot', async () => {
  const { cache, secure, household } = fixture();
  const remove = cache.removeItem;
  let failed = false;
  cache.removeItem = async (key) => {
    if (key === REPLACEMENT_JOURNAL && !failed) {
      failed = true;
      throw new Error('journal deletion denied');
    }
    await remove(key);
  };
  await assert.rejects(household.commit(nextSession, nextValues, () => true), HouseholdStorageError);
  assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
});

test('journal deletion followed by a failed verification read reestablishes recovery before rollback', async () => {
  const { cache, secure, household } = fixture();
  const remove = cache.removeItem;
  const get = cache.getItem;
  let failRead = false;
  let injected = false;
  cache.removeItem = async (key) => {
    await remove(key);
    if (key === REPLACEMENT_JOURNAL && !injected) { injected = true; failRead = true; }
  };
  cache.getItem = async (key) => {
    if (key === REPLACEMENT_JOURNAL && failRead) { failRead = false; throw new Error('verification read failed'); }
    return get(key);
  };
  const set = cache.setItem;
  cache.setItem = async (key, value) => {
    if (KEYS.includes(key) && oldValues.includes(value)) {
      assert.equal(cache.data.has(REPLACEMENT_JOURNAL), true, 'rollback must be durably journaled');
    }
    await set(key, value);
  };
  await assert.rejects(household.commit(nextSession, nextValues, () => true), HouseholdStorageError);
  assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
});

test('failed old-credential restoration after finalization verification failure blocks restart until recovery succeeds', async () => {
  const { cache, secure, household } = fixture();
  const remove = cache.removeItem;
  const get = cache.getItem;
  const secureSet = secure.setItem;
  let failRead = false;
  let finalizationStarted = false;
  cache.removeItem = async (key) => {
    await remove(key);
    if (key === REPLACEMENT_JOURNAL && !finalizationStarted) {
      finalizationStarted = true;
      failRead = true;
    }
  };
  cache.getItem = async (key) => {
    if (key === REPLACEMENT_JOURNAL && failRead) { failRead = false; throw new Error('read failed after deletion'); }
    return get(key);
  };
  secure.setItem = async (key, value) => {
    if (key === SECURE_SESSION_KEY && value === oldSession && finalizationStarted) throw new Error('credential rollback denied');
    await secureSet(key, value);
  };
  await assert.rejects(household.commit(nextSession, nextValues, () => true), (error) => error.recoveryRequired);
  assert.equal(cache.data.has(REPLACEMENT_JOURNAL), true);
  assert.equal(secure.data.get(SECURE_SESSION_KEY), nextSession);
  assert.deepEqual(await Promise.all(KEYS.map((key) => cache.getItem(key))), oldValues);
  // Although these raw keys temporarily differ, startup must not expose them.
  await assert.rejects(restart(cache, secure), HouseholdStorageError);
  secure.setItem = secureSet;
  assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
});

test('interrupted rollback after finalization retains a marker for a fresh process to repair', async () => {
  const { cache, secure, household } = fixture();
  const remove = cache.removeItem;
  const set = cache.setItem;
  let deleted = false;
  let interruptRollback = false;
  cache.removeItem = async (key) => {
    await remove(key);
    if (key === REPLACEMENT_JOURNAL && !deleted) {
      deleted = true;
      interruptRollback = true;
      throw new Error('process interrupted after marker deletion');
    }
  };
  cache.setItem = async (key, value) => {
    if (interruptRollback && key === KEYS[1] && value === oldValues[1]) throw new Error('process interrupted mid-rollback');
    await set(key, value);
  };
  await assert.rejects(household.commit(nextSession, nextValues, () => true), (error) => error.recoveryRequired);
  assert.equal(cache.data.has(REPLACEMENT_JOURNAL), true);
  cache.setItem = set;
  assert.deepEqual(await restart(cache, secure), { session: oldSession, values: oldValues });
});

test('failed marker reestablishment after finalization never begins unjournaled rollback', async () => {
  const { cache, secure, household } = fixture();
  const remove = cache.removeItem;
  const set = cache.setItem;
  let deleted = false;
  cache.removeItem = async (key) => {
    await remove(key);
    if (key === REPLACEMENT_JOURNAL && !deleted) {
      deleted = true;
      throw new Error('deletion completed but confirmation failed');
    }
  };
  cache.setItem = async (key, value) => {
    if (key === REPLACEMENT_JOURNAL && deleted) throw new Error('cannot recreate marker');
    await set(key, value);
  };
  await assert.rejects(household.commit(nextSession, nextValues, () => true), (error) => error.recoveryRequired);
  // Deletion was the commit boundary; recovery marker creation failed, so the
  // fully committed new snapshot is left unchanged, not partially rolled back.
  assert.equal(cache.data.has(REPLACEMENT_JOURNAL), false);
  assert.deepEqual(await restart(cache, secure), { session: nextSession, values: nextValues });
});