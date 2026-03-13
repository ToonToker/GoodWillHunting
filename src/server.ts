import 'dotenv/config';
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
import { SniperEngine, toBattleRowFromItemDetail } from './sniperEngine.js';
import { TokenManager } from './tokenManager.js';
import { logAuthState, logRouting, logWorkflow } from './diagnostics.js';
import type { AccountCredential, AccountSession } from './types.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

async function boot(): Promise<void> {
  const config = loadConfig();
  let accountVault = await loadAccounts(config.accountsPath);

  const client = new ShopGoodwillClient(config);
  const store = new LocalSessionStore('sessions.json', config.loginPersistenceConfirmationSwitch);
  const assignmentStore = new AssignmentStore('assignments.json');
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
    const session = await loginAccount(client, account);
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

  let authInProgress = false;

  engine.start();
  tokenManager.start();
  setInterval(() => void store.save(sessions), 60_000).unref();


  app.use('/api', (req: Request, res: Response, next) => {
    const from = safePathFromReferer(String(req.headers.referer ?? 'direct'));
    const to = req.originalUrl;
    logRouting({ from, to, method: req.method });
    res.on('finish', () => {
      const connectedAccounts = sessions.filter((s) => s.connected).length;
      const tokenAccounts = sessions.filter((s) => Boolean(s.token)).length;
      logAuthState('route-change', {
        activeSession: engine.hasActiveSession(),
        connectedAccounts,
        tokenAccounts,
        user: sessions.find((s) => s.connected && s.token)?.id
      });
      logRouting({ from, to, method: req.method, statusCode: res.statusCode });
    });
    next();
  });

  app.get('/api/state', (_req: Request, res: Response) => {
    res.json({
      triggerAdjustMs,
      avgRttMs,
      assignments: Object.fromEntries(assignments.entries()),
      targets: engine.snapshot(),
      accounts: accountState(sessions),
      activeSession: engine.hasActiveSession()
    });
  });

  app.post('/api/query', async (req: Request, res: Response) => {
    if (!engine.hasActiveSession()) {
      logWorkflow({ event: 'query.blocked.no-active-session', activeSession: false });
      res.status(503).json({ ok: false, message: 'No active session. Refresh accounts/login first.' });
      return;
    }

    const rawInput = String(req.body?.query ?? req.body?.itemId ?? '').trim();
    const match = rawInput.match(/(\d{7,10})/);
    const itemId = match ? Number.parseInt(match[0], 10) : null;
    const requestedAccount = String(req.body?.account ?? '').trim();
    if (!itemId || Number.isNaN(itemId)) {
      res.status(400).json({ ok: false, message: 'Provide a valid 9-digit Item ID or ShopGoodwill URL.' });
      return;
    }
    console.log(`[QUERY-ENGINE] Unified extraction success: ${itemId}`);
    if (requestedAccount && !sessions.some((s) => s.id === requestedAccount)) {
      res.status(404).json({ ok: false, message: 'account not found' });
      return;
    }
    if (requestedAccount && !sessions.some((s) => s.id === requestedAccount)) {
      res.status(404).json({ ok: false, message: 'account not found' });
      return;
    }

    try {
      const accountId = requestedAccount || (sessions.find((s) => s.connected && s.token)?.id ?? sessions[0]?.id ?? 'UNASSIGNED');
      const token = sessions.find((s) => s.id === accountId && s.connected && s.token)?.token;
      if (!token) {
        res.status(503).json({ ok: false, message: `No active bearer token for account ${accountId}.` });
        return;
      }
      const detail = await client.getItemDetail(itemId, token);
      const row = toBattleRowFromItemDetail(detail, accountId, offset, itemId);
      engine.addOrUpdateQueriedItem(row);
      assignments.set(row.itemId, accountId);
      await assignmentStore.save(assignments);
      res.json({ ok: true, itemId: row.itemId });
    } catch (error) {
      res.status(502).json({ ok: false, message: (error as Error).message });
    }
  });

  app.post('/api/confirm', (req: Request, res: Response) => {
    if (!engine.hasActiveSession()) {
      logWorkflow({ event: 'confirm.blocked.no-active-session', activeSession: false });
      res.status(503).json({ ok: false, message: 'No active session. Refresh accounts/login first.' });
      return;
    }

    const itemId = Number(req.body?.itemId);
    const maxBid = Number(req.body?.maxBid);
    if (!Number.isFinite(itemId) || !Number.isFinite(maxBid)) {
      res.status(400).json({ ok: false, message: 'itemId and maxBid are required.' });
      return;
    }

    try {
      engine.confirmItem(itemId, maxBid);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ ok: false, message: (error as Error).message });
    }
  });

  app.post('/api/accounts/refresh', async (_req: Request, res: Response) => {
    if (authInProgress) {
      res.status(429).json({ ok: false, message: 'Auth refresh already in progress' });
      return;
    }

    authInProgress = true;
    try {
      await tokenManager.refreshAll();
      await store.save(sessions);
      res.json({ ok: true });
    } finally {
      authInProgress = false;
    }
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

  server.listen(config.port, () => {
    logInfo(`GoodWillHunting Logos-Engine listening on http://localhost:${config.port}`);
  });
}

async function loginAccount(client: ShopGoodwillClient, account: AccountCredential | AccountSession): Promise<AccountSession> {
  try {
    const token = await client.login(account.username, account.password);
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

function accountState(sessions: AccountSession[]): Array<{ id: string; username: string; refreshedAt: number; connected: boolean; tokenLength: number; authState: 'online' | 'offline' | 'rejected'; lastError: string | null }> {
  return sessions.map((s) => {
    const lastError = s.lastError ?? null;
    const error = String(lastError ?? '').toLowerCase();
    const rejected =
      !s.connected &&
      (error.includes('authentication failed') ||
        error.includes('invalid credentials') ||
        error.includes('username or password') ||
        error.includes('denied request') ||
        error.includes('401') ||
        error.includes('403') ||
        error.includes('status.false'));

    return {
      id: s.id,
      username: s.username,
      refreshedAt: s.refreshedAt,
      connected: s.connected,
      tokenLength: s.token.length,
      authState: s.connected ? 'online' : rejected ? 'rejected' : 'offline',
      lastError
    };
  });
}

function safePathFromReferer(referer: string): string {
  try {
    if (!/^https?:\/\//i.test(referer)) return referer;
    return new URL(referer).pathname;
  } catch {
    return referer;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

void boot().catch((error) => {
  logError((error as Error).message);
  process.exitCode = 1;
});
