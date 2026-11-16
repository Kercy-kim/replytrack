import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { assert } from './errors.mjs';

const scrypt = promisify(scryptCallback);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const publicUser = u => ({ id: u.id, username: u.username, role: u.role });
export function credentials(input) {
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  assert(/^[a-z0-9][a-z0-9_-]{2,23}$/.test(username), '아이디는 영문 소문자·숫자·밑줄·하이픈 3~24자로 입력해 주세요.');
  assert(typeof input.password === 'string' && input.password.length >= 12 && input.password.length <= 128, '비밀번호는 12~128자로 입력해 주세요.');
  return { username, password: input.password };
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function checkPassword(password, encoded) {
  const [salt, hex] = encoded.split(':');
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
export const cookieName = 'replytrack_session';
export function sessionCookie(token, secure, clear = false) {
  return `${cookieName}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 604800}${secure ? '; Secure' : ''}`;
}
export function readSession(req) {
  const value = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

// All identity, invite, session and quota state is in PostgreSQL, not a browser ID.
export class Accounts {
  constructor(pool, { participants = 10, dailyLimit = 30 } = {}) {
    this.pool = pool; this.participants = participants; this.dailyLimit = dailyLimit;
  }
  async transaction(fn) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async initialize(adminPassword) {
    assert(typeof adminPassword === 'string' && adminPassword.length >= 16 && adminPassword.length <= 128, '관리자 초기 비밀번호는 16~128자여야 합니다.');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS rt_control (id integer PRIMARY KEY);
      INSERT INTO rt_control(id) VALUES(1) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS rt_users (id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','participant')), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS rt_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES rt_users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS rt_invites (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL, used_by text REFERENCES rt_users(id), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS rt_cases (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES rt_users(id), version integer NOT NULL, document jsonb NOT NULL, updated_at timestamptz NOT NULL);
      CREATE INDEX IF NOT EXISTS rt_cases_owner_updated ON rt_cases(owner_id,updated_at DESC);
      CREATE TABLE IF NOT EXISTS rt_auth_limits (bucket text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS rt_usage (user_id text NOT NULL REFERENCES rt_users(id), day date NOT NULL, count integer NOT NULL, PRIMARY KEY(user_id,day));
      CREATE TABLE IF NOT EXISTS rt_reservations (operation_id text PRIMARY KEY, user_id text NOT NULL REFERENCES rt_users(id), created_at timestamptz NOT NULL DEFAULT now());
    `);
    this.dummyHash = await hashPassword(secret());
    await this.transaction(async client => {
      await client.query('SELECT id FROM rt_control WHERE id=1 FOR UPDATE');
      const found = await client.query("SELECT id FROM rt_users WHERE role='admin'");
      if (!found.rows.length) await client.query('INSERT INTO rt_users(id,username,password_hash,role) VALUES($1,$2,$3,$4)', [randomUUID(), 'replytrack', await hashPassword(adminPassword), 'admin']);
    });
  }
  async limit(bucket, max) {
    const result = await this.pool.query(`INSERT INTO rt_auth_limits(bucket,count,expires_at) VALUES($1,1,now()+interval '10 minutes')
      ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN rt_auth_limits.expires_at<now() THEN 1 ELSE rt_auth_limits.count+1 END,
      expires_at=CASE WHEN rt_auth_limits.expires_at<now() THEN now()+interval '10 minutes' ELSE rt_auth_limits.expires_at END RETURNING count`, [bucket]);
    assert(result.rows[0].count <= max, '로그인 시도가 많아요. 10분 뒤 다시 시도해 주세요.', 429);
  }
  async login(input) {
    await this.limit('global', 100);
    const { username, password } = credentials(input);
    await this.limit(`login:${username}`, 10);
    const { rows } = await this.pool.query('SELECT * FROM rt_users WHERE username=$1', [username]);
    const ok = await checkPassword(password, rows[0]?.password_hash || this.dummyHash);
    assert(ok && rows[0], '아이디 또는 비밀번호를 확인해 주세요.', 401);
    await this.pool.query('DELETE FROM rt_auth_limits WHERE bucket=$1 OR expires_at<now()', [`login:${username}`]);
    return this.newSession(rows[0]);
  }
  async newSession(user) {
    const token = secret();
    await this.transaction(async client => {
      await client.query('DELETE FROM rt_sessions WHERE expires_at<now()');
      await client.query('INSERT INTO rt_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'7 days\')', [digest(token), user.id]);
    });
    return { user: publicUser(user), token };
  }
  async authenticate(token) {
    if (!token) return null;
    const { rows } = await this.pool.query('SELECT u.id,u.username,u.role FROM rt_sessions s JOIN rt_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [digest(token)]);
    return rows[0] || null;
  }
  async logout(token) { if (token) await this.pool.query('DELETE FROM rt_sessions WHERE token_hash=$1', [digest(token)]); }
  async invite(user) {
    assert(user.role === 'admin', '관리자만 초대 코드를 만들 수 있어요.', 403);
    const code = secret();
    await this.transaction(async client => {
      await client.query('SELECT id FROM rt_control WHERE id=1 FOR UPDATE');
      const { rows } = await client.query("SELECT (SELECT count(*) FROM rt_users WHERE role='participant')+(SELECT count(*) FROM rt_invites WHERE used_by IS NULL AND expires_at>now()) AS total");
      assert(Number(rows[0].total) < this.participants, '참여자와 사용 가능한 초대 코드는 합쳐서 10개까지 만들 수 있어요.', 409);
      await client.query('INSERT INTO rt_invites(token_hash,expires_at) VALUES($1,now()+interval \'14 days\')', [digest(code)]);
    });
    return { code, expiresInDays: 14 };
  }
  async register(input) {
    await this.limit('global', 100);
    await this.limit('registration', 30);
    const { username, password } = credentials(input);
    assert(typeof input.invite === 'string' && /^[A-Za-z0-9_-]{43}$/.test(input.invite), '초대 코드를 확인해 주세요.');
    assert(username !== 'replytrack', '다른 아이디를 사용해 주세요.', 409);
    const passwordHash = await hashPassword(password);
    const user = await this.transaction(async client => {
      await client.query('SELECT id FROM rt_control WHERE id=1 FOR UPDATE');
      const invite = await client.query('SELECT token_hash FROM rt_invites WHERE token_hash=$1 AND used_by IS NULL AND expires_at>now() FOR UPDATE', [digest(input.invite)]);
      assert(invite.rows.length, '사용할 수 없는 초대 코드입니다. 관리자에게 확인해 주세요.');
      const count = await client.query("SELECT count(*) AS total FROM rt_users WHERE role='participant'");
      assert(Number(count.rows[0].total) < this.participants, '참여 인원이 모두 등록됐어요.', 409);
      const exists = await client.query('SELECT id FROM rt_users WHERE username=$1', [username]);
      assert(!exists.rows.length, '이미 사용 중인 아이디입니다.', 409);
      const u = { id: randomUUID(), username, role: 'participant' };
      await client.query('INSERT INTO rt_users(id,username,password_hash,role) VALUES($1,$2,$3,$4)', [u.id, username, passwordHash, u.role]);
      await client.query('UPDATE rt_invites SET used_by=$1 WHERE token_hash=$2', [u.id, digest(input.invite)]);
      return u;
    });
    return this.newSession(user);
  }
  async usage(user) {
    const { rows } = await this.pool.query("SELECT count FROM rt_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'Asia/Seoul')::date", [user.id]);
    return { used: rows[0]?.count || 0, limit: user.role === 'admin' ? 100 : this.dailyLimit };
  }
  async reserve(user, operationId) {
    await this.transaction(async client => {
      await client.query('SELECT id FROM rt_users WHERE id=$1 FOR UPDATE', [user.id]);
      const previous = await client.query('SELECT user_id FROM rt_reservations WHERE operation_id=$1', [operationId]);
      assert(!previous.rows.length, '이미 접수한 요청입니다.', 409);
      const { rows } = await client.query("SELECT count FROM rt_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'Asia/Seoul')::date", [user.id]);
      assert((rows[0]?.count || 0) < (user.role === 'admin' ? 100 : this.dailyLimit), '오늘의 AI 작업 한도에 도달했어요. 저장된 기록은 계속 볼 수 있습니다.', 429);
      await client.query('INSERT INTO rt_reservations(operation_id,user_id) VALUES($1,$2)', [operationId, user.id]);
      await client.query("INSERT INTO rt_usage(user_id,day,count) VALUES($1,(now() AT TIME ZONE 'Asia/Seoul')::date,1) ON CONFLICT(user_id,day) DO UPDATE SET count=rt_usage.count+1", [user.id]);
      await client.query("DELETE FROM rt_reservations WHERE created_at<now()-interval '2 days'");
    });
  }
}
