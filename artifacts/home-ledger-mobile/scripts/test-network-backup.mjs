import assert from 'node:assert/strict';
import { withNetworkDeadline, createSyncGate } from '../lib/network-recovery.ts';
import { updateBackupAlarm, backupProblem } from '../lib/backup-attention.ts';
import { customFetch } from '../../../lib/api-client-react/src/custom-fetch.ts';

const healthy = { enrolled: true, destinationConfigured: true, destinationAvailable: true, lastSuccessfulAt: '2026-10-08T10:00:00Z', lastError: null };
assert.equal(updateBackupAlarm(null, null), null, 'offline alone is not a backup alarm');
let alarm = updateBackupAlarm(null, { ...healthy, lastError: 'Last encrypted backup is stale' });
assert.equal(alarm.problem, 'stale');
alarm = { ...alarm, acknowledged: true };
assert.deepEqual(updateBackupAlarm(alarm, null), alarm, 'offline retains acknowledged alarm');
assert.deepEqual(updateBackupAlarm(alarm, healthy), alarm, 'old successful backup cannot clear an alarm');
assert.deepEqual(updateBackupAlarm(alarm, { ...healthy, lastError: 'Last encrypted backup is stale' }), alarm, 'same problem stays dismissed');
assert.equal(updateBackupAlarm(alarm, { ...healthy, lastSuccessfulAt: '2026-10-08T11:00:00Z' }), null, 'new healthy backup clears alarm');
assert.equal(updateBackupAlarm(alarm, { ...healthy, destinationAvailable: false }).acknowledged, false, 'new problem reopens warning');
assert.ok(updateBackupAlarm(alarm, { ...healthy, lastSuccessfulAt: '2026-10-08T11:00:00Z', destinationAvailable: false }), 'new backup with unresolved problem cannot clear alarm');
assert.equal(backupProblem({ ...healthy, enrolled: false }), 'enrollment');
assert.equal(backupProblem({ ...healthy, destinationConfigured: false }), 'destination');
assert.equal(backupProblem({ ...healthy, lastSuccessfulAt: null }), 'missing');
assert.equal(backupProblem({ ...healthy, lastError: 'disk failure' }), 'error');
const acknowledgedError = { ...updateBackupAlarm(null, { ...healthy, lastError: 'disk failure' }), acknowledged: true };
assert.equal(updateBackupAlarm(acknowledgedError, { ...healthy, lastError: 'different failure' }).acknowledged, false);
const missing = updateBackupAlarm(null, { ...healthy, lastSuccessfulAt: null });
assert.equal(updateBackupAlarm(missing, healthy), null);

let observedSignal;
await assert.rejects(withNetworkDeadline((signal) => {
  observedSignal = signal;
  return new Promise(() => {});
}, 10), /server did not respond/);
assert.equal(observedSignal.aborted, true);
assert.equal(await withNetworkDeadline(async () => 'reconnected', 20), 'reconnected');

const gate = createSyncGate();
let attempts = 0;
let release;
const first = gate('household-a', () => { attempts++; return new Promise((resolve) => { release = resolve; }); });
assert.equal(gate('household-a', async () => { attempts++; }), first, 'overlapping retries join one sync');
await Promise.resolve();
await gate('household-b', async () => { attempts++; });
release();
await first;
await gate('household-a', async () => { attempts++; });
assert.equal(attempts, 3);
await assert.rejects(gate('household-a', () => withNetworkDeadline(() => new Promise(() => {}), 10)));
await gate('household-a', async () => { attempts++; });
assert.equal(attempts, 4, 'timeout releases the gate for retry');

const originalFetch = globalThis.fetch;
try {
  let requestSignal;
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  };
  await assert.rejects(customFetch('https://example.invalid/api/backups/status', { timeoutMs: 10 }), /deadline/);
  assert.equal(requestSignal.aborted, true);
  globalThis.fetch = async () => new Response(JSON.stringify(healthy), { headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await customFetch('https://example.invalid/api/backups/status', { timeoutMs: 50 }), healthy);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('PASS: backup acknowledgement, new-backup clearance, timeout aborts, sync single-flight and retry recovery');
