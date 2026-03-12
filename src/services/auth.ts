import { createCipheriv, publicEncrypt, constants } from 'node:crypto';
import type { AppConfig } from '../config.js';

export interface LoginPayload {
  userName: string;
  password: string;
  appVersion: string;
  clientIpAddress: string;
  browser: string;
  __RequestVerificationToken?: string;
}

export function encryptCredential(value: string, config: AppConfig): string {
  switch (config.authEncryptionMode) {
    case 'plaintext':
      return value;
    case 'aes-cbc':
      return encryptAesCbc(value, config);
    case 'rsa':
      return encryptRsa(value, config);
    case 'xor-base64':
      return encryptXorBase64(value, config);
    case 'base64':
    default:
      return Buffer.from(value, 'utf8').toString('base64');
  }
}

export function buildEncryptedLoginPayload(username: string, password: string, csrfToken: string | undefined, config: AppConfig): LoginPayload {
  const encryptedUserName = config.encryptedUsername ?? encryptCredential(username, config);
  const encryptedPassword = config.encryptedPassword ?? encryptCredential(password, config);

  console.info(
      `[DEBUG-AUTH] Encrypted User Length: ${encryptedUserName.length} chars; format=${inferEncoding(encryptedUserName)}; mode=${config.encryptedUsername ? 'verbatim-env' : config.authEncryptionMode}`
  );
  console.info(
      `[DEBUG-AUTH] Encrypted Password Length: ${encryptedPassword.length} chars; format=${inferEncoding(encryptedPassword)}; mode=${config.encryptedPassword ? 'verbatim-env' : config.authEncryptionMode}`
  );

  return {
    userName: encryptedUserName,
    password: encryptedPassword,
    appVersion: config.authAppVersion,
    clientIpAddress: config.authClientIpAddress,
    browser: config.authBrowser,
    ...(csrfToken ? { __RequestVerificationToken: csrfToken } : {})
  };
}

function encryptAesCbc(value: string, config: AppConfig): string {
  const key = decodeKeyMaterial(config.authAesKey, 'AES key');
  const iv = decodeKeyMaterial(config.authAesIv, 'AES IV');
  if (iv.length !== 16) throw new Error(`Invalid AES IV length (${iv.length}). Expected 16 bytes.`);

  const cipher = createCipheriv(config.authAesAlgorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}

function encryptRsa(value: string, config: AppConfig): string {
  if (!config.authRsaPublicKeyPem) throw new Error('Missing SGW_AUTH_RSA_PUBLIC_KEY_PEM for rsa mode.');
  const encrypted = publicEncrypt(
    {
      key: config.authRsaPublicKeyPem,
      padding: config.authRsaPadding === 'pkcs1' ? constants.RSA_PKCS1_PADDING : constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: config.authRsaOaepHash
    },
    Buffer.from(value, 'utf8')
  );
  return encrypted.toString('base64');
}

function encryptXorBase64(value: string, config: AppConfig): string {
  if (!config.authXorKey) throw new Error('Missing SGW_AUTH_XOR_KEY for xor-base64 mode.');
  const input = Buffer.from(value, 'utf8');
  const key = Buffer.from(config.authXorKey, 'utf8');
  const output = Buffer.alloc(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = input[i] ^ key[i % key.length];
  }
  return output.toString('base64');
}

function inferEncoding(value: string): string {
  if (/^[A-Za-z0-9+/=]+$/.test(value)) return 'base64-like';
  if (/^[0-9a-f]+$/i.test(value)) return 'hex-like';
  return 'mixed';
}

function decodeKeyMaterial(raw: string | undefined, label: string): Buffer {
  if (!raw) throw new Error(`Missing ${label}.`);
  const normalized = raw.trim();
  if (/^[0-9a-f]+$/i.test(normalized) && normalized.length % 2 === 0) return Buffer.from(normalized, 'hex');
  if (/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    try {
      const b64 = Buffer.from(normalized, 'base64');
      if (b64.length > 0) return b64;
    } catch {
      // fall back to utf8 path
    }
  }
  return Buffer.from(normalized, 'utf8');
}
