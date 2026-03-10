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
