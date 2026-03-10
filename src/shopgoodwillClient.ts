import { Agent, request } from 'undici';
import type { AppConfig } from './config.js';
import type { FavoriteItem, FavoriteResponse, LoginResponse, PlaceBidResult } from './types.js';

export class ShopGoodwillClient {
  private readonly dispatcher: Agent;

  constructor(private readonly config: AppConfig) {
    this.dispatcher = new Agent({
      connections: 100,
      pipelining: 1,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 120_000
    });
  }

  async login(username: string, password: string): Promise<string> {
    const res = await request(`${this.config.baseUrl}/api/Login/ValidateUser`, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers: this.baseHeaders(),
      body: JSON.stringify({ username, password })
    });

    const body = (await res.body.json()) as LoginResponse;
    if (res.statusCode >= 400 || body.isSuccess === false) {
      throw new Error(`Login failed: ${body.message ?? `status=${res.statusCode}`}`);
    }

    const token = body.token ?? body.jwt;
    if (!token) throw new Error('Login response missing JWT token.');
    return token;
  }

  async getFavorites(token: string): Promise<FavoriteItem[]> {
    const res = await request(`${this.config.baseUrl}/api/Member/GetFavoriteItems`, {
      method: 'GET',
      dispatcher: this.dispatcher,
      headers: this.authHeaders(token)
    });

    const body = (await res.body.json()) as FavoriteResponse;
    if (res.statusCode >= 400) {
      throw new Error(`GetFavoriteItems failed with status ${res.statusCode}`);
    }

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
      // best effort
    }
  }

  async placeBid(token: string, itemId: number, amount: number): Promise<PlaceBidResult> {
    const res = await request(`${this.config.baseUrl}/api/Auction/PlaceBid`, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers: this.authHeaders(token),
      body: JSON.stringify({ itemId, bidAmount: amount })
    });

    const body = (await res.body.json()) as PlaceBidResult;
    if (res.statusCode >= 500) {
      throw new Error(`PlaceBid failed with status ${res.statusCode}`);
    }

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
    return {
      ...this.baseHeaders(),
      authorization: `Bearer ${token}`
    };
  }
}
