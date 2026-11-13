import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from './errors.mjs';

export class CaseStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`);
  }
  list() {
    return this.db.prepare('SELECT document FROM cases ORDER BY updated_at DESC').all().map(row => {
      const c = JSON.parse(row.document);
      return {
        id: c.id, title: c.title, company: c.company, mode: c.mode,
        updatedAt: c.updatedAt, createdAt: c.createdAt, version: c.version,
        questions: c.questions.length,
        unanswered: c.questions.filter(q => q.status !== 'answered').length,
        promises: c.promises.filter(p => !p.confirmedAt).length,
        pendingAnalysis: c.analyzedMessageCount < c.messages.length,
      };
    });
  }
  get(id) {
    const row = this.db.prepare('SELECT document FROM cases WHERE id = ?').get(id);
    if (!row) throw new AppError(404, '상담 기록을 찾을 수 없습니다.');
    return JSON.parse(row.document);
  }
  create(record) {
    const c = { ...record, version: 1 };
    this.db.prepare('INSERT INTO cases (id, version, document, updated_at) VALUES (?, ?, ?, ?)')
      .run(c.id, c.version, JSON.stringify(c), c.updatedAt);
    return c;
  }
  save(record, expectedVersion) {
    const c = { ...record, version: expectedVersion + 1, updatedAt: new Date().toISOString() };
    const result = this.db.prepare('UPDATE cases SET document = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')
      .run(JSON.stringify(c), c.version, c.updatedAt, c.id, expectedVersion);
    if (!result.changes) throw new AppError(409, '다른 작업에서 상담이 변경됐습니다. 최신 기록을 다시 불러와 주세요.', 'VERSION_CONFLICT');
    return c;
  }
  delete(id, expectedVersion) {
    const result = this.db.prepare('DELETE FROM cases WHERE id = ? AND version = ?').run(id, expectedVersion);
    if (!result.changes) throw new AppError(409, '상담 기록이 변경됐습니다. 새로고침 후 다시 시도해 주세요.', 'VERSION_CONFLICT');
  }
  close() { this.db.close(); }
}
