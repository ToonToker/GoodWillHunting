import type { AppConfig } from './config.js';
import { logError } from './logger.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import { preciseCountdown } from './timing.js';
import { logWorkflow } from './diagnostics.js';
import type { AccountSession, BattleRow, FavoriteItem, TargetStatus } from './types.js';

interface UpdateEvent {
  type: 'state' | 'alert';
  payload: unknown;
}

export class SniperEngine {
  private readonly rows = new Map<number, BattleRow>();
  private readonly active = new Set<number>();

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

  hasActiveSession(): boolean {
    return this.sessions.some((s) => s.connected && Boolean(s.token));
  }

  setAssignment(itemId: number, accountId: string): void {
    const row = this.rows.get(itemId);
    if (!row) return;
    const next = accountId || this.defaultAccountId();
    if (next) row.accountId = next;
    if (!accountId) this.assignments.delete(itemId);
    else this.assignments.set(itemId, accountId);
    this.broadcastState();
  }

  addOrUpdateQueriedItem(row: BattleRow): void {
    const existing = this.rows.get(row.itemId);
    this.rows.set(row.itemId, existing ? { ...existing, ...row, status: existing.status } : row);
    this.emitMaaKheru(row.itemId, row.accountId || 'AUTO', 'UNCONFIRMED');
    this.broadcastState();
  }

  confirmItem(itemId: number, maxBid: number): { ok: true } {
    const row = this.rows.get(itemId);
    if (!row) throw new Error('Item not found in local list. Query it first.');
    if (Date.now() >= row.endTimeMs) {
      row.status = 'ended';
      this.broadcastState();
      throw new Error('Auction already ended.');
    }
    if (maxBid <= row.currentPrice) throw new Error('Max bid must be higher than current bid.');

    row.maxBid = Number(maxBid.toFixed(2));
    row.status = 'confirmed';
    row.stepBid = 1;
    this.broadcastState();
    this.emitMaaKheru(itemId, row.accountId, 'CONFIRMED');
    this.maybeStartSnipes();
    return { ok: true };
  }

  snapshot(): BattleRow[] {
    return Array.from(this.rows.values()).sort((a, b) => a.endTimeMs - b.endTimeMs);
  }

  async pollFavorites(): Promise<void> {
    if (!this.hasActiveSession()) {
      logWorkflow({ event: 'poll.skip.no-active-session', activeSession: false });
      this.broadcastState();
      return;
    }

    await Promise.all(this.sessions.map((s) => this.pollForAccount(s)));
    this.updateEndedStatuses();
    this.maybeStartSnipes();
    this.broadcastState();
  }

  private async pollForAccount(session: AccountSession): Promise<void> {
    try {
      if (!session.token) return;
      const favorites = await this.client.getFavorites(session.token);
      session.connected = true;
      session.lastError = undefined;
      logWorkflow({ event: 'poll.session-awake', activeSession: true, detail: `account=${session.id} connected=1` });

      for (const fav of favorites) {
        const itemId = Number(fav.itemId ?? fav.ItemId);
        if (!Number.isFinite(itemId)) continue;
        const row = this.rows.get(itemId);
        if (!row) continue;

        this.applyFavoriteUpdate(row, fav);
        const assigned = this.assignments.get(itemId);
        if (assigned && row.accountId !== assigned) row.accountId = assigned;
      }
    } catch (error) {
      session.connected = false;
      session.lastError = (error as Error).message;
      logError(`favorites ${session.id}: ${(error as Error).message}`);
    }
  }

  private applyFavoriteUpdate(row: BattleRow, fav: FavoriteItem): void {
    const currentPrice = Number(fav.currentPrice ?? row.currentPrice);
    if (Number.isFinite(currentPrice) && currentPrice > 0) row.currentPrice = currentPrice;

    const endTimeMs = Date.parse(String(fav.endTime ?? fav.EndTime ?? ''));
    if (Number.isFinite(endTimeMs)) row.endTimeMs = endTimeMs + this.clockOffsetMs;

    const title = String(fav.title ?? '').trim();
    if (title) row.title = title;

    const imageUrl = String(fav.imageUrl ?? fav.imageURL ?? '').trim();
    if (imageUrl) row.imageUrl = imageUrl;

    const sellerId = Number(fav.sellerId ?? fav.SellerID ?? row.sellerId);
    if (Number.isFinite(sellerId) && sellerId > 0) row.sellerId = sellerId;
  }

