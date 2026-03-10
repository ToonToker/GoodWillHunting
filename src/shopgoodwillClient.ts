import { Agent, request } from 'undici';
import type { AppConfig } from './config.js';
import type { FavoriteItem, FavoriteResponse, LoginResponse, PlaceBidResult } from './types.js';

export class ShopGoodwillClient {
  private readonly dispatcher: Agent;
  private token: string | null = null;

  constructor(private readonly config: AppConfig) {
    this.dispatcher = new Agent({
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 120_000,
      pipelining: 1,
      connections: 25
    });
  }

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  async login(username: string, password: string): Promise<string> {
    const payload = { username, password };
    const res = await request(`${this.config.baseUrl}/api/Login/ValidateUser`, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers: this.baseHeaders(),
      body: JSON.stringify(payload)
    });

    const body = (await res.body.json()) as LoginResponse;
    if (res.statusCode >= 400 || body.isSuccess === false) {
      throw new Error(`Login failed: ${body.message ?? `status=${res.statusCode}`}`);
    }

    const token = body.token ?? body.jwt;
    if (!token) {
      throw new Error('Login response missing JWT token.');
    }

    this.token = token;
    return token;
  }

  async getFavorites(): Promise<FavoriteItem[]> {
    const res = await request(`${this.config.baseUrl}/api/Member/GetFavoriteItems`, {
      method: 'GET',
      dispatcher: this.dispatcher,
      headers: this.authHeaders()
    });

    const body = (await res.body.json()) as FavoriteResponse;
    if (res.statusCode >= 400) {
      throw new Error(`GetFavoriteItems failed with status ${res.statusCode}`);
    }

    return body.data ?? body.items ?? [];
  }

  async warmBidConnection(): Promise<void> {
    try {
      await request(`${this.config.baseUrl}/api/Auction/PlaceBid`, {
        method: 'OPTIONS',
        dispatcher: this.dispatcher,
        headers: this.authHeaders()
      });
    } catch {
      // Best effort: keep-alive handshake can fail depending on API CORS/server behavior.
    }
  }

  async placeBid(itemId: number, amount: number): Promise<PlaceBidResult> {
    const res = await request(`${this.config.baseUrl}/api/Auction/PlaceBid`, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers: this.authHeaders(),
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

  private authHeaders(): Record<string, string> {
    if (!this.token) {
      throw new Error('JWT is not set. Login first.');
    }

    return {
      ...this.baseHeaders(),
      authorization: `Bearer ${this.token}`
    };
  }
}
