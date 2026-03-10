import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { loadAccounts, loadConfig, saveAccounts } from './config.js';
import { logError, logInfo, logWarn } from './logger.js';
import { AssignmentStore } from './assignmentStore.js';
import { LocalSessionStore } from './sessionStore.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import { SniperEngine } from './sniperEngine.js';
import { TokenManager } from './tokenManager.js';
import type { AccountCredential, AccountSession } from './types.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

async function boot(): Promise<void> {
  const config = loadConfig();
  let accountVault = await loadAccounts(config.accountsPath);

  const client = new ShopGoodwillClient(config);
  const store = new LocalSessionStore('sessions.json');
  const assignmentStore = new AssignmentStore('assignments.json');
  const tokenCache = await store.loadTokens();
  const assignments = await assignmentStore.load();

  let offset = 0;
  try {
    offset = await client.getServerTimeOffsetMs();
    logInfo(`Server time sync offset=${offset}ms`);
  } catch {
    logWarn('Server time sync unavailable, using local clock.');
  }

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

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const broadcast = (payload: unknown): void => {
    const message = JSON.stringify(payload);
    wss.clients.forEach((clientSocket: WebSocket) => {
      if (clientSocket.readyState === 1) clientSocket.send(message);
    });
  };

  const engine = new SniperEngine(client, config, sessions, assignments, offset, triggerAdjustMs, (event) => broadcast(event));
  const tokenManager = new TokenManager(client, config, sessions, async () => {
    await store.save(sessions);
    broadcast({ type: 'accounts', payload: accountState(sessions) });
    await engine.pollFavorites();
  });

  engine.start();
  tokenManager.start();
  setInterval(() => void store.save(sessions), 60_000).unref();

  app.get('/api/state', (_req: Request, res: Response) => {
    res.json({
      triggerAdjustMs,
      avgRttMs,
      assignments: Object.fromEntries(assignments.entries()),
      targets: engine.snapshot(),
      accounts: accountState(sessions)
    });
  });

  app.post('/api/accounts/refresh', async (_req: Request, res: Response) => {
    await tokenManager.refreshAll();
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
    broadcast({ type: 'accounts', payload: accountState(sessions) });
    res.json({ ok: true });
  });

  app.delete('/api/accounts/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    accountVault = accountVault.filter((a) => a.id !== id);
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx >= 0) sessions.splice(idx, 1);

    for (const [itemId, accountId] of assignments.entries()) {
      if (accountId === id) assignments.delete(itemId);
    }

    await saveAccounts(config.accountsPath, accountVault);
    await assignmentStore.save(assignments);
    await store.save(sessions);
    broadcast({ type: 'accounts', payload: accountState(sessions) });
    res.json({ ok: true });
  });

  app.post('/api/assign', async (req: Request, res: Response) => {
    const itemId = Number(req.body?.itemId);
    const accountId = String(req.body?.accountId ?? '');
    if (!Number.isFinite(itemId)) {
      res.status(400).json({ ok: false, message: 'itemId required' });
      return;
    }
    if (accountId && !sessions.some((s) => s.id === accountId)) {
      res.status(404).json({ ok: false, message: 'account not found' });
      return;
    }

    engine.setAssignment(itemId, accountId);
    if (!accountId) assignments.delete(itemId);
    else assignments.set(itemId, accountId);
    await assignmentStore.save(assignments);
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
    logInfo(`GoodWillHunting Logos-Engine listening on http://localhost:${config.port}`);
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

function accountState(sessions: AccountSession[]): Array<{ id: string; username: string; refreshedAt: number; connected: boolean; lastError: string | null }> {
  return sessions.map((s) => ({
    id: s.id,
    username: s.username,
    refreshedAt: s.refreshedAt,
    connected: s.connected,
    lastError: s.lastError ?? null
  }));
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

    const nums = (parsed.pathname.match(/(\d{5,})/g) ?? []).map((n) => Number(n));
    if (nums.length >= 2) return { itemId: nums[0], sellerId: nums[1] };

    return null;
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
