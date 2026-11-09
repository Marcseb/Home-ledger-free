import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSessionStorage, LEGACY_SESSION_KEY as OLD, SECURE_SESSION_KEY as KEY, SessionStorageError } from './session-storage.ts';
import { canPersistGeneration, createSerialQueue } from './storage-queue.ts';

const oldSession = JSON.stringify({ token: 'synthetic-old', user: { id: 'test-user' }, deviceId: 'test-device', serverAddress: 'http://test.invalid' });
const newSession = oldSession.replace('synthetic-old', 'synthetic-new');
function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  const events = [];
  return {
    data, events,
    async getItem(key) { events.push(['get', key]); return data.get(key) ?? null; },
    async setItem(key, value) { events.push(['set', key]); data.set(key, value); },
    async removeItem(key) { events.push(['remove', key]); data.delete(key); },
  };
}
function fixture(old = oldSession, protectedValue = null) {
  const legacy = store({ ...(old ? { [OLD]: old } : {}), 'home-ledger.state': 'cache', 'home-ledger.outbox': 'pending', 'home-ledger.quarantined-outbox': 'quarantine' });
  const secure = store(protectedValue ? { [KEY]: protectedValue } : {});
  return { legacy, secure, storage: createSessionStorage(legacy, secure) };
}

test('native migration verifies secure write before deleting legacy; caches stay intact', async () => {
  const { legacy, secure, storage } = fixture();
  legacy.removeItem = async (key) => {
    assert.equal(secure.data.get(KEY), oldSession);
    assert.deepEqual(secure.events.slice(-1), [['get', KEY]]);
    legacy.data.delete(key);
  };
  assert.equal(await storage.load(), oldSession);
  assert.equal(legacy.data.has(OLD), false);
  assert.equal(legacy.data.get('home-ledger.outbox'), 'pending');
  assert.equal(legacy.data.get('home-ledger.quarantined-outbox'), 'quarantine');
  assert.equal(legacy.data.get('home-ledger.state'), 'cache');
  assert.equal(await storage.load(), oldSession);
});

test('native save never writes plaintext; secure session wins over stale legacy', async () => {
  const { legacy, secure, storage } = fixture(oldSession, newSession);
  assert.equal(await storage.load(), newSession);
  assert.equal(legacy.data.has(OLD), false);
  await storage.save(oldSession);
  assert.equal(secure.data.get(KEY), oldSession);
  assert.equal(legacy.events.some(([operation]) => operation === 'set'), false);
});

test('fresh install has no session and does not write anything', async () => {
  const { legacy, secure, storage } = fixture(null);
  assert.equal(await storage.load(), null);
  assert.equal(secure.data.size, 0);
  assert.equal(legacy.events.some(([operation]) => operation !== 'get'), false);
});

for (const failingMethod of ['getItem', 'setItem']) {
  test(`migration ${failingMethod} failure preserves legacy and rejects explicitly`, async () => {
    const { legacy, secure, storage } = fixture();
    secure[failingMethod] = async () => { throw new Error('native unavailable'); };
    await assert.rejects(storage.load(), SessionStorageError);
    assert.equal(legacy.data.get(OLD), oldSession);
    assert.equal(legacy.events.some(([operation]) => operation === 'set' || operation === 'remove'), false);
  });
}

test('failed read-back never deletes legacy; retry completes migration', async () => {
  const { legacy, secure, storage } = fixture();
  const set = secure.setItem;
  secure.setItem = async () => {}; // Simulate a write acknowledged but not saved.
  await assert.rejects(storage.load(), /could not be verified/);
  assert.equal(legacy.data.get(OLD), oldSession);
  secure.setItem = set;
  assert.equal(await storage.load(), oldSession);
  assert.equal(legacy.data.has(OLD), false);
});

test('secure read-back rejection never deletes usable legacy access', async () => {
  const { legacy, secure, storage } = fixture();
  const get = secure.getItem;
  secure.getItem = async (key) => {
    if (secure.data.has(key)) throw new Error('read failure after write');
    return get(key);
  };
  await assert.rejects(storage.load(), SessionStorageError);
  assert.equal(legacy.data.get(OLD), oldSession);
  assert.equal(secure.data.get(KEY), oldSession);
});

