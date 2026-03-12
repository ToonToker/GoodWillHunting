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
  loginPersistenceConfirmationSwitch: boolean;
  authEncryptionMode: 'plaintext' | 'base64' | 'aes-cbc' | 'rsa' | 'xor-base64';
  authAppVersion: string;
  authClientIpAddress: string;
  authBrowser: string;
  authAesAlgorithm: string;
  authAesKey?: string;
  authAesIv?: string;
  authRsaPublicKeyPem?: string;
  authRsaPadding: 'oaep' | 'pkcs1';
  authRsaOaepHash: string;
  authXorKey?: string;
}

export function loadConfig(): AppConfig {
  return {
    apiBaseUrl: process.env.SGW_API_BASE_URL ?? 'https://buyerapi.shopgoodwill.com/api/',
    userAgent:
      process.env.SGW_UA ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    favoritesPollMs: 60_000,
    tokenRefreshMs: 20 * 60_000,
    fireLeadMs: 2_500,
    port: Number(process.env.PORT ?? 3000),
    accountsPath: process.env.ACCOUNTS_PATH ?? 'accounts.json',
    loginPersistenceConfirmationSwitch: (process.env.SGW_LOGIN_PERSISTENCE_CONFIRMATION_SWITCH ?? 'true').toLowerCase() === 'true',
    authEncryptionMode: ((process.env.SGW_AUTH_ENCRYPTION_MODE ?? 'base64').toLowerCase() as AppConfig['authEncryptionMode']) ?? 'base64',
    authAppVersion: process.env.SGW_AUTH_APP_VERSION ?? 'web',
    authClientIpAddress: process.env.SGW_AUTH_CLIENT_IP ?? '0.0.0.0',
    authBrowser: process.env.SGW_AUTH_BROWSER ?? 'Chrome',
    authAesAlgorithm: process.env.SGW_AUTH_AES_ALGORITHM ?? 'aes-256-cbc',
    authAesKey: process.env.SGW_AUTH_AES_KEY,
    authAesIv: process.env.SGW_AUTH_AES_IV,
    authRsaPublicKeyPem: process.env.SGW_AUTH_RSA_PUBLIC_KEY_PEM,
    authRsaPadding: ((process.env.SGW_AUTH_RSA_PADDING ?? 'oaep').toLowerCase() as AppConfig['authRsaPadding']) ?? 'oaep',
    authRsaOaepHash: process.env.SGW_AUTH_RSA_OAEP_HASH ?? 'sha1',
    authXorKey: process.env.SGW_AUTH_XOR_KEY
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
