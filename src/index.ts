import { loadConfig } from './config.js';
import { logError, logInfo } from './logger.js';
import { ShopGoodwillClient } from './shopgoodwillClient.js';
import { SniperEngine } from './sniperEngine.js';
import { TokenVault } from './tokenVault.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const vault = new TokenVault();
  const client = new ShopGoodwillClient(config);

  const existingToken = await vault.load();
  if (existingToken) {
    client.setToken(existingToken);
    logInfo('Loaded JWT from secure vault.');
  } else {
    logInfo('No JWT found in vault; performing login anchor flow.');
    const token = await client.login(config.username, config.password);
    await vault.save(token);
    logInfo('JWT acquired and stored in vault.');
  }

  const engine = new SniperEngine(client, config);
  await engine.start();
}

void main().catch((error) => {
  logError((error as Error).message);
  process.exitCode = 1;
});
