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
      void this.refreshAll();
    }, this.config.tokenRefreshMs).unref();
  }

  async refreshAll(): Promise<void> {
    await Promise.all(
      this.sessions.map(async (session) => {
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
      })
    );

    await this.onChange();
  }
}
