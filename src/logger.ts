export function logInfo(message: string): void {
  console.log(`[INFO] ${message}`);
}

export function logWarn(message: string): void {
  console.warn(`[WARN] ${message}`);
}

export function logError(message: string): void {
  console.error(`[ERROR] ${message}`);
}

export function logSnipeResult(accountId: string, status: string, itemId: number, amount: number): void {
  console.log(`[${accountId}] | ${status} | Item #${itemId} | $${amount.toFixed(2)}`);
}
