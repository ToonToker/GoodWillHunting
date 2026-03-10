import { Worker } from 'node:worker_threads';

export async function preciseCountdown(targetEpochMs: number): Promise<void> {
  while (true) {
    const remaining = targetEpochMs - Date.now();
    if (remaining <= 0) return;

    if (remaining > 5_000) {
      await sleep(remaining - 4_900);
      continue;
    }

    await atomicsWaitUntil(targetEpochMs);
    return;
  }
}

async function atomicsWaitUntil(targetEpochMs: number): Promise<void> {
  const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    const target = workerData.target;
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);

    while (true) {
      const now = Date.now();
      const remain = target - now;
      if (remain <= 0) {
        parentPort.postMessage('done');
        return;
      }
      Atomics.wait(view, 0, 0, Math.min(remain, 5));
    }
  `;

  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(workerCode, { eval: true, workerData: { target: targetEpochMs } });
    worker.once('message', () => {
      worker.terminate().catch(() => undefined);
      resolve();
    });
    worker.once('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
