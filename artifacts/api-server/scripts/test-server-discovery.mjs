import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = await mkdtemp(join(tmpdir(), 'home-ledger-discovery-'));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let child;
const start = async () => {
  child = spawn(process.execPath, ['./dist/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', APP_VARIANT: 'production', HOME: directory, XDG_CONFIG_HOME: join(directory, 'config'), BUDGET_DB_PATH: join(directory, 'ledger.sqlite'), HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Never print startup invitations or credentials.
  child.stdout.resume(); child.stderr.resume();
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${origin}/api/healthz`)).ok) return; } catch {}
    if (child.exitCode !== null) throw new Error('Isolated server failed to start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Isolated server startup deadline exceeded');
};
const stop = async () => {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM'); await exited;
};
const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
try {
  await start();
  const ping = await (await fetch(`${origin}/api/ping`)).json();
  assert.equal(ping.product, 'home-ledger'); assert.equal(ping.variant, 'production');
  assert.deepEqual(Object.keys(ping).sort(), ['id', 'product', 'variant']);
  const response = await post('/api/household/setup', { householdName: 'Isolated discovery fixture', displayName: 'Test master', currency: 'EUR', deviceId: 'fixture-device', deviceName: 'Fixture phone' });
  assert.equal(response.status, 201);
  const setup = await response.json();
  const input = { deviceId: 'fixture-device', userId: setup.user.id, groupId: setup.state.groupId, nonce: 'test-challenge-unique-12345' };
  const proofResponse = await post('/api/discovery/verify', input);
  assert.equal(proofResponse.status, 200);
  const proof = await proofResponse.json();
  const message = JSON.stringify(['home-ledger-discovery-v1', ping.id, ping.variant, input.nonce, input.deviceId, input.userId, input.groupId]);
  assert.equal(proof.proof, createHmac('sha256', setup.deviceToken).update(message).digest('hex'));
  assert.equal((await post('/api/discovery/verify', { ...input, groupId: 'wrong-group' })).status, 404);
  assert.equal((await post('/api/discovery/verify', { ...input, nonce: 'short' })).status, 400);
  assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 401);
  const db = new DatabaseSync(join(directory, 'ledger.sqlite'));
  db.prepare('UPDATE device_sessions SET revoked_at=? WHERE device_id=?').run(new Date().toISOString(), input.deviceId);
  db.close();
  assert.equal((await post('/api/discovery/verify', input)).status, 200, 'revoked access can identify its original server, but never authorize it');
  assert.equal((await fetch(`${origin}/api/bootstrap`, { headers: { 'x-device-token': setup.deviceToken } })).status, 401);
  await stop(); await start();
  assert.equal((await (await fetch(`${origin}/api/ping`)).json()).id, ping.id, 'installation identity survives restart');
  console.log('Isolated API discovery, session proof, revocation safety and persistent identity checks passed.');
} finally { await stop(); await rm(directory, { recursive: true, force: true }); }
