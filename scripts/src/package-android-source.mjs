import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertSourceArchiveContent, isExcludedSourceArchivePath } from './source-archive-safety.mjs';

// Generate an isolated, fixed-Free-edition source release, never modify the
// running Expo workspace's native project or include credentials/runtime data.
const root = resolve(import.meta.dirname, '../..');
const releaseDate = new Date().toISOString().slice(0, 10);
const release = JSON.parse(readFileSync(join(root, 'artifacts/home-ledger-mobile/app.json'), 'utf8')).expo;
const outputName = process.argv[2] ?? `home-ledger-free-v${release.version}-code_${release.android.versionCode}-source-${releaseDate}.zip`;
if (basename(outputName) !== outputName || !outputName.endsWith('.zip')) throw new Error('Provide a ZIP filename only');
const stage = mkdtempSync(join(tmpdir(), 'home-ledger-android-source-'));
const app = join(stage, 'artifacts/home-ledger-mobile');
const excluded = new Set(['node_modules', 'dist', 'build', '.expo', '.gradle', '.cxx', '.git', '.local', '.agents', 'android', 'ios', '__pycache__', '.replit-artifact']);
const filter = (path) => {
  const name = basename(path);
  return !excluded.has(name) && !isExcludedSourceArchivePath(path) && !name.startsWith('expo-qr')
    && resolve(path) !== join(root, 'artifacts/api-server/data');
};
const copy = (relative) => {
  if (existsSync(join(root, relative))) cpSync(join(root, relative), join(stage, relative), { recursive: true, filter });
};
for (const file of ['README.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.gitignore', '.gitattributes', 'tsconfig.json', 'tsconfig.base.json', 'LINUX-SERVER-UPDATE.md']) copy(file);
for (const directory of ['artifacts/home-ledger-mobile', 'artifacts/api-server', 'lib/api-client-react', 'lib/api-spec', 'lib/api-zod', 'lib/db', 'scripts', 'docs']) copy(directory);

const env = { ...process.env, APP_VARIANT: 'free', EXPO_PUBLIC_APP_VARIANT: 'free', CI: '1' };
delete env.EXPO_PUBLIC_DOMAIN;
delete env.EXPO_TOKEN;
delete env.REPLIT_EXPO_SESSION_SECRET;
delete env.EXPO_PACKAGER_PROXY_URL;
delete env.REACT_NATIVE_PACKAGER_HOSTNAME;
const run = (command, args, cwd = stage) => {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
};
if (process.env.APP_VARIANT === 'accelerated-test') throw new Error('Use APP_VARIANT=free for this source release');
run(process.execPath, [join(app, 'scripts/configure-app-variant.js'), 'free'], app);
const config = JSON.parse(readFileSync(join(app, 'app.json'), 'utf8')).expo;
if (config.extra.appVariant !== 'free' || config.android.package !== 'app.homeledger.free') {
  throw new Error('Could not configure a Home Ledger Free Android source release');
}
cpSync(join(stage, 'docs/android-free-build.md'), join(stage, 'ANDROID-STUDIO-FREE-BUILD.md'));
console.log(`Isolated release staging: ${stage}`);
run('pnpm', ['install', '--frozen-lockfile']);
const manifest = readFileSync(join(app, 'package.json'));
run('pnpm', ['exec', 'expo', 'prebuild', '--platform', 'android', '--no-install'], app);
// Expo can relocate dependencies even with --no-install. Keep the manifest and
// lockfile from the same validated source workspace.
writeFileSync(join(app, 'package.json'), manifest);
const settingsPath = join(app, 'android/settings.gradle');
const settings = readFileSync(settingsPath, 'utf8');
if ((settings.match(/id\("com.facebook.react.settings"\)/g) ?? []).length !== 1) throw new Error('Unexpected React settings plugin count');
writeFileSync(settingsPath, settings.replace('plugins {', 'plugins {\n  id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"'));
const propertiesPath = join(app, 'android/gradle.properties');
writeFileSync(propertiesPath, readFileSync(propertiesPath, 'utf8') + '\n# Discover the installed JDK selected by the build shell.\norg.gradle.java.installations.fromEnv=JAVA_HOME\n');
writeFileSync(join(app, 'android/gradle/gradle-daemon-jvm.properties'), '# Home Ledger requires a Gradle daemon running on JDK 17.\ntoolchainVersion=17\n');
const buildPath = join(app, 'android/app/build.gradle');
const gradle = readFileSync(buildPath, 'utf8');
if (!gradle.includes(`versionCode ${config.android.versionCode}`) || !gradle.includes(`applicationId '${config.android.package}'`)) throw new Error('Generated Android identity mismatch');
writeFileSync(buildPath, gradle.replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs.debug/, '$1// Configure release signing locally in Android Studio; no debug-key fallback.'));
const debugKey = join(app, 'android/app/debug.keystore');
if (existsSync(debugKey)) rmSync(debugKey);
run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']);
run('pnpm', ['run', 'typecheck:libs']);
run('pnpm', ['--filter', '@workspace/home-ledger-mobile', 'run', 'typecheck']);
run('pnpm', ['--filter', '@workspace/home-ledger-mobile', 'run', 'test:shared-payments']);
run('pnpm', ['--filter', '@workspace/home-ledger-mobile', 'run', 'test:bank-estimate']);
run('pnpm', ['--filter', '@workspace/home-ledger-mobile', 'run', 'test:network-backup']);
run('pnpm', ['--filter', '@workspace/home-ledger-mobile', 'run', 'test:server-discovery']);
run('pnpm', ['--filter', '@workspace/home-ledger-mobile', 'run', 'test:app-lock']);
run('pnpm', ['exec', 'expo', 'export', '--platform', 'android', '--max-workers', '1', '--output-dir', 'release-validation'], app);
rmSync(join(app, 'release-validation'), { recursive: true });