  private maybeStartSnipes(): void {
    if (!this.hasActiveSession()) {
      logWorkflow({ event: 'schedule.blocked.no-active-session', activeSession: false });
      return;
    }

    for (const row of this.rows.values()) {
      if (row.status !== 'confirmed') continue;
      if (Date.now() >= row.endTimeMs) {
        row.status = 'ended';
        continue;
      }
      if (this.active.has(row.itemId)) continue;

      const session = this.sessionForRow(row);
      if (!session || !session.token) continue;

      this.active.add(row.itemId);
      logWorkflow({ event: 'schedule.dispatch', itemId: row.itemId, activeSession: true, detail: `account=${session.id}` });
      void this.snipe(session, row).finally(() => this.active.delete(row.itemId));
    }
  }

  private sessionForRow(row: BattleRow): AccountSession | undefined {
    return this.sessions.find((s) => s.id === row.accountId && s.connected && Boolean(s.token));
  }

  private async snipe(session: AccountSession, row: BattleRow): Promise<void> {
    if (row.maxBid === null || row.sellerId <= 0) return;

    try {
      row.status = 'sniping';
      this.broadcastState();

      const warmAt = row.endTimeMs - 10_000;
      const fireAt = row.endTimeMs - this.config.fireLeadMs;

      if (warmAt > Date.now()) await sleep(warmAt - Date.now());
      await this.client.warmBidConnection(session.token);
      await preciseCountdown(fireAt);

      const firstAmount = jitterBid(Math.max(row.maxBid - row.stepBid, 1), row.maxBid);
      const first = await this.client.placeBid(session.token, {
        itemId: row.itemId,
        sellerId: row.sellerId,
        bidAmount: firstAmount,
        bidType: 1,
        isProxy: true
      });

      if (first.isSuccess) {
        row.status = 'win';
        row.lastBid = firstAmount;
        this.emitMaaKheru(row.itemId, session.id, 'WIN');
        this.broadcastState();
        return;
      }

      row.lastBid = firstAmount;
      row.status = Date.now() >= row.endTimeMs ? 'ended' : 'failed';
      this.emitMaaKheru(row.itemId, session.id, row.status.toUpperCase());
      this.broadcastState();
    } catch (error) {
      row.status = 'failed';
      this.emitMaaKheru(row.itemId, session.id, `ERROR ${(error as Error).message}`);
      this.broadcastState();
    }
  }

  private updateEndedStatuses(): void {
    for (const row of this.rows.values()) {
      if (Date.now() >= row.endTimeMs && (row.status === 'unconfirmed' || row.status === 'confirmed' || row.status === 'sniping')) {
        row.status = 'ended';
      }
    }
  }

  private defaultAccountId(): string {
    return this.sessions.find((s) => s.connected && s.token)?.id ?? this.sessions[0]?.id ?? '';
  }

  private emitMaaKheru(itemId: number, accountId: string, status: string): void {
    this.onUpdate({ type: 'alert', payload: { message: `[${itemId}] | [${accountId}] | [${status}]` } });
  }

  private broadcastState(): void {
    this.onUpdate({ type: 'state', payload: this.snapshot() });
  }
}

export function toBattleRowFromItemDetail(
  detail: Record<string, unknown>,
  accountId: string,
  clockOffsetMs: number,
  fallbackItemId: number
): BattleRow {
  const itemId = Number(detail.itemId ?? detail.ItemId ?? fallbackItemId);
  const sellerId = Number(detail.sellerId ?? detail.SellerID ?? 0);
  const endTimeRaw = String(detail.endTime ?? detail.EndTime ?? detail.endDate ?? detail.EndDate ?? '');
  const parsedEnd = Date.parse(endTimeRaw);
  const endTimeMs = Number.isFinite(parsedEnd) ? parsedEnd + clockOffsetMs : Date.now() + 60_000;
  const currentPrice = Number(detail.currentPrice ?? detail.CurrentPrice ?? detail.minimumBid ?? detail.MinimumBid ?? 0);
  const title = String(detail.title ?? detail.Title ?? `Item ${itemId}`);
  const imageUrl = String(detail.imageUrl ?? detail.ImageUrl ?? detail.imageURL ?? detail.ImageURL ?? '');

  return {
    accountId,
    itemId,
    sellerId,
    title,
    imageUrl,
    currentPrice: Number.isFinite(currentPrice) ? currentPrice : 0,
    maxBid: null,
    stepBid: 1,
    endTimeMs,
    status: 'unconfirmed' satisfies TargetStatus
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterBid(base: number, max: number): number {
  const floor = Math.floor(base);
  const cents = 1 + Math.floor(Math.random() * 98);
  const candidate = Number((floor + cents / 100).toFixed(2));
  if (candidate > max) return Number(Math.min(max, base).toFixed(2));
  return candidate;
}
