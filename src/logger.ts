export function logStatus(auctionId: number, targetPrice: number, timeToCloseMs: number, status: string): void {
  const seconds = Math.max(timeToCloseMs / 1000, 0).toFixed(2).padStart(7, ' ');
  const target = targetPrice.toFixed(2).padStart(8, ' ');
  console.log(`[${auctionId}] | $${target} | ${seconds}s | ${status}`);
}

export function logInfo(message: string): void {
  console.log(`[INFO] ${message}`);
}

export function logWarn(message: string): void {
  console.warn(`[WARN] ${message}`);
}

export function logError(message: string): void {
  console.error(`[ERROR] ${message}`);
}
