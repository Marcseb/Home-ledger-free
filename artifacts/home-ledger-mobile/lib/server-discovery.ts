import { getServerPing, verifyDiscoveredServer, type DiscoveryChallenge } from '@workspace/api-client-react';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export type ServerVariant = 'production' | 'accelerated-test';
export type LanServer = { id: string; address: string; variant: ServerVariant };

export function normalizeServerAddress(address: string) {
  const url = new URL(address.trim().includes('://') ? address.trim() : `http://${address.trim()}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Enter a server address such as http://192.168.1.20:5000.');
  }
  return url.origin;
}

export function isPrivateIpv4(ip: string) {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function localServerPort(address: string): number | null {
  try {
    const url = new URL(normalizeServerAddress(address));
    if (url.protocol !== 'http:' || !isPrivateIpv4(url.hostname)) return null;
    return Number(url.port || 80);
  } catch { return null; }
}

export async function identifyServer(address: string, variant: ServerVariant, signal?: AbortSignal): Promise<LanServer | null> {
  const origin = normalizeServerAddress(address);
  const ping = await getServerPing({ baseUrl: origin, skipAuth: true, credentials: 'omit', redirect: 'error', timeoutMs: 1500, signal });
  if (ping?.product !== 'home-ledger' || ping.variant !== variant || typeof ping.id !== 'string' || !ping.id) return null;
  return { id: ping.id, address: origin, variant };
}

// Adapted from the supplied LAN Backup scanner. Probes are deliberately public:
// never send the active session's bearer token to the addresses being scanned.
export async function discoverLanServers({
  localIp, port, variant, signal, onProgress, probe = identifyServer,
}: {
  localIp: string; port: number; variant: ServerVariant; signal: AbortSignal;
  onProgress?: (scanned: number) => void;
  probe?: typeof identifyServer;
}): Promise<LanServer[]> {
  if (!isPrivateIpv4(localIp)) throw new Error('Connect to your home Wi-Fi to find the server.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port.');
  const prefix = localIp.split('.').slice(0, 3).join('.');
  const found = new Map<string, LanServer>();
  let scanned = 0;
  for (let start = 1; start <= 254 && !signal.aborted; start += 30) {
    await Promise.all(Array.from({ length: Math.min(30, 255 - start) }, async (_, offset) => {
      if (signal.aborted) return;
      try {
        const server = await probe(`http://${prefix}.${start + offset}:${port}`, variant, signal);
        if (server && !signal.aborted) found.set(`${server.id}@${server.address}`, server);
      } catch { /* An unreachable host is normal during a LAN scan. */ }
      finally { onProgress?.(++scanned); }
    }));
  }
  return [...found.values()];
}

export function expectedDiscoveryProof(token: string, input: DiscoveryChallenge, server: LanServer) {
  const message = JSON.stringify(['home-ledger-discovery-v1', server.id, server.variant, input.nonce, input.deviceId, input.userId, input.groupId]);
  return bytesToHex(hmac(sha256, utf8ToBytes(token), utf8ToBytes(message)));
}

export async function verifyServer(server: LanServer, session: { token: string; deviceId: string; user: { id: string } }, groupId: string, signal?: AbortSignal) {
  // Fresh uniqueness, not a secret: no bearer credential or password is sent.
  const nonce = `${Date.now().toString(36)}-${Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('-')}`;
  const input = { deviceId: session.deviceId, userId: session.user.id, groupId, nonce };
  const response = await verifyDiscoveredServer(input, {
    baseUrl: server.address, skipAuth: true, credentials: 'omit', redirect: 'error', timeoutMs: 4000, signal,
  });
  if (response?.id !== server.id || response.variant !== server.variant || !/^[a-f0-9]{64}$/.test(response.proof ?? '')) return false;
  const expected = expectedDiscoveryProof(session.token, input, server);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ response.proof.charCodeAt(i);
  return difference === 0;
}

export function preferredServer(servers: LanServer[], savedId?: string): LanServer | null {
  if (servers.length === 1) return servers[0];
  const matching = savedId ? servers.filter((server) => server.id === savedId) : [];
  return matching.length === 1 ? matching[0] : null;
}
