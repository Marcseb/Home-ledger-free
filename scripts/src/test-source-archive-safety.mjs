import assert from 'node:assert/strict';
import { assertSourceArchiveContent, isExcludedSourceArchivePath } from './source-archive-safety.mjs';

const required = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'artifacts/api-server/src/index.ts',
];

assert.doesNotThrow(() => assertSourceArchiveContent([
  ...required.map((path) => `./${path}`),
  '.env.example',
  'artifacts/api-server/.env.production.example',
], required, 'Fixture'));

for (const path of [
  '.env',
  '.env.local',
  'artifacts/api-server/.env.production',
  '.envrc',
  'artifacts/api-server/data/household.sqlite',
  'artifacts/api-server/data/household.sqlite-wal',
  'artifacts/api-server/data/recovery-keyring.json',
  'artifacts/api-server/data/recovery-keyring.json.tmp',
  'backups/household.hlbackup',
  'android/release.jks',
  'android/release.keystore',
  'android/signing.p12',
  'android/signing.pfx',
  'android/signing.p8',
  'android/signing.key',
  'android/signing.pem',
  'android/key.properties',
  'android/keystore.properties',
  'android/local.properties',
  'android/signing.mobileprovision',
  'android/app-release.apk',
  'android/app-release.aab',
  'node_modules/example/package.json',
  'artifacts/api-server/dist/index.js',
  'artifacts/api-server/recovery-keyring.json',
  'artifacts/api-server/recovery-keyring.json.backup',
  'artifacts/api-server/server-instance-id',
]) {
  assert.equal(isExcludedSourceArchivePath(path), true, `Expected exclusion: ${path}`);
}

assert.equal(isExcludedSourceArchivePath('.env.example'), false);
assert.equal(isExcludedSourceArchivePath('artifacts/api-server/.env.production.example'), false);
assert.equal(isExcludedSourceArchivePath('artifacts/api-server/src/index.ts'), false);

assert.throws(
  () => assertSourceArchiveContent([...required, 'secrets/household.hlbackup'], required, 'Fixture'),
  /private or runtime files/,
);
assert.throws(
  () => assertSourceArchiveContent(['package.json'], required, 'Fixture'),
  /required source files/,
);

console.log('Source archive safety tests passed.');
