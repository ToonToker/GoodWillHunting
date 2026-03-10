import schedule from 'node-schedule';
import PQueue from 'p-queue';
import type { AppConfig } from './config.js';
import { logError, logInfo, logSnipeResult } from './logger.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import { preciseWait } from './timing.js';
import type { AccountSession, FavoriteItem, LiveTargetNote, PlaceBidResult, TrackedAuction } from './types.js';

export class SniperEngine {
  private readonly tracked = new Map<string, TrackedAuction>();
  private readonly queue: PQueue;
  private readonly finalLogQueue: Array<() => void> = [];

  constructor(
    private readonly client: ShopGoodwillClient,
    private readonly config: AppConfig,
    private readonly sessions: AccountSession[],
    private readonly clockOffsetMs: number
  ) {
    this.queue = new PQueue({ concurrency: config.maxConcurrentSnipes });
  }

  async start(): Promise<void> {
    await this.pollAllFavorites();

    schedule.scheduleJob(new Date(Date.now() + this.config.pollIntervalMs), () => {
      void this.pollAllFavorites().finally(() => this.schedulePollLoop());
    });

    this.scheduleTokenRefresh();
    logInfo(`Sniper engine started for ${this.sessions.length} account(s).`);
  }

  private schedulePollLoop(): void {
    schedule.scheduleJob(new Date(Date.now() + this.config.pollIntervalMs), () => {
      void this.pollAllFavorites().finally(() => this.schedulePollLoop());
    });
  }

  private scheduleTokenRefresh(): void {
    setInterval(() => {
      void Promise.all(this.sessions.map((s) => this.refreshToken(s)));
    }, this.config.tokenRefreshMs).unref();
  }

  private async refreshToken(session: AccountSession): Promise<void> {
    try {
      session.token = await this.client.login(session.username, session.password);
      session.tokenRefreshedAt = Date.now();
      logInfo(`Refreshed token for ${session.accountId}.`);
    } catch (error) {
      logError(`Token refresh failed for ${session.accountId}: ${(error as Error).message}`);
    }
  }

  private async pollAllFavorites(): Promise<void> {
    await Promise.all(this.sessions.map((s) => this.pollFavoritesForAccount(s)));
  }

  private async pollFavoritesForAccount(session: AccountSession): Promise<void> {
    try {
      const favorites = await this.client.getFavorites(session.token);
      this.ingestFavorites(session, favorites);
      this.queueTargets();
    } catch (error) {
      logError(`Favorites poll failed for ${session.accountId}: ${(error as Error).message}`);
    }
  }

  private ingestFavorites(session: AccountSession, favorites: FavoriteItem[]): void {
    const now = this.nowMs();

    for (const favorite of favorites) {
      const itemId = Number(favorite.itemId ?? favorite.ItemId);
      const endTimeMs = Date.parse(String(favorite.endTime ?? favorite.EndTime ?? ''));
      const parsed = parseLiveNote(favorite.notes ?? favorite.Notes ?? '');

      if (!Number.isFinite(itemId) || !Number.isFinite(endTimeMs) || !parsed || endTimeMs <= now) {
        continue;
      }

      const key = `${session.accountId}:${itemId}`;
      this.tracked.set(key, {
        accountId: session.accountId,
        itemId,
        endTimeMs,
        maxBid: parsed.max
      });
    }
  }

  private queueTargets(): void {
    const useWorkerTimers = this.tracked.size > 50;

    for (const [key, auction] of this.tracked.entries()) {
      this.queue.add(async () => {
        await this.runSnipe(auction, useWorkerTimers);
      });
      this.tracked.delete(key);
    }
  }

  private async runSnipe(auction: TrackedAuction, useWorkerTimers: boolean): Promise<void> {
    const session = this.sessions.find((s) => s.accountId === auction.accountId);
    if (!session) return;

    const warmAt = auction.endTimeMs - 10_000;
    const fireAt = auction.endTimeMs - 2_800;

    if (warmAt > this.nowMs()) {
      await sleep(warmAt - this.nowMs());
    }

    await this.client.warmBidConnection(session.token);

    await preciseWait(fireAt - this.clockOffsetMs, useWorkerTimers);

    const firstAmount = auction.maxBid > 1 ? auction.maxBid - 1 : auction.maxBid;
    const first = await this.client.placeBid(session.token, auction.itemId, firstAmount);
    const finalResult = await this.retryIfLowBid(session, auction, first, firstAmount);

    this.deferFinalLog(auction.endTimeMs + 200, () => {
      logSnipeResult(
        auction.accountId,
        finalResult.isSuccess ? 'WIN' : `FAIL:${finalResult.message ?? 'unknown'}`,
        auction.itemId,
        finalResult.amount
      );
    });
  }

  private async retryIfLowBid(
    session: AccountSession,
    auction: TrackedAuction,
    first: PlaceBidResult,
    firstAmount: number
  ): Promise<{ isSuccess: boolean; message?: string; amount: number }> {
    if (first.isSuccess) {
      return { isSuccess: true, amount: firstAmount };
    }

    if (!/bid too low/i.test(first.message ?? '')) {
      return { isSuccess: false, message: first.message, amount: firstAmount };
    }

    const retryAmount = firstAmount + 1;
    if (retryAmount > auction.maxBid) {
      return { isSuccess: false, message: 'Bid too low and above max', amount: firstAmount };
    }

    const retry = await this.client.placeBid(session.token, auction.itemId, retryAmount);
    return {
      isSuccess: retry.isSuccess,
      message: retry.message,
      amount: retryAmount
    };
  }

  private deferFinalLog(whenEpochMs: number, producer: () => void): void {
    const delay = Math.max(whenEpochMs - this.nowMs(), 0);
    setTimeout(() => {
      this.finalLogQueue.push(producer);
      const task = this.finalLogQueue.shift();
      if (task) task();
    }, delay).unref();
  }

  private nowMs(): number {
    return Date.now() + this.clockOffsetMs;
  }
}

function parseLiveNote(raw: string): LiveTargetNote | null {
  if (!raw.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LiveTargetNote>;
    if (typeof parsed.max === 'number' && parsed.max > 0) {
      return { max: parsed.max };
    }
  } catch {
    return null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