test('legacy cleanup failure is explicit and retried without losing secure access', async () => {
  const { legacy, secure, storage } = fixture();
  const remove = legacy.removeItem;
  legacy.removeItem = async () => { throw new Error('cleanup unavailable'); };
  await assert.rejects(storage.load(), SessionStorageError);
  assert.equal(legacy.data.get(OLD), oldSession);
  assert.equal(secure.data.get(KEY), oldSession);
  legacy.removeItem = remove;
  assert.equal(await storage.load(), oldSession);
  assert.equal(legacy.data.has(OLD), false);
});

test('secure read failure does not fall back even when a legacy token exists', async () => {
  const { legacy, secure, storage } = fixture(oldSession, newSession);
  secure.getItem = async () => { throw new Error('device locked'); };
  await assert.rejects(storage.load(), SessionStorageError);
  assert.equal(legacy.events.length, 0);
});

test('failed replacement write retains the previous session', async () => {
  const { legacy, secure, storage } = fixture(oldSession, oldSession);
  secure.setItem = async () => { throw new Error('write denied'); };
  await assert.rejects(storage.save(newSession), SessionStorageError);
  assert.equal(secure.data.get(KEY), oldSession);
  assert.equal(legacy.data.get(OLD), oldSession);
});

test('replacement cleanup failure rolls back to previous credentials without changing cache/outbox', async () => {
  const { legacy, secure, storage } = fixture(oldSession, oldSession);
  legacy.removeItem = async () => { throw new Error('cleanup denied'); };
  await assert.rejects(storage.save(newSession), SessionStorageError);
  assert.equal(secure.data.get(KEY), oldSession);
  assert.equal(legacy.data.get('home-ledger.outbox'), 'pending');
  assert.equal(legacy.data.get('home-ledger.state'), 'cache');
});

test('fresh pairing cleanup failure does not leave a new credential beside old cache', async () => {
  const { legacy, secure, storage } = fixture(null);
  legacy.removeItem = async () => { throw new Error('cleanup denied'); };
  await assert.rejects(storage.save(newSession), SessionStorageError);
  assert.equal(secure.data.has(KEY), false);
});

test('failed secure rollback is explicit and never writes a plaintext recovery token', async () => {
  const { legacy, secure, storage } = fixture(oldSession, oldSession);
  const set = secure.setItem;
  secure.setItem = async (key, value) => {
    if (value === oldSession) throw new Error('rollback denied');
    return set(key, value);
  };
  legacy.removeItem = async () => { throw new Error('cleanup denied'); };
  await assert.rejects(storage.save(newSession), /save or restore previous/);
  assert.equal(legacy.data.get(OLD), oldSession);
  assert.equal(legacy.events.some(([operation]) => operation === 'set'), false);
});

test('clear removes both copies but not cache/outbox/quarantine', async () => {
  const { legacy, secure, storage } = fixture(oldSession, oldSession);
  await storage.clear();
  assert.equal(await storage.load(), null);
  assert.equal(secure.data.has(KEY), false);
  assert.equal(legacy.data.get('home-ledger.outbox'), 'pending');
  assert.equal(legacy.data.get('home-ledger.quarantined-outbox'), 'quarantine');
});

test('failed native deletion rejects, retaining secure credential, and can be retried', async () => {
  const { legacy, secure, storage } = fixture(oldSession, oldSession);
  const remove = secure.removeItem;
  secure.removeItem = async () => { throw new Error('delete denied'); };
  await assert.rejects(storage.clear(), SessionStorageError);
  assert.equal(legacy.data.has(OLD), false);
  assert.equal(secure.data.get(KEY), oldSession);
  secure.removeItem = remove;
  await storage.clear();
  assert.equal(await storage.load(), null);
});

test('clear verifies deletion and cannot report success for a no-op native delete', async () => {
  const { secure, storage } = fixture(null, oldSession);
  secure.removeItem = async () => {};
  await assert.rejects(storage.clear(), SessionStorageError);
  assert.equal(secure.data.get(KEY), oldSession);
});

