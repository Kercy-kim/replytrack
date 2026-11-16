import { PGlite } from '@electric-sql/pglite';
import { Accounts } from '../../src/accounts.mjs';
import { PostgresStore } from '../../src/postgres.mjs';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

// Runs production SQL in PostgreSQL's WASM engine. Serialize connections because
// PGlite has one connection; real pg.Pool concurrency is checked in deployment.
export async function testDatabase(options = {}) {
  if (process.env.REPLYTRACK_TEST_DATABASE_URL) return networkDatabase(options);
  const db = new PGlite(); await db.waitReady;
  let tail = Promise.resolve();
  const lock = async () => { let release; const next = new Promise(r => release = r); const previous = tail; tail = next; await previous; return release; };
  const query = async (sql, args) => {
    const result = args ? await db.query(sql, args) : (await db.exec(sql)).at(-1);
    return { ...result, rowCount: result.affectedRows ?? result.rows?.length ?? 0 };
  };
  const pool = {
    query: async (...args) => { const release = await lock(); try { return await query(...args); } finally { release(); } },
    connect: async () => { const release = await lock(); return { query, release }; },
    end: () => db.close(),
  };
  const accounts = new Accounts(pool, options);
  await accounts.initialize('Local-test-admin-12345');
  return { pool, accounts, forUser: id => new PostgresStore(pool,id), close: () => pool.end() };
}

async function networkDatabase(options) {
  // Each test owns a new random schema; production public tables are untouched.
  const schema=`rt_test_${randomUUID().replaceAll('-','')}`;
  const pool=new Pool({connectionString:process.env.REPLYTRACK_TEST_DATABASE_URL,max:8,options:`-c search_path=${schema}`,connectionTimeoutMillis:15000,statement_timeout:20000});
  await pool.query(`CREATE SCHEMA ${schema}`);
  const close=async()=>{try { await pool.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await pool.end(); }};
  try {
    const accounts=new Accounts(pool,options);await accounts.initialize('Local-test-admin-12345');
    return {pool,accounts,forUser:id=>new PostgresStore(pool,id),close};
  } catch(error) { await close();throw error; }
}
