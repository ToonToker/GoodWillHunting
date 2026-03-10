import { readFile, writeFile } from 'node:fs/promises';
import type { AccountSession, SessionStore } from './types.js';

export class LocalSessionStore {
  constructor(private readonly path = 'sessions.json') {}

  async save(sessions: AccountSession[]): Promise<void> {
    const payload: SessionStore = {
      updatedAt: new Date().toISOString(),
      sessions: sessions.map((s) => ({ id: s.id, token: s.token, refreshedAt: s.refreshedAt }))
    };
    await writeFile(this.path, JSON.stringify(payload, null, 2), 'utf8');
  }

  async loadTokens(): Promise<Map<string, string>> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as SessionStore;
      return new Map((parsed.sessions ?? []).map((s) => [s.id, s.token]));
    } catch {
      return new Map();
    }
  }
}
