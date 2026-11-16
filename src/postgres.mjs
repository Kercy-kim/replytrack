import { Pool } from 'pg';
import { Accounts } from './accounts.mjs';
import { AppError, assert } from './errors.mjs';
import { summarizeCase } from './store.mjs';

export class PostgresStore {
  constructor(pool, ownerId) { this.pool = pool; this.ownerId = ownerId; }
  async list() {
    const { rows } = await this.pool.query('SELECT document FROM rt_cases WHERE owner_id=$1 ORDER BY updated_at DESC', [this.ownerId]);
    return rows.map(row => summarizeCase(row.document));
  }
  async get(id) {
    const { rows } = await this.pool.query('SELECT document FROM rt_cases WHERE id=$1 AND owner_id=$2', [id, this.ownerId]);
    if (!rows.length) throw new AppError(404, '상담 기록을 찾을 수 없습니다.');
    return rows[0].document;
  }
  async create(record) {
    const c = { ...record, version: 1 };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM rt_users WHERE id=$1 FOR UPDATE', [this.ownerId]);
      const { rows } = await client.query('SELECT count(*) AS total FROM rt_cases WHERE owner_id=$1', [this.ownerId]);
      assert(Number(rows[0].total) < 30, '문의는 30개까지 보관할 수 있어요. 필요 없는 기록을 정리해 주세요.', 409);
      await client.query('INSERT INTO rt_cases(id,owner_id,version,document,updated_at) VALUES($1,$2,$3,$4,$5)', [c.id, this.ownerId, 1, JSON.stringify(c), c.updatedAt]);
      await client.query('COMMIT'); return c;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async save(record, expectedVersion) {
    const c = { ...record, version: expectedVersion + 1, updatedAt: new Date().toISOString() };
    const data = JSON.stringify(c);
    assert(Buffer.byteLength(data) <= 2 * 1024 * 1024, '문의 기록이 너무 커서 저장할 수 없어요.', 413);
    const result = await this.pool.query('UPDATE rt_cases SET document=$1,version=$2,updated_at=$3 WHERE id=$4 AND owner_id=$5 AND version=$6', [data, c.version, c.updatedAt, c.id, this.ownerId, expectedVersion]);
    if (!result.rowCount) { await this.get(c.id); throw new AppError(409, '다른 작업에서 상담이 변경됐습니다. 최신 기록을 다시 불러와 주세요.', 'VERSION_CONFLICT'); }
    return c;
  }
  async delete(id, version) {
    const result = await this.pool.query('DELETE FROM rt_cases WHERE id=$1 AND owner_id=$2 AND version=$3', [id, this.ownerId, version]);
    if (!result.rowCount) { await this.get(id); throw new AppError(409, '상담 기록이 변경됐습니다. 새로고침 후 다시 시도해 주세요.', 'VERSION_CONFLICT'); }
  }
  close() {} // The application owns the shared pool.
}
export async function connectPostgres(connectionString, adminPassword, options = {}) {
  const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, statement_timeout: 15000, ...options });
  pool.on('error', () => console.error('Database connection interrupted.'));
  try {
    const accounts = new Accounts(pool);
    await accounts.initialize(adminPassword);
    return { pool, accounts, forUser: id => new PostgresStore(pool, id), close: () => pool.end() };
  } catch (error) { await pool.end(); throw error; }
}
