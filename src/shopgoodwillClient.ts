import { Agent, request } from 'undici';
import type { AppConfig } from './config.js';
import { logApiRequest, logApiResponse } from './diagnostics.js';
import type { BidPayload, FavoriteItem, FavoriteResponse, ItemDetailResponse, LoginResponse, PlaceBidResult } from './types.js';

export class ShopGoodwillClient {
  private readonly dispatcher: Agent;

  constructor(private readonly config: AppConfig) {
    this.dispatcher = new Agent({ connections: 150, keepAliveTimeout: 30_000, keepAliveMaxTimeout: 120_000, pipelining: 1 });
  }

  async login(username: string, password: string): Promise<string> {
    const url = this.endpoint('SignIn/Login');
    const headers = this.baseHeaders();
    const bodyPayload = JSON.stringify({ userName: username, password, remember: false });

    logApiRequest({ label: 'auth.login', method: 'POST', url, headers });
    const { statusCode, text, json } = await this.requestJson<LoginResponse>(url, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers,
      body: bodyPayload
    }, 'auth.login');
    logApiResponse({ label: 'auth.login', statusCode, body: text });

    const response = json ?? {};
    if (statusCode >= 400 || response.isSuccess === false) throw new Error(response.message ?? `status ${statusCode}`);

    const token = response.token ?? (response.data && typeof response.data === 'object' ? String((response.data as Record<string, unknown>).token ?? '') : '') ?? '';
    const normalizedToken = token || response.jwt || '';
    if (!normalizedToken) throw new Error('Missing token in login response');
    return normalizedToken;
  }

  async getServerTimeOffsetMs(): Promise<number> {
    const start = Date.now();
    const url = this.config.apiBaseUrl;
    const headers = this.baseHeaders();

    logApiRequest({ label: 'time.head', method: 'HEAD', url, headers });
    const res = await request(url, {
      method: 'HEAD',
      dispatcher: this.dispatcher,
      headers
    });
    logApiResponse({ label: 'time.head', statusCode: res.statusCode, body: '' });

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
        await request(this.config.apiBaseUrl, {
          method: 'HEAD',
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
    const url = this.endpoint('Member/GetFavoriteItems');
    const headers = this.authHeaders(token);
    const { statusCode, json } = await this.requestJson<FavoriteResponse>(url, {
      method: 'GET',
      dispatcher: this.dispatcher,
      headers
    }, 'favorites.get');

    if (statusCode >= 400) throw new Error(`favorites status ${statusCode}`);
    return json?.data ?? json?.items ?? [];
  }

  async warmBidConnection(token: string): Promise<void> {
    try {
      const url = this.endpoint('Auction/PlaceBid');
      const headers = this.authHeaders(token);
      await this.requestJson<unknown>(url, {
        method: 'OPTIONS',
        dispatcher: this.dispatcher,
        headers
      }, 'bid.warm');
    } catch {
      return;
    }
  }

  async getItemDetail(itemId: number, token?: string): Promise<Record<string, unknown>> {
    const headers = token ? this.authHeaders(token) : this.baseHeaders();
    const url = this.endpoint(`Auction/GetItemDetail?itemId=${itemId}`);
    const { statusCode, json } = await this.requestJson<ItemDetailResponse>(url, {
      method: 'GET',
      dispatcher: this.dispatcher,
      headers
    }, 'auction.detail');

    if (statusCode >= 400) throw new Error(json?.message ?? `item detail status ${statusCode}`);

    const item = json?.data ?? json?.item;
    if (!item) throw new Error('Item detail response missing data payload');
    return item;
  }

  async placeBid(token: string, payload: BidPayload): Promise<PlaceBidResult> {
    const url = this.endpoint('Auction/PlaceBid');
    const headers = this.authHeaders(token);
    const { statusCode, json } = await this.requestJson<PlaceBidResult>(url, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers,
      body: JSON.stringify(payload)
    }, 'auction.placeBid');

    if (statusCode >= 500) throw new Error(`bid status ${statusCode}`);
    return json ?? { isSuccess: false, message: 'empty response' };
  }

  private async requestJson<T>(url: string, options: any, label: string): Promise<{ statusCode: number; text: string; json: T | null }> {
    logApiRequest({ label, method: options.method ?? 'GET', url, headers: normalizeHeaders(options.headers) });
    const res = await request(url, options);
    const text = await res.body.text();
    logApiResponse({ label, statusCode: res.statusCode, body: text });

    try {
      return { statusCode: res.statusCode, text, json: text ? (JSON.parse(text) as T) : null };
    } catch {
      return { statusCode: res.statusCode, text, json: null };
    }
  }

  private endpoint(path: string): string {
    return new URL(path, this.config.apiBaseUrl).toString();
  }

  private baseHeaders(): Record<string, string> {
    return {
      authority: 'buyerapi.shopgoodwill.com',
      'content-type': 'application/json',
      accept: 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      origin: 'https://www.shopgoodwill.com',
      referer: 'https://www.shopgoodwill.com/',
      'user-agent': this.config.userAgent
    };
  }

  private authHeaders(token: string): Record<string, string> {
    return { ...this.baseHeaders(), authorization: `Bearer ${token}` };
  }
}

function normalizeHeaders(headers: any): Record<string, string> {
  if (!headers || Array.isArray(headers)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = String(v);
  return out;
}
