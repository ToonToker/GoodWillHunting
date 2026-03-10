import type { AppConfig } from './config.js';
import { logError } from './logger.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import { preciseCountdown } from './timing.js';
import type { AccountSession, DirectWatch, FavoriteItem, LiveTarget } from './types.js';

interface UpdateEvent {
  type: 'state' | 'alert';
  payload: unknown;
}

export class SniperEngine {
  private readonly targets = new Map<string, LiveTarget>();
  private readonly active = new Set<string>();
  private readonly directInput = new Map<number, DirectWatch>();

  constructor(
    private readonly client: ShopGoodwillClient,
    private readonly config: AppConfig,
    private readonly sessions: AccountSession[],
    private readonly clockOffsetMs: number,
    private readonly triggerAdjustMs: number,
    private readonly onUpdate: (event: UpdateEvent) => void
  ) {}

  start(): void {
    void this.pollFavorites();
    setInterval(() => void this.pollFavorites(), this.config.favoritesPollMs).unref();
    setInterval(() => void this.refreshTokens(), this.config.tokenRefreshMs).unref();
  }

  addDirectItem(itemId: number, sellerId: number): void {
    if (Number.isFinite(itemId) && Number.isFinite(sellerId)) {
      this.directInput.set(itemId, { itemId, sellerId });
      this.onUpdate({ type: 'alert', payload: { message: `Direct target queued: Item ${itemId} / Seller ${sellerId}` } });
    }
  }

  snapshot(): LiveTarget[] {
    return Array.from(this.targets.values()).sort((a, b) => a.endTimeMs - b.endTimeMs);
  }

  private async refreshTokens(): Promise<void> {
    await Promise.all(
      this.sessions.map(async (s) => {
        try {
          s.token = await this.client.login(s.username, s.password);
          s.refreshedAt = Date.now();
          s.connected = true;
          s.lastError = undefined;
        } catch (error) {
          s.connected = false;
          s.lastError = (error as Error).message;
          logError(`token refresh ${s.id}: ${(error as Error).message}`);
        }
      })
    );
    this.broadcastState();
  }

  private async pollFavorites(): Promise<void> {
    await Promise.all(this.sessions.map((s) => this.pollForAccount(s)));
    this.broadcastState();
  }

  private async pollForAccount(session: AccountSession): Promise<void> {
    try {
      const favorites = await this.client.getFavorites(session.token);
      session.connected = true;
      session.lastError = undefined;

      for (const fav of favorites) {
        const target = this.toTarget(session.id, fav);
        if (!target) continue;

        const key = `${session.id}:${target.itemId}`;
        const existing = this.targets.get(key);
        this.targets.set(key, existing ? { ...existing, ...target } : target);

        if (!this.active.has(key)) {
          this.active.add(key);
          void this.snipe(session, target, key).finally(() => this.active.delete(key));
        }
      }
    } catch (error) {
      session.connected = false;
      session.lastError = (error as Error).message;
      logError(`favorites ${session.id}: ${(error as Error).message}`);
    }
  }

  private toTarget(accountId: string, fav: FavoriteItem): LiveTarget | null {
    const itemId = Number(fav.itemId ?? fav.ItemId);
    const sellerIdFromFav = Number(fav.sellerId ?? fav.SellerID ?? 0);
    const endTimeMs = Date.parse(String(fav.endTime ?? fav.EndTime ?? ''));
    if (!Number.isFinite(itemId) || !Number.isFinite(endTimeMs) || endTimeMs <= Date.now() + this.clockOffsetMs) {
      return null;
    }

    const noteText = String(fav.notes ?? fav.Notes ?? '').trim();
    let maxBid: number | null = null;
    if (noteText.startsWith('{')) {
      try {
        const parsed = JSON.parse(noteText) as { max?: number; max_bid?: number };
        if (typeof parsed.max === 'number' && parsed.max > 0) maxBid = parsed.max;
        if (typeof parsed.max_bid === 'number' && parsed.max_bid > 0) maxBid = parsed.max_bid;
      } catch {
        return null;
      }
    }

    const direct = this.directInput.get(itemId);
    const sellerId = direct?.sellerId || sellerIdFromFav;

    if (maxBid === null && direct) {
      maxBid = Number(fav.minimumBid ?? fav.currentPrice ?? 1);
    }

    if (maxBid === null || !Number.isFinite(sellerId) || sellerId <= 0) return null;

    return {
      accountId,
      itemId,
      sellerId,
      title: fav.title ?? `Item ${itemId}`,
      imageUrl: String(fav.imageUrl ?? fav.imageURL ?? ''),
      currentPrice: Number(fav.currentPrice ?? 0),
      maxBid,
      endTimeMs,
      status: 'TRACKING'
    };
  }

  private async snipe(session: AccountSession, target: LiveTarget, key: string): Promise<void> {
    try {
      this.updateStatus(key, 'QUEUED');

      const warmAt = target.endTimeMs - 10_000 - this.clockOffsetMs;
      const fireAt = target.endTimeMs - (this.config.fireLeadMs + this.triggerAdjustMs) - this.clockOffsetMs;

      if (warmAt > Date.now()) {
        await sleep(warmAt - Date.now());
      }
      this.updateStatus(key, 'PRE-WARM');
      await this.client.warmBidConnection(session.token);

      await preciseCountdown(fireAt);

      const firstAmount = target.maxBid > 1 ? target.maxBid - 1 : target.maxBid;
      const first = await this.client.placeBid(session.token, {
        itemId: target.itemId,
        sellerId: target.sellerId,
        bidAmount: firstAmount,
        bidType: 1
      });

      if (first.isSuccess) {
        this.updateStatus(key, 'SNIPE SUCCESS', firstAmount);
        this.onUpdate({ type: 'alert', payload: { message: `[${session.id}] | WIN | Item #${target.itemId} | $${firstAmount.toFixed(2)}` } });
        return;
      }

      if (!/bid too low/i.test(first.message ?? '')) {
        this.updateStatus(key, `FAILED: ${first.message ?? 'unknown'}`, firstAmount);
        return;
      }

      const retryAmount = firstAmount + 1;
      if (retryAmount > target.maxBid) {
        this.updateStatus(key, 'FAILED: BID TOO LOW / ABOVE MAX', firstAmount);
        return;
      }

      const retry = await this.client.placeBid(session.token, {
        itemId: target.itemId,
        sellerId: target.sellerId,
        bidAmount: retryAmount,
        bidType: 1
      });

      if (retry.isSuccess) {
        this.updateStatus(key, 'SNIPE SUCCESS (RETRY)', retryAmount);
        this.onUpdate({ type: 'alert', payload: { message: `[${session.id}] | WIN | Item #${target.itemId} | $${retryAmount.toFixed(2)}` } });
      } else {
        this.updateStatus(key, `FAILED: ${retry.message ?? 'unknown'}`, retryAmount);
      }
    } catch (error) {
      this.updateStatus(key, `ERROR: ${(error as Error).message}`);
    }
  }

  private updateStatus(key: string, status: string, lastBid?: number): void {
    const target = this.targets.get(key);
    if (!target) return;
    target.status = status;
    if (lastBid !== undefined) target.lastBid = lastBid;
    this.broadcastState();
  }

  private broadcastState(): void {
    this.onUpdate({ type: 'state', payload: this.snapshot() });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
