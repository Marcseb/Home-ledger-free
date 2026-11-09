const forbiddenDirectories = new Set([
  '.agents',
  '.cache',
  '.cxx',
  '.expo',
  '.expo-shared',
  '.git',
  '.gradle',
  '.local',
  '.secrets',
  '.ssh',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const privateFileExtension = /\.(?:sqlite(?:-(?:wal|shm|journal))?|db(?:-(?:wal|shm|journal))?|hlbackup|jks|keystore|p12|pfx|p8|key|pem|mobileprovision|apk|aab|tsbuildinfo)$/i;
const safeEnvironmentExample = /^\.env(?:\.[a-z0-9_-]+)*\.example$/i;
const forbiddenExactNames = new Set([
  '.envrc',
  'key.properties',
  'keystore.properties',
  'local.properties',
  'server-instance-id',
]);

export function isExcludedSourceArchivePath(value) {
  const normalized = String(value).replaceAll('\\', '/').replace(/^\.\//, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return false;

  const lowerParts = parts.map((part) => part.toLowerCase());
  if (lowerParts.some((part) => forbiddenDirectories.has(part))) return true;

  const apiServerIndex = lowerParts.findIndex((part, index) => part === 'api-server' && lowerParts[index - 1] === 'artifacts');
  if (apiServerIndex >= 0 && lowerParts[apiServerIndex + 1] === 'data') return true;

  const name = lowerParts.at(-1);
  if (name.startsWith('.env') && !safeEnvironmentExample.test(name)) return true;
  if (forbiddenExactNames.has(name)) return true;
  if (name === 'recovery-keyring.json' || name.startsWith('recovery-keyring.json.')) return true;
  return privateFileExtension.test(name);
}

export function assertSourceArchiveContent(entries, requiredPaths, archiveLabel) {
  const normalized = entries
    .map((entry) => String(entry).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter(Boolean);
  const unsafe = [...new Set(normalized.filter(isExcludedSourceArchivePath))];
  const contents = new Set(normalized);
  const missing = requiredPaths.filter((path) => !contents.has(path));

  if (unsafe.length > 0 || missing.length > 0) {
    const problems = [];
    if (unsafe.length > 0) problems.push(`private or runtime files: ${unsafe.join(', ')}`);
    if (missing.length > 0) problems.push(`required source files: ${missing.join(', ')}`);
    throw new Error(`${archiveLabel} source ZIP failed content validation (${problems.join('; ')})`);
  }
}
