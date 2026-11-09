import type { BackupStatus } from '@workspace/api-client-react';

export type BackupProblem = 'enrollment' | 'destination' | 'unavailable' | 'missing' | 'stale' | 'error';
export type BackupAlarm = { problem: BackupProblem; lastSuccessfulAt: string | null; acknowledged: boolean; error?: string | null };

export function backupProblem(status: BackupStatus): BackupProblem | null {
  if (status.reviewDemo) return null;
  if (!status.enrolled) return 'enrollment';
  if (!status.destinationConfigured) return 'destination';
  if (!status.destinationAvailable) return 'unavailable';
  if (!status.lastSuccessfulAt) return 'missing';
  if (status.lastError === 'Last encrypted backup is stale') return 'stale';
  return status.lastError ? 'error' : null;
}

// No connection is not evidence of a failed backup. Keep an existing alarm
// until a fresh, healthy server backup is confirmed.
export function updateBackupAlarm(alarm: BackupAlarm | null, status: BackupStatus | null): BackupAlarm | null {
  if (!status) return alarm;
  if (status.reviewDemo) return null;
  const problem = backupProblem(status);
  if (problem) {
    if (alarm?.problem === problem && (problem !== 'error' || alarm.error === status.lastError)) return alarm;
    return { problem, lastSuccessfulAt: status.lastSuccessfulAt, acknowledged: false, error: status.lastError };
  }
  if (!alarm) return null;
  if (status.lastSuccessfulAt && (!alarm.lastSuccessfulAt ||
    Date.parse(status.lastSuccessfulAt) > Date.parse(alarm.lastSuccessfulAt))) return null;
  return alarm;
}

export const backupProblemMessage: Record<BackupProblem, string> = {
  enrollment: 'Recovery enrollment is needed on the server.',
  destination: 'Backup destination is not configured on the server.',
  unavailable: 'Configured backup destination is unavailable.',
  missing: 'No successful server backup is recorded yet.',
  stale: 'The last server backup is stale.',
  error: 'A backup error was recorded. Check Settings for details.',
};
