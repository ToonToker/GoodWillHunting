import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class TokenVault {
  constructor(private readonly tokenPath = '.secrets/sgw.jwt') {}

  async save(token: string): Promise<void> {
    await mkdir(dirname(this.tokenPath), { recursive: true });
    await writeFile(this.tokenPath, token, { encoding: 'utf8', mode: 0o600 });
    await chmod(this.tokenPath, 0o600);
  }

  async load(): Promise<string | null> {
    try {
      return (await readFile(this.tokenPath, 'utf8')).trim();
    } catch {
      return null;
    }
  }
}