test('failed legacy deletion does not delete the authoritative secure token', async () => {
  const { legacy, secure, storage } = fixture(oldSession, newSession);
  legacy.removeItem = async () => { throw new Error('delete denied'); };
  await assert.rejects(storage.clear(), SessionStorageError);
  assert.equal(secure.data.get(KEY), newSession);
});

test('superseded native write restores previous secure session and preserves legacy', async () => {
  const { legacy, secure, storage } = fixture(oldSession, oldSession);
  let current = true;
  const set = secure.setItem;
  secure.setItem = async (key, value) => { await set(key, value); if (value === newSession) current = false; };
  assert.equal(await storage.save(newSession, () => current), false);
  assert.equal(secure.data.get(KEY), oldSession);
  assert.equal(legacy.data.get(OLD), oldSession);
});

test('superseded initial migration removes its secure write but keeps the usable legacy copy', async () => {
  const { legacy, secure, storage } = fixture();
  let current = true;
  const set = secure.setItem;
  secure.setItem = async (key, value) => { await set(key, value); current = false; };
  assert.equal(await storage.load(() => current), null);
  assert.equal(secure.data.has(KEY), false);
  assert.equal(legacy.data.get(OLD), oldSession);
});

test('stale generation does not write a replacement', async () => {
  const { legacy, secure, storage } = fixture();
  assert.equal(await storage.save(newSession, () => canPersistGeneration(1, 2, false, true)), false);
  assert.equal(secure.events.length, 0);
  assert.equal(legacy.data.get(OLD), oldSession);
});

test('supersession during legacy deletion preserves old access securely, never restores plaintext', async () => {
  const { legacy, secure, storage } = fixture();
  let current = true;
  const remove = legacy.removeItem;
  legacy.removeItem = async (key) => { await remove(key); current = false; };
  assert.equal(await storage.save(newSession, () => current), false);
  assert.equal(secure.data.get(KEY), oldSession);
  assert.equal(legacy.data.has(OLD), false);
  assert.equal(legacy.events.some(([operation]) => operation === 'set'), false);
});

test('queued expired-session cleanup preserves quarantine and cannot delete subsequent pairing', async () => {
  const { legacy, secure, storage } = fixture();
  const queue = createSerialQueue();
  let release;
  const set = secure.setItem;
  secure.setItem = async (key, value) => {
    if (value === oldSession) await new Promise((resolve) => { release = resolve; });
    return set(key, value);
  };
  const migrating = queue(() => storage.load());
  const cleanup = queue(async () => { await storage.clear(); legacy.data.delete('home-ledger.outbox'); });
  const pairing = queue(() => storage.save(newSession));
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([migrating, cleanup, pairing]);
  assert.equal(secure.data.get(KEY), newSession);
  assert.equal(legacy.data.has(OLD), false);
  assert.equal(legacy.data.get('home-ledger.quarantined-outbox'), 'quarantine');
});

test('queue recovers after storage failure so logout/re-pair is not blocked forever', async () => {
  const { secure, storage } = fixture();
  const queue = createSerialQueue();
  const set = secure.setItem;
  secure.setItem = async () => { throw new Error('write denied'); };
  await assert.rejects(queue(() => storage.load()), SessionStorageError);
  secure.setItem = set;
  await queue(() => storage.clear());
  await queue(() => storage.save(newSession));
  assert.equal(await queue(() => storage.load()), newSession);
});

test('web deliberately uses browser storage without claiming native protection', async () => {
  const legacy = store();
  const storage = createSessionStorage(legacy, null);
  assert.equal(await storage.load(), null);
  await storage.save(newSession);
  assert.equal(legacy.data.get(OLD), newSession);
  assert.equal(await storage.load(), newSession);
  await storage.clear();
  assert.equal(await storage.load(), null);
});

test('native session storage stays separate from optional biometric app lock', () => {
  const source = readFileSync(new URL('./device-session-storage.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /requireAuthentication\s*:/);
  assert.match(source, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  const secureStorePlugin = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-secure-store');
  const localAuthPlugin = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-local-authentication');
  assert.equal(secureStorePlugin[1].faceIDPermission, false);
  assert.equal(typeof localAuthPlugin[1].faceIDPermission, 'string');
});