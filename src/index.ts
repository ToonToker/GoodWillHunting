import { loadAccounts, loadConfig } from './config.js';
import { logError, logInfo, logWarn } from './logger.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import { SniperEngine } from './sniperEngine.js';
import { getNtpOffsetMs } from './timing.js';
import type { AccountSession } from './types.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const accounts = await loadAccounts();
  const client = new ShopGoodwillClient(config);

  const clockOffsetMs = await getNtpOffsetMs();
  if (clockOffsetMs === 0) {
    logWarn('NTP sync unavailable; continuing with local system clock.');
  } else {
    logInfo(`NTP clock offset established: ${clockOffsetMs}ms.`);
  }

  const sessions: AccountSession[] = [];
  await Promise.all(
    accounts.map(async (account) => {
      const token = await client.login(account.username, account.password);
      sessions.push({
        accountId: account.id,
        username: account.username,
        password: account.password,
        token,
        tokenRefreshedAt: Date.now()
      });
      logInfo(`Logged in ${account.id}.`);
    })
  );

  const engine = new SniperEngine(client, config, sessions, clockOffsetMs);
  await engine.start();
}

void main().catch((error) => {
  logError((error as Error).message);
  process.exitCode = 1;
});
