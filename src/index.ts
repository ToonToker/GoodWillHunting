import 'dotenv/config';
import { loadAccounts, loadConfig } from './config.js';
import { logInfo } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const accounts = await loadAccounts(config.accountsPath);
  logInfo(`Config loaded for ${accounts.length} account(s). Start the web server with: npm run dev`);
}

void main();
