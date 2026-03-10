export interface AppConfig {
  username: string;
  password: string;
  pollIntervalMs: number;
  maxConcurrentSnipes: number;
  userAgent: string;
  baseUrl: string;
}

export function loadConfig(): AppConfig {
  const username = process.env.SGW_USERNAME;
  const password = process.env.SGW_PASSWORD;

  if (!username || !password) {
    throw new Error('Missing credentials. Set SGW_USERNAME and SGW_PASSWORD.');
  }

  return {
    username,
    password,
    pollIntervalMs: Number(process.env.SGW_POLL_MS ?? 60_000),
    maxConcurrentSnipes: Math.min(Number(process.env.SGW_MAX_SNIPES ?? 20), 20),
    userAgent:
      process.env.SGW_UA ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    baseUrl: process.env.SGW_BASE_URL ?? 'https://buyerapi.shopgoodwill.com'
  };
}
