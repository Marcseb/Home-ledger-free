export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function canPersistGeneration(expected: number, current: number, requiringPair: boolean, isPairCommit: boolean): boolean {
  return expected === current && (!requiringPair || isPairCommit);
}

export function mergeUniqueOperations<T extends { operationId: string }>(...lists: T[][]): T[] {
  const operations = new Map<string, T>();
  for (const list of lists) {
    for (const operation of list) operations.set(operation.operationId, operation);
  }
  return [...operations.values()];
}

export function appendQuarantinedOperations<T extends { operationId: string }>(
  existing: { operation: T; quarantinedAt: string }[],
  incoming: T[],
  quarantinedAt: string,
): { operation: T; quarantinedAt: string }[] {
  const entries = new Map(existing.map((entry) => [entry.operation.operationId, entry]));
  for (const operation of incoming) {
    if (!entries.has(operation.operationId)) entries.set(operation.operationId, { operation, quarantinedAt });
  }
  return [...entries.values()];
}

/** Run inside the serial storage queue, after fencing off old-session work. */
export async function preservePendingForReplacement<T extends { operationId: string }>(
  store: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> },
  options: {
    outboxKey: string; reviewKey: string; operations: T[];
    quarantinedAt: string; isCurrent: () => boolean;
  },
): Promise<{ operation: T; quarantinedAt: string }[] | null> {
  if (!options.isCurrent()) return null;
  const stored = JSON.parse(await store.getItem(options.outboxKey) ?? '[]') as T[];
  const existing = JSON.parse(await store.getItem(options.reviewKey) ?? '[]') as { operation: T; quarantinedAt: string }[];
  if (!options.isCurrent()) return null;
  if (!Array.isArray(stored) || !Array.isArray(existing)) throw new Error('Saved pending changes could not be read. Household access was not replaced.');
  const pending = mergeUniqueOperations(stored, options.operations);
  if (!pending.length) return existing;
  const combined = appendQuarantinedOperations(existing, pending, options.quarantinedAt);
  const serialized = JSON.stringify(combined);
  await store.setItem(options.reviewKey, serialized);
  if (await store.getItem(options.reviewKey) !== serialized) {
    throw new Error('Could not verify saved pending changes. Household access was not replaced.');
  }
  return options.isCurrent() ? combined : null;
}

export function markReviewedOperations<T>(
  entries: { operation: T; quarantinedAt: string; reviewedAt?: string }[],
  reviewedAt: string,
) {
  return entries.map((entry) => ({ ...entry, reviewedAt: entry.reviewedAt ?? reviewedAt }));
}