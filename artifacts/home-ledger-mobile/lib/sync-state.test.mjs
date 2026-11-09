import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileSyncSnapshot } from './sync-state.ts';

const expense = (id) => ({
  id, kind: 'expense', accountId: 'shared', categoryId: 'food',
  amountMinor: 1250, currency: 'EUR', note: id,
  occurredAt: '2026-11-09T12:00:00.000Z', createdByUserId: 'master',
  personalPayerAccountId: 'main', status: 'posted', allocationShares: [],
});
const operation = (id) => ({
  operationId: `op-${id}`, deviceId: 'phone', clientCreatedAt: '2026-11-09T12:00:00.000Z',
  type: 'transaction.create', payload: { transaction: expense(id) },
});
const snapshot = (transactions = []) => ({ groupId: 'household', serverSequence: 5, transactions });

test('an expense saved while bootstrap is in flight survives refresh, persistence and retry', async () => {
  const first = operation('first');
  const offline = operation('offline');
  let liveOutbox = [first];
  let releaseBootstrap;
  const bootstrap = new Promise((resolve) => { releaseBootstrap = resolve; });
  const refresh = (async () => {
    const completed = new Set([first.operationId]);
    const latestState = await bootstrap;
    return reconcileSyncSnapshot(latestState, liveOutbox, completed);
  })();
  liveOutbox = [...liveOutbox, offline];
  releaseBootstrap(snapshot([expense('first')]));
  const result = await refresh;
  assert.deepEqual(result.remaining, [offline]);
  assert.deepEqual(new Set(result.nextState.transactions.map((tx) => tx.id)), new Set(['first', 'offline']));
  assert.equal(result.nextState.transactions.find((tx) => tx.id === 'offline').personalPayerAccountId, 'main');
  const restoredQueue = JSON.parse(JSON.stringify(result.remaining));
  const retry = reconcileSyncSnapshot(snapshot([expense('first')]), restoredQueue, new Set());
  assert.deepEqual(retry.remaining, [offline]);
  const confirmed = reconcileSyncSnapshot(snapshot([expense('first'), expense('offline')]), retry.remaining, new Set([offline.operationId]));
  assert.deepEqual(confirmed.remaining, []);
  assert.equal(confirmed.nextState.transactions.filter((tx) => tx.id === 'offline').length, 1);
});

test('a refresh that sent no operations cannot erase a newly saved expense', () => {
  const offline = operation('offline');
  const result = reconcileSyncSnapshot(snapshot(), [offline], new Set());
  assert.deepEqual(result.remaining, [offline]);
  assert.equal(result.nextState.transactions[0].id, 'offline');
});

test('pending projections override duplicate server rows without duplicating activity', () => {
  const offline = operation('offline');
  const result = reconcileSyncSnapshot(snapshot([expense('offline')]), [offline], new Set());
  assert.equal(result.nextState.transactions.length, 1);
  assert.equal(result.remaining.length, 1);
});
