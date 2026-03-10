import type { AppConfig } from './config.js';
import { logError } from './logger.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import { preciseCountdown } from './timing.js';
import type { AccountSession, BattleRow, DirectWatch, FavoriteItem } from './types.js';

interface UpdateEvent {
  type: 'state' | 'alert';
  payload: unknown;
}

export class SniperEngine {
  private readonly rows = new Map<string, BattleRow>();
  private readonly active = new Set<string>();
  private readonly directInput = new Map<number, DirectWatch>();

  constructor(
    private readonly client: ShopGoodwillClient,
    private readonly config: AppConfig,
    private readonly sessions: AccountSession[],
    private readonly assignments: Map<number, string>,
    private readonly clockOffsetMs: number,
    private readonly triggerAdjustMs: number,
    private readonly onUpdate: (event: UpdateEvent) => void
  ) {}

  start(): void {
    void this.pollFavorites();
    setInterval(() => void this.pollFavorites(), this.config.favoritesPollMs).unref();
  }

  addDirectItem(itemId: number, sellerId: number): void {
    if (Number.isFinite(itemId) && Number.isFinite(sellerId)) {
      this.directInput.set(itemId, { itemId, sellerId });
      this.onUpdate({ type: 'alert', payload: { message: `Direct target queued: Item ${itemId} / Seller ${sellerId}` } });
    }
  }

  setAssignment(itemId: number, accountId: string): void {
    if (!Number.isFinite(itemId)) return;
    if (!accountId) {
      this.assignments.delete(itemId);
    } else {
      this.assignments.set(itemId, accountId);
    }
    this.onUpdate({ type: 'alert', payload: { message: `Assignment updated: Item ${itemId} -> ${accountId || 'auto'}` } });
  }

  snapshot(): BattleRow[] {
    return Array.from(this.rows.values()).sort((a, b) => a.endTimeMs - b.endTimeMs);
  }

  async pollFavorites(): Promise<void> {
    await Promise.all(this.sessions.map((s) => this.pollForAccount(s)));
    this.broadcastState();
  }

  private async pollForAccount(session: AccountSession): Promise<void> {
    try {
      if (!session.token) return;
      const favorites = await this.client.getFavorites(session.token);
      session.connected = true;
      session.lastError = undefined;

      for (const fav of favorites) {
        const row = this.toBattleRow(session.id, fav);
        if (!row) continue;

        const assigned = this.assignments.get(row.itemId);
        if (assigned && assigned !== session.id) continue;

        const key = `${session.id}:${row.itemId}`;
        const existing = this.rows.get(key);
        this.rows.set(key, existing ? { ...existing, ...row } : row);

        if (row.maxBid !== null && !this.active.has(key)) {
          this.active.add(key);
          void this.snipe(session, row, key).finally(() => this.active.delete(key));
        }
      }
    } catch (error) {
      session.connected = false;
      session.lastError = (error as Error).message;
      logError(`favorites ${session.id}: ${(error as Error).message}`);
    }
  }

  private toBattleRow(accountId: string, fav: FavoriteItem): BattleRow | null {
    const itemId = Number(fav.itemId ?? fav.ItemId);
    const sellerIdFromFav = Number(fav.sellerId ?? fav.SellerID ?? 0);
    const endTimeMs = Date.parse(String(fav.endTime ?? fav.EndTime ?? ''));
    if (!Number.isFinite(itemId) || !Number.isFinite(endTimeMs)) return null;

    const noteText = String(fav.notes ?? fav.Notes ?? '').trim();
    let maxBid: number | null = null;
    if (noteText.startsWith('{')) {
      try {
        const parsed = JSON.parse(noteText) as { max?: number };
        if (typeof parsed.max === 'number' && parsed.max > 0) maxBid = parsed.max;
      } catch {
        maxBid = null;
      }
    }

    const direct = this.directInput.get(itemId);
    const sellerId = direct?.sellerId || sellerIdFromFav;
    if (maxBid === null && direct) {
      maxBid = Number(fav.minimumBid ?? fav.currentPrice ?? 1);
    }

    const status = maxBid !== null ? 'LIVE TARGET' : 'FAVORITE';
    return {
      accountId,
      itemId,
      sellerId,
      title: fav.title ?? `Item ${itemId}`,
      imageUrl: String(fav.imageUrl ?? fav.imageURL ?? ''),
      currentPrice: Number(fav.currentPrice ?? 0),
      maxBid,
      endTimeMs: endTimeMs + this.clockOffsetMs,
      status
    };
  }

  private async snipe(session: AccountSession, row: BattleRow, key: string): Promise<void> {
    if (row.maxBid === null || row.sellerId <= 0) return;

    try {
      this.updateStatus(key, 'QUEUED');

      const warmAt = row.endTimeMs - 10_000;
      const fireAt = row.endTimeMs - (this.config.fireLeadMs + this.triggerAdjustMs);

      if (warmAt > Date.now()) {
        await sleep(warmAt - Date.now());
      }
      this.updateStatus(key, 'PRE-WARM');
      await this.client.warmBidConnection(session.token);

      await preciseCountdown(fireAt);

      const firstAmount = jitterBid(Math.max(row.maxBid - 1, 1), row.maxBid);
      const first = await this.client.placeBid(session.token, {
        itemId: row.itemId,
        sellerId: row.sellerId,
        bidAmount: firstAmount,
        bidType: 1,
        isProxy: true
      });

      if (first.isSuccess) {
        this.updateStatus(key, 'SNIPE SUCCESS', firstAmount);
        this.onUpdate({ type: 'alert', payload: { message: `[${session.id}] | WIN | Item #${row.itemId} | $${firstAmount.toFixed(2)}` } });
        return;
      }

      if (!/bid too low/i.test(first.message ?? '')) {
        this.updateStatus(key, `FAILED: ${first.message ?? 'unknown'}`, firstAmount);
        return;
      }

      const retryAmount = Number((firstAmount + 1).toFixed(2));
      if (retryAmount > row.maxBid) {
        this.updateStatus(key, 'FAILED: BID TOO LOW / ABOVE MAX', firstAmount);
        return;
      }

      const retry = await this.client.placeBid(session.token, {
        itemId: row.itemId,
        sellerId: row.sellerId,
        bidAmount: retryAmount,
        bidType: 1,
        isProxy: true
      });

      if (retry.isSuccess) {
        this.updateStatus(key, 'SNIPE SUCCESS (RETRY)', retryAmount);
        this.onUpdate({ type: 'alert', payload: { message: `[${session.id}] | WIN | Item #${row.itemId} | $${retryAmount.toFixed(2)}` } });
      } else {
        this.updateStatus(key, `FAILED: ${retry.message ?? 'unknown'}`, retryAmount);
      }
    } catch (error) {
      this.updateStatus(key, `ERROR: ${(error as Error).message}`);
    }
  }

  private updateStatus(key: string, status: string, lastBid?: number): void {
    const row = this.rows.get(key);
    if (!row) return;
    row.status = status;
    if (lastBid !== undefined) row.lastBid = lastBid;
    this.broadcastState();
  }

  private broadcastState(): void {
    this.onUpdate({ type: 'state', payload: this.snapshot() });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterBid(base: number, max: number): number {
  const floor = Math.floor(base);
  const cents = 1 + Math.floor(Math.random() * 98);
  const candidate = Number((floor + cents / 100).toFixed(2));
  if (candidate > max) {
    return Number(Math.min(max, base).toFixed(2));
  }
  return candidate;
}
