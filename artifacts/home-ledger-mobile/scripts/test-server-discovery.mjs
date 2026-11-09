import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { discoverLanServers, expectedDiscoveryProof, identifyServer, isPrivateIpv4, localServerPort, normalizeServerAddress, preferredServer, verifyServer } from '../lib/server-discovery.ts';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

assert.equal(normalizeServerAddress('192.168.1.20:5000/'), 'http://192.168.1.20:5000');
assert.throws(() => normalizeServerAddress('http://user:password@192.168.1.1:5000'));
assert.throws(() => normalizeServerAddress('http://192.168.1.1:5000/api'));
assert.equal(isPrivateIpv4('0.0.0.0'), false);
assert.equal(isPrivateIpv4('192.168.300.1'), false);
assert.equal(localServerPort('https://example.invalid'), null);
assert.equal(localServerPort('http://192.168.1.20:5000'), 5000);
const server = { id: 'synthetic-server', address: 'http://192.168.1.80:5000', variant: 'production' };
let probes = 0, active = 0, peak = 0;
const controller = new AbortController();
const found = await discoverLanServers({
  localIp: '192.168.1.99', port: 5000, variant: 'production', signal: controller.signal,
  probe: async (address) => {
    probes++; peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1)); active--;
    return address === server.address ? server : null;
  },
});
assert.equal(probes, 254);
assert.ok(peak <= 30);
assert.deepEqual(found, [server]);
controller.abort();
assert.deepEqual(await discoverLanServers({ localIp: '192.168.1.99', port: 5000, variant: 'production', signal: controller.signal }), []);
assert.equal(preferredServer([server, { ...server, address: 'http://192.168.1.81:5000' }], server.id), null, 'ambiguous copied identities never auto-select');
assert.equal(preferredServer([server, { ...server, id: 'other' }], server.id), server);

const session = { token: 'synthetic-secret-used-only-in-test', deviceId: 'test-device', user: { id: 'test-user' } };
const groupId = 'test-group';
const originalFetch = globalThis.fetch;
let mode = 'valid';
setBaseUrl('https://original.invalid');
setAuthTokenGetter(() => session.token);
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(new Headers(options.headers).has('authorization'), false, 'never broadcast bearer credentials');
    assert.equal(new Headers(options.headers).has('x-device-token'), false);
    assert.equal(options.credentials, 'omit');
    assert.ok(String(url).startsWith(server.address), 'per-request origin overrides active origin');
    const input = options.body ? JSON.parse(options.body) : null;
    assert.ok(!String(options.body).includes(session.token));
    const data = String(url).endsWith('/api/ping')
      ? { ...server, product: 'home-ledger', variant: mode === 'wrong-variant' ? 'accelerated-test' : server.variant }
      : { id: server.id, variant: server.variant, proof: mode === 'forged' ? '0'.repeat(64) : expectedDiscoveryProof(session.token, input, server) };
    if (input) {
      const message = JSON.stringify(['home-ledger-discovery-v1', server.id, server.variant, input.nonce, input.deviceId, input.userId, input.groupId]);
      assert.equal(data.proof === '0'.repeat(64) ? 'forged' : data.proof, mode === 'forged' ? 'forged' : createHmac('sha256', session.token).update(message).digest('hex'));
    }
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  assert.deepEqual(await identifyServer(server.address, 'production'), server);
  assert.equal(await verifyServer(server, session, groupId), true);
  mode = 'forged'; assert.equal(await verifyServer(server, session, groupId), false);
  mode = 'wrong-variant'; assert.equal(await identifyServer(server.address, 'production'), null);
} finally {
  globalThis.fetch = originalFetch; setAuthTokenGetter(null); setBaseUrl(null);
}
console.log('LAN scanner, cancellation, proof interoperability and credential-isolation checks passed.');
