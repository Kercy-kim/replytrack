import { AppError, assert } from './errors.mjs';

export const cancelled = () => new AppError(409, '작업을 취소했어요. 입력과 기존 기록은 유지됩니다.', 'OPERATION_CANCELLED');
export function checkpoint(context = {}, stage) {
  if (context.signal?.aborted) throw context.signal.reason instanceof AppError ? context.signal.reason : cancelled();
  if (stage) context.onStage?.(stage);
  if (context.signal?.aborted) throw context.signal.reason instanceof AppError ? context.signal.reason : cancelled();
}

// Jobs live only in memory. A cancellation is acknowledged before any later result can commit.
export class Operations {
  constructor({ timeoutMs = 300000, retentionMs = 600000 } = {}) {
    this.jobs = new Map(); this.timeoutMs = timeoutMs; this.retentionMs = retentionMs;
  }
  start(id, task) {
    assert(typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id), '작업 ID를 확인해 주세요.');
    for (const [key, job] of this.jobs) if (job.finishedAt && Date.now() - job.finishedAt > this.retentionMs) this.remove(key);
    assert(!this.jobs.has(id), '이미 접수한 작업입니다. 상태를 확인해 주세요.', 409);
    assert([...this.jobs.values()].filter(j => j.state === 'running').length < 2, '다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.', 429);
    // Bound retained transcripts/results even under many short requests.
    if (this.jobs.size >= 100) for (const [key, job] of this.jobs) { if (job.finishedAt) { this.remove(key); break; } }
    const controller = new AbortController();
    const job = { id, state: 'running', stage: 'starting', startedAt: Date.now(), events: [], controller };
    this.jobs.set(id, job);
    const timer = setTimeout(() => this.stop(job, new AppError(504, '작업 시간이 초과됐어요. 입력과 기존 기록은 유지됩니다.', 'OPERATION_TIMEOUT')), this.timeoutMs);
    timer.unref();
    const context = { signal: controller.signal, onStage: stage => {
      if (job.state !== 'running') return;
      if (job.stage === stage) return;
      job.stage = stage; job.events.push({ stage, at: Date.now() });
    } };
    job.done = Promise.resolve().then(() => { checkpoint(context); return task(context); }).then(result => {
      if (job.state !== 'running') return;
      job.state = 'completed'; job.result = result; job.finishedAt = Date.now();
      this.expire(job);
    }, error => {
      if (job.state !== 'running') return;
      job.state = 'failed'; job.finishedAt = Date.now();
      job.error = this.error(error);
      this.expire(job);
    }).finally(() => clearTimeout(timer));
    return this.snapshot(job);
  }
  error(error) {
    return { status: error instanceof AppError ? error.status : 500, code: error.code || 'REQUEST_ERROR',
      message: error instanceof AppError ? error.message : '작업을 처리하지 못했어요. 입력과 기존 기록은 유지됩니다.' };
  }
  get(id) { const job = this.jobs.get(id); assert(job, '작업 상태를 찾을 수 없어요. 서버가 재시작됐거나 보관 시간이 지났습니다. 기록을 확인한 뒤 다시 시도해 주세요.', 404); return this.snapshot(job); }
  cancel(id) { this.get(id); const job = this.jobs.get(id); this.stop(job, cancelled()); return this.snapshot(job); }
  stop(job, reason) {
    if (job.state !== 'running') return;
    job.controller.abort(reason); job.state = reason.code === 'OPERATION_CANCELLED' ? 'cancelled' : 'failed';
    job.finishedAt = Date.now(); job.error = this.error(reason);
    this.expire(job);
  }
  snapshot(job) {
    return { id: job.id, state: job.state, stage: job.stage, startedAt: job.startedAt, finishedAt: job.finishedAt || null,
      elapsedMs: (job.finishedAt || Date.now()) - job.startedAt, events: job.events.slice(), ...(job.error ? { error: job.error } : {}),
      ...(job.state === 'completed' ? { result: job.result } : {}) };
  }
  expire(job) { job.expiry = setTimeout(() => this.remove(job.id), this.retentionMs); job.expiry.unref(); }
  remove(id) { clearTimeout(this.jobs.get(id)?.expiry); this.jobs.delete(id); }
  close() { for (const job of this.jobs.values()) { this.stop(job, cancelled()); this.remove(job.id); } }
}
