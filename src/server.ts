import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { loadAccounts, loadConfig, saveAccounts } from './config.js';
import { logError, logInfo, logWarn } from './logger.js';
import { LocalSessionStore } from './sessionStore.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import { SniperEngine } from './sniperEngine.js';
import { ntpOffsetMs } from './timing.js';
import type { AccountCredential, AccountSession } from './types.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

async function boot(): Promise<void> {
  const config = loadConfig();
  let accountVault = await loadAccounts(config.accountsPath);

  const client = new ShopGoodwillClient(config);
  const store = new LocalSessionStore('sessions.json');
  const tokenCache = await store.loadTokens();

  const offset = await ntpOffsetMs();
  if (offset === 0) logWarn('NTP unavailable, using local clock.');
  else logInfo(`NTP offset ${offset}ms`);

  const avgRttMs = await client.measureApiRtt(5);
  const triggerAdjustMs = clamp(Math.round((avgRttMs - 200) / 2), -100, 100);
  logInfo(`Latency audit avg RTT=${avgRttMs.toFixed(1)}ms, Berkland adjust=${triggerAdjustMs}ms`);

  const sessions: AccountSession[] = [];
  for (const account of accountVault) {
    const session = await loginAccount(client, account, tokenCache.get(account.id));
    sessions.push(session);
  }

  await mkdir(dirname('sessions.json'), { recursive: true }).catch(() => undefined);
  await store.save(sessions);
  setInterval(() => void store.save(sessions), 60_000).unref();

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const broadcast = (payload: unknown): void => {
    const message = JSON.stringify(payload);
    wss.clients.forEach((clientSocket: WebSocket) => {
      if (clientSocket.readyState === 1) clientSocket.send(message);
    });
  };

  const engine = new SniperEngine(client, config, sessions, offset, triggerAdjustMs, (event) => broadcast(event));
  engine.start();

  app.get('/api/state', (_req: Request, res: Response) => {
    res.json({
      triggerAdjustMs,
      avgRttMs,
      targets: engine.snapshot(),
      accounts: sessions.map((s) => ({
        id: s.id,
        username: s.username,
        refreshedAt: s.refreshedAt,
        connected: s.connected,
        lastError: s.lastError ?? null
      }))
    });
  });

  app.post('/api/accounts/refresh', async (_req: Request, res: Response) => {
    for (const session of sessions) {
      const refreshed = await loginAccount(client, session);
      session.token = refreshed.token;
      session.refreshedAt = refreshed.refreshedAt;
      session.connected = refreshed.connected;
      session.lastError = refreshed.lastError;
    }
    await store.save(sessions);
    res.json({ ok: true });
  });

  app.post('/api/accounts', async (req: Request, res: Response) => {
    const body = req.body as Partial<AccountCredential>;
    if (!body.id || !body.username || !body.password) {
      res.status(400).json({ ok: false, message: 'id, username, password required' });
      return;
    }
    if (accountVault.some((a) => a.id === body.id)) {
      res.status(409).json({ ok: false, message: 'Account id already exists' });
      return;
    }

    const newAccount: AccountCredential = { id: body.id, username: body.username, password: body.password };
    const session = await loginAccount(client, newAccount);
    accountVault = [...accountVault, newAccount];
    sessions.push(session);
    await saveAccounts(config.accountsPath, accountVault);
    await store.save(sessions);
    res.json({ ok: true });
  });

  app.delete('/api/accounts/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    accountVault = accountVault.filter((a) => a.id !== id);
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx >= 0) sessions.splice(idx, 1);
    await saveAccounts(config.accountsPath, accountVault);
    await store.save(sessions);
    res.json({ ok: true });
  });

  app.post('/api/watch', (req: Request, res: Response) => {
    const url = String(req.body?.url ?? '');
    const parsed = parseWatchUrl(url);
    if (!parsed) {
      res.status(400).json({ ok: false, message: 'Could not parse itemId/sellerId from URL.' });
      return;
    }
    engine.addDirectItem(parsed.itemId, parsed.sellerId);
    res.json({ ok: true, ...parsed });
  });

  server.listen(config.port, () => {
    logInfo(`Horus Dashboard Omega listening on http://localhost:${config.port}`);
  });
}

async function loginAccount(client: ShopGoodwillClient, account: AccountCredential | AccountSession, cached?: string): Promise<AccountSession> {
  try {
    const token = cached ?? (await client.login(account.username, account.password));
    return {
      id: account.id,
      username: account.username,
      password: account.password,
      token,
      refreshedAt: Date.now(),
      connected: true
    };
  } catch (error) {
    return {
      id: account.id,
      username: account.username,
      password: account.password,
      token: '',
      refreshedAt: Date.now(),
      connected: false,
      lastError: (error as Error).message
    };
  }
}

function parseWatchUrl(url: string): { itemId: number; sellerId: number } | null {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const parsed = new URL(normalized);
    const itemParam = Number(parsed.searchParams.get('itemid') ?? parsed.searchParams.get('itemId'));
    const sellerParam = Number(parsed.searchParams.get('sellerid') ?? parsed.searchParams.get('sellerId'));

    if (Number.isFinite(itemParam) && Number.isFinite(sellerParam)) {
      return { itemId: itemParam, sellerId: sellerParam };
    }

    const itemMatch = parsed.pathname.match(/(\d{5,})/g);
    if (!itemMatch || itemMatch.length < 2) return null;
    return { itemId: Number(itemMatch[0]), sellerId: Number(itemMatch[1]) };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

void boot().catch((error) => {
  logError((error as Error).message);
  process.exitCode = 1;
});
