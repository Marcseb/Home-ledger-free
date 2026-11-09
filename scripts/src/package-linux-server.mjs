import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertSourceArchiveContent, isExcludedSourceArchivePath } from './source-archive-safety.mjs';

// Validate a clean working-tree source copy, not a git-only archive. Generated
// schemas are needed even when untracked. Never include live server state.
const root = resolve(import.meta.dirname, '../..');
const name = process.argv[2] ?? 'home-ledger-linux-server-shared-only-2026-10-11-source.zip';
if (basename(name) !== name || !name.endsWith('.zip')) throw new Error('Provide a ZIP filename only');
const output = join(root, 'downloads', name);
if (existsSync(output)) throw new Error('Refusing to overwrite an existing release');
const stage = mkdtempSync(join(tmpdir(), 'home-ledger-linux-source-'));
const excluded = new Set(['node_modules', 'dist', 'build', '.expo', '.gradle', '.cxx', '.git', '.local', '.agents', 'android', 'ios', '__pycache__', '.replit-artifact']);
const filter = (path) => {
  const file = basename(path);
  return !excluded.has(file) && !isExcludedSourceArchivePath(path) && !file.startsWith('expo-qr')
    && resolve(path) !== join(root, 'artifacts/api-server/data');
};
const env = { ...process.env, APP_VARIANT: 'production', CI: '1' };
delete env.NODE_ENV;
const run = (command, args, cwd = stage) => {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
};
try {
  for (const relative of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.gitignore', '.gitattributes', 'tsconfig.json', 'tsconfig.base.json', 'LINUX-SERVER-UPDATE.md', 'artifacts/home-ledger-mobile', 'artifacts/api-server', 'lib/api-client-react', 'lib/api-spec', 'lib/api-zod', 'lib/db', 'scripts', 'docs']) {
    if (existsSync(join(root, relative))) cpSync(join(root, relative), join(stage, relative), { recursive: true, filter });
  }
  console.log(`Isolated server-source staging: ${stage}`);
  run('pnpm', ['install', '--frozen-lockfile']);
  run('pnpm', ['run', 'typecheck:libs']);
  run('pnpm', ['--filter', '@workspace/api-server', 'run', 'typecheck']);
  run('pnpm', ['--filter', '@workspace/api-server', 'run', 'build']);
  run('pnpm', ['--filter', '@workspace/api-server', 'run', 'test:shared-expense-payments']);
  run('node', ['scripts/test-server-discovery.mjs'], join(stage, 'artifacts/api-server'));
  function clean(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (!filter(path)) rmSync(path, { recursive: true, force: true });
      else if (entry.isDirectory()) clean(path);
    }
  }
  clean(stage);
  mkdirSync(join(root, 'downloads'), { recursive: true });
  run('zip', ['-q', '-r', output, '.']);
  try {
    run('unzip', ['-tq', output]);
    const listing = spawnSync('unzip', ['-Z1', output], { encoding: 'utf8' });
    if (listing.status !== 0) throw new Error(`Could not list server source ZIP entries (${listing.status})`);
    assertSourceArchiveContent(listing.stdout.split(/\r?\n/), [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'artifacts/api-server/package.json',
      'artifacts/api-server/src/index.ts',
      'scripts/start-home-ledger-server.sh',
      'LINUX-SERVER-UPDATE.md',
    ], 'Linux server');
  } catch (error) {
    rmSync(output, { force: true });
    throw error;
  }
  const checksum = createHash('sha256').update(readFileSync(output)).digest('hex');
  writeFileSync(`${output}.sha256`, `${checksum}  ${name}\n`);
  console.log(`Validated source ZIP: ${output}\nSHA-256: ${checksum}`);
} finally { rmSync(stage, { recursive: true, force: true }); }
