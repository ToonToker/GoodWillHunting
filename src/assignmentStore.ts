import { readFile, writeFile } from 'node:fs/promises';
import type { AssignmentMap } from './types.js';

export class AssignmentStore {
  constructor(private readonly path = 'assignments.json') {}

  async load(): Promise<Map<number, string>> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as AssignmentMap;
      const map = new Map<number, string>();
      for (const [itemId, accountId] of Object.entries(parsed)) {
        const id = Number(itemId);
        if (Number.isFinite(id) && accountId) map.set(id, accountId);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  async save(assignments: Map<number, string>): Promise<void> {
    const out: AssignmentMap = {};
    for (const [itemId, accountId] of assignments.entries()) {
      out[String(itemId)] = accountId;
    }
    await writeFile(this.path, JSON.stringify(out, null, 2), 'utf8');
  }
}
