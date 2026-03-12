import { Agent, request } from 'undici';
import type { AppConfig } from './config.js';
import { logApiRequest, logApiResponse } from './diagnostics.js';
import type { BidPayload, FavoriteItem, FavoriteResponse, ItemDetailResponse, LoginResponse, PlaceBidResult } from './types.js';

export class ShopGoodwillClient {
  private readonly dispatcher: Agent;
  private loginInFlight: Promise<string> | null = null;
  private nextLoginAttemptAt = 0;
  private readonly cookieJar = new Map<string, string>();
  private readonly handshakeUserAgent: string;

  constructor(private readonly config: AppConfig) {
    this.dispatcher = new Agent({ connections: 150, keepAliveTimeout: 30_000, keepAliveMaxTimeout: 120_000, pipelining: 1 });
    this.handshakeUserAgent = this.config.userAgent;
  }

  async login(username: string, password: string): Promise<string> {
    if (this.loginInFlight) return this.loginInFlight;

    const waitMs = this.nextLoginAttemptAt - Date.now();
    if (waitMs > 0) throw new Error(`Auth back-off active. Retry in ${Math.ceil(waitMs / 1000)}s`);

    this.loginInFlight = (async () => {
      await this.preflightSessionCookie();

      const url = this.endpoint('SignIn/Login');
      const payload = { UserName: username, Password: password };
      console.log('[DEBUG-PAYLOAD]', JSON.stringify({ ...payload, Password: '****' }));

      const { statusCode, json, text, headers } = await this.requestJson<LoginResponse>(
        url,
        {
          method: 'POST',
          dispatcher: this.dispatcher,
          headers: this.baseHeaders(),
          body: JSON.stringify(payload)
        },
        'auth.login'
      );

      const setCookie = headers['set-cookie'] ?? '';
      console.log('[DEBUG-COOKIES]', setCookie);
      this.captureSetCookie(setCookie);

      const response = json ?? {};
      if (response.status === false) {
        this.nextLoginAttemptAt = Date.now() + 60_000;
        console.error('API Rejected Credentials:', response.message ?? text);
        logApiResponse({ label: 'auth.login.status.false', statusCode, body: text });
        throw new Error(response.message ?? 'Authentication failed (status=false)');
      }

      if (statusCode >= 400 || response.isSuccess === false) {
        this.nextLoginAttemptAt = Date.now() + 60_000;
        throw new Error(response.message ?? `status ${statusCode}`);
      }

      const token =
        response.token ??
        response.accessToken ??
        (response.data && typeof response.data === 'object' ? String((response.data as Record<string, unknown>).token ?? '') : '') ??
        '';
      const normalizedToken = token || response.jwt || response.refreshToken || '';
      if (!normalizedToken) {
        this.nextLoginAttemptAt = Date.now() + 60_000;
        logApiResponse({ label: 'auth.login.missing-token', statusCode, body: text });
        throw new Error('Missing token in login response');
      }

      this.nextLoginAttemptAt = 0;
      return normalizedToken;
    })();

    try {
      return await this.loginInFlight;
    } finally {
      this.loginInFlight = null;
    }
  }


