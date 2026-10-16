// One batch owns its signal and busy state until all active work has settled.
export function createJobRunner({ runJob, onComplete, onError, onBusy } = {}) {
  let controller = null;
  return {
    get isBusy() { return controller !== null; },
    cancel() { controller?.abort(); },
    async run(files, settings = {}) {
      if (controller) throw new Error('이미 작업이 진행 중입니다.');
      const inputs = [...files];
      const activeController = new AbortController();
      controller = activeController;
      const { signal } = activeController;
      const summary = { completed: 0, failed: 0, pending: inputs.length, cancelled: false };
      try {
        onBusy?.(true);
        for (const [index, file] of inputs.entries()) {
          try {
            signal.throwIfAborted();
            const result = await runJob(file, { index, total: inputs.length, signal, settings });
            signal.throwIfAborted();
            await onComplete?.(file, result);
            summary.completed += 1;
            summary.pending -= 1;
          } catch (error) {
            if (signal.aborted || error?.name === 'AbortError') {
              summary.cancelled = true;
            } else {
              summary.failed += 1;
              summary.pending -= 1;
              await onError?.(file, error);
            }
            break;
          }
        }
        return summary;
      } finally {
        controller = null;
        onBusy?.(false);
      }
    },
  };
}
