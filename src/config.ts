import { readFile } from 'node:fs/promises';
import type { AccountCredential } from './types.js';

export interface AppConfig {
  baseUrl: string;
  userAgent: string;
  favoritesPollMs: number;
  tokenRefreshMs: number;
  port: number;
}

export function loadConfig(): AppConfig {
  return {
    baseUrl: process.env.SGW_BASE_URL ?? 'https://buyerapi.shopgoodwill.com',
    userAgent:
      process.env.SGW_UA ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    favoritesPollMs: 60_000,
    tokenRefreshMs: 30 * 60_000,
    port: Number(process.env.PORT ?? 3000)
  };
}

export async function loadAccounts(path = 'accounts.json'): Promise<AccountCredential[]> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as AccountCredential[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('accounts.json must contain a non-empty array.');
  }
  for (const account of parsed) {
    if (!account.id || !account.username || !account.password) {
      throw new Error('Account entries require id, username, password.');
    }
  }
  return parsed;
}
