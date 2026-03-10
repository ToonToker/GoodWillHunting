import type { AppConfig } from './config.js';
import { logError } from './logger.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import type { AccountSession } from './types.js';

export class TokenManager {
  constructor(
    private readonly client: ShopGoodwillClient,
    private readonly config: AppConfig,
    private readonly sessions: AccountSession[],
    private readonly onChange: () => Promise<void>
  ) {}

  start(): void {
    setInterval(() => {
      void this.refreshIfNeeded();
    }, this.config.tokenRefreshMs).unref();
  }

  async refreshAll(): Promise<void> {
    await Promise.all(this.sessions.map((s) => this.refreshOne(s)));
    await this.onChange();
  }

  async refreshIfNeeded(): Promise<void> {
    await Promise.all(
      this.sessions.map(async (session) => {
        if (shouldRefresh(session.token)) {
          await this.refreshOne(session);
        }
      })
    );

    await this.onChange();
  }

  private async refreshOne(session: AccountSession): Promise<void> {
    try {
      session.token = await this.client.login(session.username, session.password);
      session.refreshedAt = Date.now();
      session.connected = true;
      session.lastError = undefined;
    } catch (error) {
      session.connected = false;
      session.lastError = (error as Error).message;
      logError(`token refresh ${session.id}: ${(error as Error).message}`);
    }
  }
}

function shouldRefresh(token: string): boolean {
  if (!token) return true;
  const expMs = decodeJwtExpMs(token);
  if (!expMs) return true;
  return expMs <= Date.now();
}

function decodeJwtExpMs(token: string): number | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { exp?: number };
    if (typeof parsed.exp !== 'number') return null;
    return parsed.exp * 1000;
  } catch {
    return null;
  }
}