  async getServerTimeOffsetMs(): Promise<number> {
    const start = Date.now();
    const url = this.config.apiBaseUrl;

    const res = await request(url, {
      method: 'HEAD',
      dispatcher: this.dispatcher,
      headers
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
    const { statusCode, json } = await this.requestJson<FavoriteResponse>(
      url,
      {
        method: 'GET',
        dispatcher: this.dispatcher,
        headers: this.authHeaders(token)
      },
      'favorites.get'
    );

    if (statusCode >= 400) throw new Error(`favorites status ${statusCode}`);
    return json?.data ?? json?.items ?? [];
  }

  async warmBidConnection(token: string): Promise<void> {
    try {
      await this.requestJson<unknown>(
        this.endpoint('Auction/PlaceBid'),
        {
          method: 'OPTIONS',
          dispatcher: this.dispatcher,
          headers: this.authHeaders(token)
        },
        'bid.warm'
      );
    } catch {
      return;
    }
  }

  async getItemDetail(itemId: number, token?: string): Promise<Record<string, unknown>> {
    const { statusCode, json } = await this.requestJson<ItemDetailResponse>(
      this.endpoint(`Auction/GetItemDetail?itemId=${itemId}`),
      {
        method: 'GET',
        dispatcher: this.dispatcher,
        headers: token ? this.authHeaders(token) : this.baseHeaders()
      },
      'auction.detail'
    );

    if (statusCode >= 400) throw new Error(json?.message ?? `item detail status ${statusCode}`);
    const item = json?.data ?? json?.item;
    if (!item) throw new Error('Item detail response missing data payload');
    return item;
  }

  async placeBid(token: string, payload: BidPayload): Promise<PlaceBidResult> {
    const { statusCode, json } = await this.requestJson<PlaceBidResult>(
      this.endpoint('Auction/PlaceBid'),
      {
        method: 'POST',
        dispatcher: this.dispatcher,
        headers: this.authHeaders(token),
        body: JSON.stringify(payload)
      },
      'auction.placeBid'
    );

    if (statusCode >= 500) throw new Error(`bid status ${statusCode}`);
    return json ?? { isSuccess: false, message: 'empty response' };
  }

  private async preflightSessionCookie(): Promise<void> {
    let currentUrl = 'https://www.shopgoodwill.com/SignIn/';
    const maxRedirects = 5;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const headers = {
        origin: 'https://www.shopgoodwill.com',
        referer: 'https://www.shopgoodwill.com/',
        'user-agent': this.handshakeUserAgent,
        accept: 'text/html,application/xhtml+xml',
        ...(this.buildCookieHeader() ? { cookie: this.buildCookieHeader() } : {})
      };

      logApiRequest({ label: 'auth.preflight', method: 'GET', url: currentUrl, headers });
      const res = await request(currentUrl, {
        method: 'GET',
        dispatcher: this.dispatcher,
        headers
      });

      const setCookie = res.headers['set-cookie'] ?? '';
      console.log('[DEBUG-COOKIES]', setCookie);
      this.captureSetCookie(setCookie);
      logApiResponse({ label: 'auth.preflight', statusCode: res.statusCode, body: '' });

      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        currentUrl = new URL(String(res.headers.location), currentUrl).toString();
        continue;
      }

      console.log('[DEBUG-PREFLIGHT-FINAL-URL]', currentUrl);
      return;
    }

    console.log('[DEBUG-PREFLIGHT-FINAL-URL]', currentUrl);
  }


  private captureSetCookie(raw: string | string[] | undefined): void {
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const cookie of cookies) {
      const [pair, ...attributes] = cookie.split(';').map((x) => x.trim());
      if (!pair) continue;
      const [name, ...rest] = pair.split('=');
      if (!name || rest.length === 0) continue;
      const value = rest.join('=');
      this.cookieJar.set(name, value);

      const domainAttr = attributes.find((a) => /^domain=/i.test(a));
      const domain = domainAttr ? domainAttr.split('=')[1] : '(host-only)';
      const trappedAzure = /azurewebsites\.net/i.test(domain);
      if (trappedAzure) {
        console.log(`[DEBUG-COOKIE-DOMAIN] name=${name} domain=${domain} action=strip-domain-for-buyerapi`);
      } else {
        console.log(`[DEBUG-COOKIE-DOMAIN] name=${name} domain=${domain}`);
      }
    }

    const affinityCookies = ['TiPMix', 'x-ms-routing-name'];
    for (const affinity of affinityCookies) {
      if (!this.cookieJar.has(affinity)) {
        // keep explicit diagnostic visibility for required Azure/traffic-manager affinity cookies
        console.log(`[DEBUG-COOKIE-DOMAIN] name=${affinity} domain=missing`);
      }
    }
  }

  private async requestJson<T>(url: string, options: any, label: string): Promise<{ statusCode: number; text: string; json: T | null; headers: Record<string, string | string[]> }> {
    const headers = normalizeHeaders(options.headers);
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) headers.cookie = cookieHeader;
    options.headers = headers;

    logApiRequest({ label, method: options.method ?? 'GET', url, headers });
    const res = await request(url, options);
    const setCookie = res.headers['set-cookie'] ?? '';
    if (setCookie) this.captureSetCookie(setCookie);
    const text = await res.body.text();
    logApiResponse({ label, statusCode: res.statusCode, body: text });

    try {
      return { statusCode: res.statusCode, text, json: text ? (JSON.parse(text) as T) : null, headers: normalizeResponseHeaders(res.headers as Record<string, unknown>) };
    } catch {
      return { statusCode: res.statusCode, text, json: null, headers: normalizeResponseHeaders(res.headers as Record<string, unknown>) };
    }
  }

  private buildCookieHeader(): string {
    if (this.cookieJar.size === 0) return '';
    return Array.from(this.cookieJar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
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
      'user-agent': this.handshakeUserAgent
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

function normalizeResponseHeaders(headers: Record<string, unknown>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string' || Array.isArray(v)) out[k] = v;
  }
  return out;
}
