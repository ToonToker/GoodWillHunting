import express from 'express';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { WebSocketServer } from 'ws';
import { loadAccounts, loadConfig } from './config.js';
import { logError, logInfo, logWarn } from './logger.js';
import { LocalSessionStore } from './sessionStore.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import { SniperEngine } from './sniperEngine.js';
import { ntpOffsetMs } from './timing.js';
import type { AccountSession } from './types.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

async function boot(): Promise<void> {
  const config = loadConfig();
  const accounts = await loadAccounts();
  const client = new ShopGoodwillClient(config);
  const store = new LocalSessionStore('sessions.json');
  const tokenCache = await store.loadTokens();

  const offset = await ntpOffsetMs();
  if (offset === 0) logWarn('NTP unavailable, using local clock.');
  else logInfo(`NTP offset ${offset}ms`);

  const sessions: AccountSession[] = [];
  for (const account of accounts) {
    const cached = tokenCache.get(account.id);
    try {
      const token = cached ?? (await client.login(account.username, account.password));
      sessions.push({ id: account.id, username: account.username, password: account.password, token, refreshedAt: Date.now() });
      logInfo(`Account ready: ${account.id}`);
    } catch (error) {
      logError(`Login failed for ${account.id}: ${(error as Error).message}`);
    }
  }

  await mkdir(dirname('sessions.json'), { recursive: true }).catch(() => undefined);
  await store.save(sessions);
  setInterval(() => void store.save(sessions), 60_000).unref();

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const broadcast = (payload: unknown): void => {
    const message = JSON.stringify(payload);
    wss.clients.forEach((clientSocket) => {
      if (clientSocket.readyState === 1) clientSocket.send(message);
    });
  };

  const engine = new SniperEngine(client, config, sessions, offset, (event) => broadcast(event));
  engine.start();

  app.get('/api/state', (_req, res) => {
    res.json({ targets: engine.snapshot(), accounts: sessions.map((s) => ({ id: s.id, refreshedAt: s.refreshedAt })) });
  });

  app.post('/api/accounts/refresh', async (_req, res) => {
    for (const session of sessions) {
      session.token = await client.login(session.username, session.password);
      session.refreshedAt = Date.now();
    }
    await store.save(sessions);
    res.json({ ok: true });
  });

  app.post('/api/watch', (req, res) => {
    const url = String(req.body?.url ?? '');
    const idMatch = url.match(/\b(\d{5,})\b/);
    if (!idMatch) {
      res.status(400).json({ ok: false, message: 'Could not parse item id from URL.' });
      return;
    }
    engine.addDirectItem(Number(idMatch[1]));
    res.json({ ok: true, itemId: Number(idMatch[1]) });
  });

  server.listen(config.port, () => {
    logInfo(`Horus Dashboard listening on http://localhost:${config.port}`);
  });
}

void boot().catch((error) => {
  logError((error as Error).message);
  process.exitCode = 1;
});
