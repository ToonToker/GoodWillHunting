import dgram from 'node:dgram';

export async function ntpOffsetMs(server = 'pool.ntp.org'): Promise<number> {
  const socket = dgram.createSocket('udp4');
  return new Promise<number>((resolve) => {
    const packet = Buffer.alloc(48);
    packet[0] = 0x1b;
    const sent = Date.now();

    const timeout = setTimeout(() => {
      socket.close();
      resolve(0);
    }, 2500);

    socket.once('message', (msg) => {
      clearTimeout(timeout);
      socket.close();
      const sec = msg.readUInt32BE(40);
      const frac = msg.readUInt32BE(44);
      const ntpTime = (sec - 2_208_988_800) * 1000 + Math.round((frac * 1000) / 0x1_0000_0000);
      const recv = Date.now();
      const rtt = recv - sent;
      resolve(ntpTime - (sent + rtt / 2));
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

export async function preciseCountdown(targetEpochMs: number): Promise<void> {
  while (true) {
    const remaining = targetEpochMs - Date.now();
    if (remaining <= 0) return;
    if (remaining > 5_000) {
      await sleep(remaining - 4_900);
      continue;
    }

    const hrStart = process.hrtime();
    const epochStart = Date.now();

    while (true) {
      const elapsed = process.hrtime(hrStart);
      const elapsedMs = elapsed[0] * 1000 + elapsed[1] / 1_000_000;
      if (epochStart + elapsedMs >= targetEpochMs) {
        return;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
