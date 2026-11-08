import { parentPort, workerData } from 'node:worker_threads';
import { Quota } from '../quota.mjs';
const quota = new Quota(workerData.path, workerData.limits);
let accepted = 0;
try {
  for (let i = 0; i < 5; i++) {
    try { quota.reserve({ requests: 1 }); accepted++; } catch (error) {
      if (error.code !== 'insufficient_quota') throw error;
    }
  }
  parentPort.postMessage(accepted);
} finally { quota.close(); }
