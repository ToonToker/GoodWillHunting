import dgram from 'node:dgram';
import { Worker } from 'node:worker_threads';

export async function getNtpOffsetMs(server = 'pool.ntp.org', timeoutMs = 2_000): Promise<number> {
  const socket = dgram.createSocket('udp4');

  return await new Promise<number>((resolve) => {
    const packet = Buffer.alloc(48);
    packet[0] = 0x1b;
    const sentAt = Date.now();

    const timeout = setTimeout(() => {
      socket.close();
      resolve(0);
    }, timeoutMs);

    socket.once('message', (msg) => {
      clearTimeout(timeout);
      socket.close();
      const seconds = msg.readUInt32BE(40);
      const fraction = msg.readUInt32BE(44);
      const ntpMs = (seconds - 2_208_988_800) * 1_000 + Math.round((fraction * 1_000) / 0x1_0000_0000);
      const recvAt = Date.now();
      const roundTrip = recvAt - sentAt;
      const estimatedLocalAtServerReply = sentAt + roundTrip / 2;
      resolve(ntpMs - estimatedLocalAtServerReply);
    });

    socket.send(packet, 123, server, (err) => {
      if (err) {
        clearTimeout(timeout);
        socket.close();
        resolve(0);
      }
    });
  });
}

export async function preciseWait(targetEpochMs: number, useWorker: boolean): Promise<void> {
  if (useWorker) {
    await workerWait(targetEpochMs);
    return;
  }

  while (true) {
    const remaining = targetEpochMs - Date.now();
    if (remaining <= 0) return;
    if (remaining > 40) {
      await sleep(remaining - 20);
      continue;
    }

    const baseEpochNs = Date.now() * 1_000_000;
    const hr = process.hrtime();
    const baseHrNs = hr[0] * 1_000_000_000 + hr[1];
    const targetNs = targetEpochMs * 1_000_000;

    while (true) {
      const nowHr = process.hrtime();
      const nowHrNs = nowHr[0] * 1_000_000_000 + nowHr[1];
      if (baseEpochNs + (nowHrNs - baseHrNs) >= targetNs) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

async function workerWait(targetEpochMs: number): Promise<void> {
  const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    const waitMs = Math.max(workerData.targetEpochMs - Date.now(), 0);
    Atomics.wait(view, 0, 0, waitMs);
    parentPort.postMessage('done');
  `;

  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(workerCode, { eval: true, workerData: { targetEpochMs } });
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
