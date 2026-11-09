import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('offline protection preserves the Free app identity and build variant', () => {
  const config = JSON.parse(read('../app.json')).expo;
  assert.equal(config.name, 'Home Ledger Free');
  assert.equal(config.slug, 'home-ledger-free');
  assert.equal(config.android.package, 'app.homeledger.free');
  assert.equal(config.version, '1.0.10');
  assert.equal(config.android.versionCode, 3);
  assert.equal(config.scheme, 'home-ledger-free');
  assert.equal(config.extra.appVariant, 'free');
  assert.match(read('../scripts/configure-app-variant.js'), /app\.homeledger\.free/);
});

test('Free offline documentation and help stay edition-focused', () => {
  const docs = [read('../../../README.md'), read('../../../docs/offline-sync-safety.md'), read('./help-content.ts')];
  for (const doc of docs) assert.doesNotMatch(doc, /premium preview|Expo Go|paid preview/i);
  assert.match(docs[0], /Acknowledging a review keeps the list/);
  assert.match(docs[2], /Acknowledging the review does not delete or post entries/);
});

test('port does not reintroduce the paid-feature route or Settings entry point', () => {
  assert.equal(existsSync(new URL('../app/plus-preview.tsx', import.meta.url)), false);
  assert.doesNotMatch(read('../app/(tabs)/settings.tsx'), /plus-preview|Open Plus preview/);
  assert.match(read('../app/(tabs)/settings.tsx'), /acknowledgeQuarantinedOutbox/);
});
