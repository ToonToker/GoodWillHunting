import schedule from 'node-schedule';
import { logError, logInfo, logStatus, logWarn } from './logger.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import type { AppConfig } from './config.js';
import type { FavoriteItem, LiveTarget, TrackedAuction } from './types.js';

export class SniperEngine {
  private readonly tracked = new Map<number, TrackedAuction>();
  private readonly activeSnipes = new Set<number>();

  constructor(
    private readonly client: ShopGoodwillClient,
    private readonly config: AppConfig
  ) {}

  async start(): Promise<void> {
    await this.pollFavorites();
    this.scheduleNextPoll();
    logInfo('Watcher initialized: polling favorites every 60 seconds.');
  }

  private scheduleNextPoll(): void {
    schedule.scheduleJob(new Date(Date.now() + this.config.pollIntervalMs), async () => {
      await this.pollFavorites();
      this.scheduleNextPoll();
    });
  }

  private async pollFavorites(): Promise<void> {
    try {
      const favorites = await this.client.getFavorites();
      this.ingestFavorites(favorites);
      this.scheduleTargets();
    } catch (error) {
      logError(`Polling failed: ${(error as Error).message}`);
    }
  }

  private ingestFavorites(favorites: FavoriteItem[]): void {
    const now = Date.now();
    for (const favorite of favorites) {
      const raw = favorite as FavoriteItem & { Notes?: string; endTime?: string; itemId?: number | string };
      const parsed = this.parseLiveTarget(raw.notes ?? raw.Notes ?? '');
      if (!parsed) continue;

      const endTimeMs = Date.parse(raw.endTime);
      if (!Number.isFinite(endTimeMs) || endTimeMs <= now) continue;

      const itemId = Number(raw.itemId);
      if (!Number.isFinite(itemId)) continue;

      this.tracked.set(itemId, {
        itemId,
        endTimeMs,
        maxBid: parsed.max_bid,
        currentPrice: Number(raw.currentPrice ?? 0),
        title: raw.title ?? 'Unknown'
      });

      logStatus(itemId, parsed.max_bid, endTimeMs - now, 'LIVE TARGET');
    }
  }

  private scheduleTargets(): void {
    const now = Date.now();

    for (const [itemId, auction] of this.tracked.entries()) {
      if (auction.endTimeMs <= now) {
        this.tracked.delete(itemId);
        continue;
      }
      if (this.activeSnipes.has(itemId)) continue;

      if (this.activeSnipes.size >= this.config.maxConcurrentSnipes) {
        logWarn(`Concurrency limit reached (${this.config.maxConcurrentSnipes}). Holding auction ${itemId}.`);
        break;
      }

      this.activeSnipes.add(itemId);
      void this.runSnipe(auction)
        .catch((error) => logError(`Snipe failed for ${itemId}: ${(error as Error).message}`))
        .finally(() => {
          this.activeSnipes.delete(itemId);
          this.tracked.delete(itemId);
        });
    }
  }

  private async runSnipe(auction: TrackedAuction): Promise<void> {
    const warmupAt = auction.endTimeMs - 10_000;
    const fireAt = auction.endTimeMs - 2_500;

    if (warmupAt > Date.now()) {
      await delay(warmupAt - Date.now());
    }

    logStatus(auction.itemId, auction.maxBid, auction.endTimeMs - Date.now(), 'WARMING CONNECTION');
    await this.client.warmBidConnection();

    await preciseWait(fireAt);

    logStatus(auction.itemId, auction.maxBid, auction.endTimeMs - Date.now(), 'FIRING BID');
    const first = await this.client.placeBid(auction.itemId, auction.maxBid);
    if (first.isSuccess) {
      logStatus(auction.itemId, auction.maxBid, auction.endTimeMs - Date.now(), 'SUCCESS');
      return;
    }

    const msg = first.message ?? '';
    if (!/bid too low/i.test(msg)) {
      logStatus(auction.itemId, auction.maxBid, auction.endTimeMs - Date.now(), `FAILED: ${msg}`);
      return;
    }

    const oneStepHigher = this.deriveCounterBid(msg, first.minimumNextBid, auction.maxBid);
    if (oneStepHigher === null) {
      logStatus(auction.itemId, auction.maxBid, auction.endTimeMs - Date.now(), 'LOW BID, OUT OF BUFFER');
      return;
    }

    logStatus(auction.itemId, oneStepHigher, auction.endTimeMs - Date.now(), 'RE-FIRE');
    const second = await this.client.placeBid(auction.itemId, oneStepHigher);
    logStatus(
      auction.itemId,
      oneStepHigher,
      auction.endTimeMs - Date.now(),
      second.isSuccess ? 'SUCCESS (RE-FIRE)' : `FAILED (RE-FIRE): ${second.message ?? 'unknown'}`
    );
  }

  private deriveCounterBid(message: string, minimumNextBid: number | undefined, maxBid: number): number | null {
    const parsedFromMessage = Number((message.match(/(\d+(?:\.\d{1,2})?)/)?.[1] ?? NaN));
    const floor = Number.isFinite(minimumNextBid ?? NaN)
      ? Number(minimumNextBid)
      : Number.isFinite(parsedFromMessage)
        ? parsedFromMessage
        : null;

    if (floor === null || floor > maxBid) return null;
    return floor;
  }

  private parseLiveTarget(notes: string): LiveTarget | null {
    if (!notes.trim().startsWith('{')) return null;

    try {
      const parsed = JSON.parse(notes) as Partial<LiveTarget>;
      if (typeof parsed.max_bid === 'number' && Number.isFinite(parsed.max_bid) && parsed.max_bid > 0) {
        return { max_bid: parsed.max_bid };
      }
    } catch {
      return null;
    }

    return null;
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function preciseWait(targetEpochMs: number): Promise<void> {
  while (true) {
    const remaining = targetEpochMs - Date.now();
    if (remaining <= 0) return;

    if (remaining > 40) {
      await delay(remaining - 20);
      continue;
    }

    const baseEpochNs = Date.now() * 1_000_000;
    const hr = process.hrtime();
    const baseHrNs = hr[0] * 1_000_000_000 + hr[1];
    const targetNs = targetEpochMs * 1_000_000;

    while (true) {
      const nowHr = process.hrtime();
      const nowHrNs = nowHr[0] * 1_000_000_000 + nowHr[1];
      const elapsedNs = nowHrNs - baseHrNs;
      if (baseEpochNs + elapsedNs >= targetNs) {
        return;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}
