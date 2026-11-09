import assert from 'node:assert/strict';
import test from 'node:test';
import { appendQuarantinedOperations, canPersistGeneration, createSerialQueue, mergeUniqueOperations, preservePendingForReplacement, markReviewedOperations } from './storage-queue.ts';
import { readFileSync } from 'node:fs';

test('serial storage queue waits for an active write before quarantine cleanup', async () => {
  const enqueue = createSerialQueue();
  const events = [];
  let releaseFirst;
  const firstWrite = enqueue(async () => {
    events.push('write-start');
    await new Promise((resolve) => { releaseFirst = resolve; });
    events.push('write-finish');
  });
  const quarantine = enqueue(async () => { events.push('quarantine-delete'); });
  await Promise.resolve();
  assert.deepEqual(events, ['write-start']);
  releaseFirst();
  await Promise.all([firstWrite, quarantine]);
  assert.deepEqual(events, ['write-start', 'write-finish', 'quarantine-delete']);
});

test('generation fence rejects an old write after quarantine invalidates it', () => {
  assert.equal(canPersistGeneration(4, 5, true, false), false);
  assert.equal(canPersistGeneration(5, 5, true, false), false);
  assert.equal(canPersistGeneration(5, 5, true, true), true);
  assert.equal(canPersistGeneration(4, 5, false, true), false);
});

test('quarantine merge retains an operation visible in memory but not yet persisted', () => {
  const stored = [{ operationId: 'stored', type: 'transaction.create' }];
  const capturedBySync = [{ operationId: 'captured', type: 'transaction.create' }];
  const currentOutboxRef = [{ operationId: 'new-unpersisted', type: 'transaction.create' }];
  const merged = mergeUniqueOperations(stored, capturedBySync, currentOutboxRef);
  assert.deepEqual(merged.map(({ operationId }) => operationId), ['stored', 'captured', 'new-unpersisted']);
});

test('server-rejected operations are retained once in quarantine for review', () => {
  const existing = [{ operation: { operationId: 'old', type: 'transaction.create' }, quarantinedAt: 'old-date' }];
  const rejected = [
    { operationId: 'old', type: 'transaction.create' },
    { operationId: 'rejected', type: 'transaction.create' },
  ];
  const merged = appendQuarantinedOperations(existing, rejected, 'new-date');
  assert.deepEqual(merged, [
    existing[0],
    { operation: rejected[1], quarantinedAt: 'new-date' },
  ]);
});

function replacementFixture() {
  const data = new Map([['outbox', JSON.stringify([{ operationId: 'disk-only' }])]]);
  const store = {
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
  };
  const options = {
    outboxKey: 'outbox', reviewKey: 'review', operations: [{ operationId: 'memory-only' }],
    quarantinedAt: 'test-time', isCurrent: () => true,
  };
  return { data, store, options };
}

test('renewing access retains disk and in-memory operations across replacement and restart', async () => {
  const { data, store, options } = replacementFixture();
  const preserved = await preservePendingForReplacement(store, options);
  await store.setItem('outbox', '[]');
  const afterRestart = JSON.parse(data.get('review'));
  assert.deepEqual(afterRestart, preserved);
  assert.deepEqual(afterRestart.map((entry) => entry.operation.operationId), ['disk-only', 'memory-only']);
});

test('retrying authorization preserves existing review entries without duplicates', async () => {
  const { store, options } = replacementFixture();
  const first = await preservePendingForReplacement(store, options);
  const second = await preservePendingForReplacement(store, { ...options, quarantinedAt: 'later' });
  assert.deepEqual(second, first);
});

test('review write failure blocks replacement and leaves the original pending queue intact', async () => {
  const { data, store, options } = replacementFixture();
  const original = data.get('outbox');
  store.setItem = async () => { throw new Error('disk full'); };
  await assert.rejects(preservePendingForReplacement(store, options), /disk full/);
  assert.equal(data.get('outbox'), original);
  assert.deepEqual(options.operations, [{ operationId: 'memory-only' }]);
});

test('unverified review writes and unreadable queues block replacement', async () => {
  const { data, store, options } = replacementFixture();
  store.setItem = async () => {};
  await assert.rejects(preservePendingForReplacement(store, options), /Could not verify/);
  data.set('outbox', '{}');
  await assert.rejects(preservePendingForReplacement(store, options), /could not be read/);
});

test('superseded authorization does not proceed to replace access', async () => {
  const { data, store, options } = replacementFixture();
  const preserved = await preservePendingForReplacement(store, { ...options, isCurrent: () => false });
  assert.equal(preserved, null);
  assert.equal(data.has('review'), false);
});

test('provider protects pending work before redeeming a new invitation and signing out', () => {
  const provider = readFileSync(new URL('./ledger-context.tsx', import.meta.url), 'utf8');
  const begin = provider.slice(provider.indexOf('const beginReplacement ='), provider.indexOf('const pair ='));
  assert.match(begin, /requiringPair\.current = true[\s\S]*await enqueueStorage[\s\S]*preservePendingForReplacement/);
  const pair = provider.slice(provider.indexOf('const pair ='), provider.indexOf('const setup ='));
  assert.match(pair, /await beginReplacement\(\)[\s\S]*await redeemHouseholdInvitation[\s\S]*await commitReplacement/);
  const logout = provider.slice(provider.indexOf('const logout ='), provider.indexOf('const resetLedger ='));
  assert.match(logout, /preservePendingForReplacement[\s\S]*await deviceSessionStorage\.clear\(\)[\s\S]*AsyncStorage\.multiRemove/);
});

test('acknowledging review retains every operation, including original date and amount', () => {
  const saved = [{
    operation: { operationId: 'offline-expense', payload: { transaction: { note: 'Offline check', amountMinor: 123, occurredAt: '2026-11-09' } } },
    quarantinedAt: 'first-retained',
  }];
  const reviewed = markReviewedOperations(saved, 'review-time');
  assert.deepEqual(reviewed[0].operation, saved[0].operation);
  assert.equal(reviewed[0].quarantinedAt, 'first-retained');
  assert.equal(reviewed[0].reviewedAt, 'review-time');
  assert.equal(saved[0].reviewedAt, undefined);
  assert.deepEqual(markReviewedOperations(JSON.parse(JSON.stringify(reviewed)), 'later'), reviewed);
  const withNewEntry = appendQuarantinedOperations(reviewed, [{ operationId: 'another-offline-expense' }], 'new-time');
  assert.equal(withNewEntry[0].reviewedAt, 'review-time');
  assert.equal(withNewEntry[1].reviewedAt, undefined);
});

test('acknowledging in the provider persists review markers rather than deleting saved entries', () => {
  const provider = readFileSync(new URL('./ledger-context.tsx', import.meta.url), 'utf8');
  const acknowledge = provider.slice(provider.indexOf('const acknowledgeQuarantinedOutbox ='), provider.indexOf('useEffect(() => { setAuthTokenGetter'));
  assert.match(acknowledge, /markReviewedOperations[\s\S]*AsyncStorage\.setItem\(QUARANTINED_OUTBOX/);
  assert.doesNotMatch(acknowledge, /removeItem|setQuarantinedOutbox\(\[\]\)/);
});