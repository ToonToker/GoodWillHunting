import { readFile, writeFile } from 'node:fs/promises';
import type { AccountCredential } from './types.js';

export interface AppConfig {
  apiBaseUrl: string;
  userAgent: string;
  favoritesPollMs: number;
  tokenRefreshMs: number;
  fireLeadMs: number;
  port: number;
  accountsPath: string;
}

export function loadConfig(): AppConfig {
  return {
    apiBaseUrl: process.env.SGW_API_BASE_URL ?? 'https://buyerapi.shopgoodwill.com/api/',
    userAgent:
      process.env.SGW_UA ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    favoritesPollMs: 60_000,
    tokenRefreshMs: 20 * 60_000,
    fireLeadMs: 2_500,
    port: Number(process.env.PORT ?? 3000),
    accountsPath: process.env.ACCOUNTS_PATH ?? 'accounts.json'
  };
}

export async function loadAccounts(path: string): Promise<AccountCredential[]> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as AccountCredential[];
  validateAccounts(parsed);
  return parsed;
}

export async function saveAccounts(path: string, accounts: AccountCredential[]): Promise<void> {
  validateAccounts(accounts, true);
  await writeFile(path, JSON.stringify(accounts, null, 2), 'utf8');
}

function validateAccounts(accounts: AccountCredential[], allowEmpty = false): void {
  if (!Array.isArray(accounts) || (!allowEmpty && accounts.length === 0)) {
    throw new Error('accounts.json must contain a non-empty array.');
  }
  for (const account of accounts) {
    if (!account.id || !account.username || !account.password) {
      throw new Error('Account entries require id, username, password.');
    }
  }
}
