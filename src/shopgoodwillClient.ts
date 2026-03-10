import { Agent, request } from 'undici';
import type { AppConfig } from './config.js';
import type { BidPayload, FavoriteItem, FavoriteResponse, LoginResponse, PlaceBidResult } from './types.js';

export class ShopGoodwillClient {
  private readonly dispatcher: Agent;

  constructor(private readonly config: AppConfig) {
    this.dispatcher = new Agent({ connections: 150, keepAliveTimeout: 30_000, keepAliveMaxTimeout: 120_000, pipelining: 1 });
  }

  async login(username: string, password: string): Promise<string> {
    const res = await request(`${this.config.baseUrl}/api/Login/ValidateUser`, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers: this.baseHeaders(),
      body: JSON.stringify({ username, password })
    });
    const body = (await res.body.json()) as LoginResponse;
    if (res.statusCode >= 400 || body.isSuccess === false) throw new Error(body.message ?? `status ${res.statusCode}`);
    const token = body.token ?? body.jwt;
    if (!token) throw new Error('Missing token in login response');
    return token;
  }

  async getServerTimeOffsetMs(): Promise<number> {
    const start = Date.now();
    const res = await request(`${this.config.baseUrl}/api`, {
      method: 'HEAD',
      dispatcher: this.dispatcher,
      headers: this.baseHeaders()
    });
    const end = Date.now();
    const serverDateHeader = res.headers.date;
    if (!serverDateHeader) return 0;
    const serverTs = Date.parse(Array.isArray(serverDateHeader) ? serverDateHeader[0] : serverDateHeader);
    if (!Number.isFinite(serverTs)) return 0;
    const midpoint = start + (end - start) / 2;
    return serverTs - midpoint;
  }

  async measureApiRtt(sampleCount = 5): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < sampleCount; i += 1) {
      const start = process.hrtime.bigint();
      try {
        await request(`${this.config.baseUrl}/api`, {
          method: 'GET',
          dispatcher: this.dispatcher,
          headers: this.baseHeaders()
        });
      } catch {
        // transport-level timing sample
      }
      const elapsedNs = process.hrtime.bigint() - start;
      samples.push(Number(elapsedNs / 1_000_000n));
    }
    return samples.reduce((a, b) => a + b, 0) / Math.max(samples.length, 1);
  }

  async getFavorites(token: string): Promise<FavoriteItem[]> {
    const res = await request(`${this.config.baseUrl}/api/Member/GetFavoriteItems`, {
      method: 'GET',
      dispatcher: this.dispatcher,
      headers: this.authHeaders(token)
    });
    const body = (await res.body.json()) as FavoriteResponse;
    if (res.statusCode >= 400) throw new Error(`favorites status ${res.statusCode}`);
    return body.data ?? body.items ?? [];
  }

  async warmBidConnection(token: string): Promise<void> {
    try {
      await request(`${this.config.baseUrl}/api/Auction/PlaceBid`, {
        method: 'OPTIONS',
        dispatcher: this.dispatcher,
        headers: this.authHeaders(token)
      });
    } catch {
      return;
    }
  }

  async placeBid(token: string, payload: BidPayload): Promise<PlaceBidResult> {
    const res = await request(`${this.config.baseUrl}/api/Auction/PlaceBid`, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers: this.authHeaders(token),
      body: JSON.stringify(payload)
    });
    const body = (await res.body.json()) as PlaceBidResult;
    if (res.statusCode >= 500) throw new Error(`bid status ${res.statusCode}`);
    return body;
  }

  private baseHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': this.config.userAgent,
      origin: 'https://shopgoodwill.com',
      referer: 'https://shopgoodwill.com/'
    };
  }

  private authHeaders(token: string): Record<string, string> {
    return { ...this.baseHeaders(), authorization: `Bearer ${token}` };
  }
}
