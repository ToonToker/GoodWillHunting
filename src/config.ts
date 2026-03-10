import { readFile } from 'node:fs/promises';
import type { AccountCredential } from './types.js';

export interface AppConfig {
  baseUrl: string;
  userAgent: string;
  pollIntervalMs: number;
  tokenRefreshMs: number;
  maxConcurrentSnipes: number;
}

export async function loadAccounts(path = 'accounts.json'): Promise<AccountCredential[]> {
  const text = await readFile(path, 'utf8');
  const parsed = JSON.parse(text) as AccountCredential[];

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('accounts.json must contain a non-empty array of account credentials.');
  }

  for (const account of parsed) {
    if (!account.id || !account.username || !account.password) {
      throw new Error('Each account requires id, username, and password.');
    }
  }

  return parsed;
}

export function loadConfig(): AppConfig {
  return {
    baseUrl: process.env.SGW_BASE_URL ?? 'https://buyerapi.shopgoodwill.com',
    userAgent:
      process.env.SGW_UA ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    pollIntervalMs: Number(process.env.SGW_POLL_MS ?? 60_000),
    tokenRefreshMs: 30 * 60 * 1_000,
    maxConcurrentSnipes: Number(process.env.SGW_MAX_SNIPES ?? 80)
  };
}
