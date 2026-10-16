export async function mapWithConcurrency(items, limit, worker, { signal } = {}) {
  const input = [...(items ?? [])];
  const concurrency = Math.max(1, Math.floor(Number(limit) || 1));
  const results = new Array(input.length);
  let nextIndex = 0;
  const controller = new AbortController();
  let failed = false;
  let firstError;

  function stop(error) {
    if (failed) return;
    failed = true;
    firstError = error;
    controller.abort(error);
  }

  const onAbort = () => stop(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  async function runNext() {
    while (!failed && nextIndex < input.length) {
      const index = nextIndex++;
      try {
        results[index] = await worker(input[index], index, controller.signal);
      } catch (error) {
        stop(error);
      }
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, input.length) },
    () => runNext(),
  );
  try {
    await Promise.all(runners);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (failed) throw firstError;
  return results;
}
