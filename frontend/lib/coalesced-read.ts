interface Flight {
  readonly promise: Promise<unknown>;
  readonly controller: AbortController;
  consumers: number;
}

/** Shares only pending reads, never results or writes; cancellation is per consumer. */
export function createReadCoalescer(maximum = 128) {
  const flights = new Map<string, Flight>();
  return function coalesce<T>(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (flights.size >= maximum && !flights.has(key)) return load(signal ?? new AbortController().signal);
    let flight = flights.get(key);
    if (!flight || flight.controller.signal.aborted) {
      const controller = new AbortController();
      const next: Flight = { controller, consumers: 0, promise: Promise.resolve().then(() => load(controller.signal)).finally(() => {
        if (flights.get(key) === next) flights.delete(key);
      }) };
      flights.set(key, next);
      flight = next;
    }
    const current = flight;
    current.consumers++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        current.consumers--;
        if (current.consumers === 0) current.controller.abort();
        settle();
      };
      const abort = () => finish(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
      signal?.addEventListener("abort", abort, { once: true });
      current.promise.then(value => finish(() => resolve(value as T)), error => finish(() => reject(error)));
    });
  };
}
