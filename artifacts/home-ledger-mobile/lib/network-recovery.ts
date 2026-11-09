// A bounded request also releases the sync lock if native fetch stalls offline.
export async function withNetworkDeadline<T>(request: (signal: AbortSignal) => Promise<T>, milliseconds = 15_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('The server did not respond. Check Wi-Fi and the server address, then retry.'));
      controller.abort();
    }, milliseconds);
  });
  try {
    return await Promise.race([request(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function createSyncGate() {
  let active: { key: string; promise: Promise<void> } | null = null;
  return (key: string, request: () => Promise<void>): Promise<void> => {
    if (active?.key === key) return active.promise;
    const flight = { key, promise: Promise.resolve() };
    // Schedule after installing the gate, even if the request throws synchronously.
    flight.promise = Promise.resolve().then(request).finally(() => {
      if (active === flight) active = null;
    });
    active = flight;
    return flight.promise;
  };
}
