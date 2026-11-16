import { AppError, assert } from './errors.mjs';

export const cancelled = () => new AppError(409, '작업을 취소했어요. 입력과 기존 기록은 유지됩니다.', 'OPERATION_CANCELLED');
export function checkpoint(context = {}, stage) {
  if (context.signal?.aborted) throw context.signal.reason instanceof AppError ? context.signal.reason : cancelled();
  if (stage) context.onStage?.(stage);
  if (context.signal?.aborted) throw context.signal.reason instanceof AppError ? context.signal.reason : cancelled();
}

// Jobs live only in memory. Cancellation is acknowledged before committing;
// once an asynchronous database commit starts, wait for its actual outcome.
export class Operations {
  constructor({ timeoutMs = 300000, retentionMs = 600000, queue = false, maxConcurrent = 2, queueTimeoutMs = 600000 } = {}) {
    this.jobs = new Map(); this.timeoutMs = timeoutMs; this.retentionMs = retentionMs;
    this.queue = queue; this.maxConcurrent = maxConcurrent; this.queueTimeoutMs = queueTimeoutMs; this.active = 0; this.closing = false;
  }
  validateStart(id, owner = 'local') {
    assert(typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id), '작업 ID를 확인해 주세요.');
    const existing = this.jobs.get(id);
    assert(!existing || existing.owner === owner, '작업 상태를 찾을 수 없어요.', 404);
    assert(!existing, '이미 접수한 작업입니다. 상태를 확인해 주세요.', 409);
    const pending = [...this.jobs.values()].filter(j => j.state === 'running');
    assert(!this.closing, '서버가 재시작 중입니다. 잠시 뒤 다시 시도해 주세요.', 503);
    assert(pending.length < (this.queue ? 12 : this.maxConcurrent), '다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.', 429);
    if (this.queue) assert(!pending.some(j => j.owner === owner), '내 다른 작업이 처리 중이에요. 완료하거나 취소한 뒤 다시 요청해 주세요.', 429);
  }
  start(id, task, owner = 'local', resource = 'general') {
    this.validateStart(id, owner);
    for (const [key, job] of this.jobs) if (job.finishedAt && Date.now() - job.finishedAt > this.retentionMs) this.remove(key);
    // Bound retained transcripts/results even under many short requests.
    if (this.jobs.size >= 100) for (const [key, job] of this.jobs) { if (job.finishedAt) { this.remove(key); break; } }
    const controller = new AbortController();
    const job = { id, owner, task, resource, state: 'running', stage: 'queued', startedAt: Date.now(), events: [], controller };
    job.done = new Promise(resolve => { job.resolve = resolve; });
    this.jobs.set(id, job);
    job.timer = setTimeout(() => this.stop(job, new AppError(504, '대기 시간이 초과됐어요. 다시 요청해 주세요.', 'OPERATION_TIMEOUT')), this.queueTimeoutMs);
    job.timer.unref();
    this.drain();
    return this.snapshot(job);
  }
  drain() {
    if (this.closing) return;
    for (const job of this.jobs.values()) {
      if (this.active >= this.maxConcurrent) break;
      if (job.state !== 'running' || job.executing) continue;
      if (job.resource === 'ocr' && [...this.jobs.values()].some(j => j.executing && j.resource === 'ocr')) continue;
      this.active++; job.executing = true; job.stage = 'starting';
      clearTimeout(job.timer);
      job.timer = setTimeout(() => this.stop(job, new AppError(504, '작업 시간이 초과됐어요. 입력과 기존 기록은 유지됩니다.', 'OPERATION_TIMEOUT')), this.timeoutMs);
      job.timer.unref(); this.execute(job);
    }
  }
  execute(job) {
    const context = { signal: job.controller.signal, commit: async save => {
      checkpoint(context); job.committing = true;
      try { return await save(); } finally { job.committing = false; }
    }, onStage: stage => {
      if (job.state !== 'running') return;
      if (job.stage === stage) return;
      job.stage = stage; job.events.push({ stage, at: Date.now() });
    } };
    Promise.resolve().then(() => { checkpoint(context); return job.task(context); }).then(result => {
      if (job.state !== 'running') return;
      job.state = 'completed'; job.result = result; job.finishedAt = Date.now();
      this.expire(job);
    }, error => {
      if (job.state !== 'running') return;
      job.state = 'failed'; job.finishedAt = Date.now();
      job.error = this.error(error);
      this.expire(job);
    }).finally(() => { clearTimeout(job.timer); job.task = null; job.executing = false; this.active--; job.resolve(); this.drain(); });
  }
  error(error) {
    return { status: error instanceof AppError ? error.status : 500, code: error.code || 'REQUEST_ERROR',
      message: error instanceof AppError ? error.message : '작업을 처리하지 못했어요. 입력과 기존 기록은 유지됩니다.' };
  }
  get(id, owner = 'local') { const job = this.jobs.get(id); assert(job && job.owner === owner, '작업 상태를 찾을 수 없어요. 서버가 재시작됐거나 보관 시간이 지났습니다. 기록을 확인한 뒤 다시 시도해 주세요.', 404); return this.snapshot(job); }
  cancel(id, owner = 'local') { this.get(id, owner); const job = this.jobs.get(id); this.stop(job, cancelled()); return this.snapshot(job); }
  cancelOwner(owner) { for (const job of this.jobs.values()) if (job.owner === owner) this.stop(job, cancelled()); }
  stop(job, reason) {
    if (job.state !== 'running') return;
    if (job.committing) return;
    job.controller.abort(reason); job.state = reason.code === 'OPERATION_CANCELLED' ? 'cancelled' : 'failed';
    clearTimeout(job.timer);
    if (!job.executing) { job.task = null; job.resolve(); }
    job.finishedAt = Date.now(); job.error = this.error(reason);
    this.expire(job);
  }
  snapshot(job) {
    return { id: job.id, state: job.state, stage: job.stage, startedAt: job.startedAt, finishedAt: job.finishedAt || null,
      elapsedMs: (job.finishedAt || Date.now()) - job.startedAt, events: job.events.slice(), ...(job.stage === 'queued' && job.state === 'running' ? { queuePosition: [...this.jobs.values()].filter(j => j.state === 'running' && !j.executing).findIndex(j => j.id === job.id) + 1 } : {}), ...(job.error ? { error: job.error } : {}),
      ...(job.state === 'completed' ? { result: job.result } : {}) };
  }
  expire(job) { job.expiry = setTimeout(() => this.remove(job.id), this.retentionMs); job.expiry.unref(); }
  remove(id) { clearTimeout(this.jobs.get(id)?.expiry); this.jobs.delete(id); }
  close() { this.closing = true; for (const job of this.jobs.values()) { this.stop(job, cancelled()); this.remove(job.id); } }
}