// Remove dependencies, build outputs and native-generated private/local files.
function clean(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name !== 'android' && entry.name !== 'ios' && !filter(path)) rmSync(path, { recursive: true, force: true });
    else if (entry.isDirectory()) clean(path);
  }
}
clean(stage);
const output = join(root, 'downloads', outputName);
mkdirSync(join(root, 'downloads'), { recursive: true });
if (existsSync(output)) throw new Error('Release ZIP already exists; choose a new filename');
run('zip', ['-q', '-r', output, '.']);
try {
  run('unzip', ['-tq', output]);
  const listing = spawnSync('unzip', ['-Z1', output], { encoding: 'utf8' });
  if (listing.status !== 0) throw new Error(`Could not list Android source ZIP entries (${listing.status})`);
  assertSourceArchiveContent(listing.stdout.split(/\r?\n/), [
    'package.json',
    'README.md',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'artifacts/home-ledger-mobile/package.json',
    'artifacts/home-ledger-mobile/app.json',
    'artifacts/home-ledger-mobile/scripts/configure-app-variant.js',
    'artifacts/home-ledger-mobile/lib/personal-bank-estimate.ts',
    'artifacts/home-ledger-mobile/components/AppLockProvider.tsx',
    'artifacts/home-ledger-mobile/components/AppLockSettingsSection.tsx',
    'artifacts/home-ledger-mobile/lib/app-lock-policy.ts',
    'artifacts/home-ledger-mobile/lib/app-lock-storage.ts',
    'artifacts/home-ledger-mobile/android/settings.gradle',
    'artifacts/home-ledger-mobile/android/app/build.gradle',
    'ANDROID-STUDIO-FREE-BUILD.md',
  ], 'Android');
} catch (error) {
  rmSync(output, { force: true });
  throw error;
}
console.log(`SOURCE_ZIP=${output}`);
const checksum = createHash('sha256').update(readFileSync(output)).digest('hex');
writeFileSync(`${output}.sha256`, `${checksum}  ${outputName}\n`);
console.log(`SHA256=${checksum}`);
console.log(`STAGING=${stage}`);
