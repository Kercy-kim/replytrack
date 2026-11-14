import test from 'node:test';
import assert from 'node:assert/strict';
import { WebOperation, elapsedLabel } from '../public/operations.js';

test('web cancellation during registration waits for acknowledgement; late running polls cannot replace cancelled state', async () => {
  let ack, deletes = 0;
  const api = async (_, method) => {
    if (method === 'POST') await new Promise(resolve => { ack = resolve; });
    if (method === 'DELETE') deletes++;
    return { state: method === 'DELETE' ? 'cancelled' : 'running', stage: 'reading', elapsedMs: 1700, events: [], error: { code: 'OPERATION_CANCELLED', message: '취소' } };
  };
  const op = new WebOperation(api, () => {}, { pollMs: 1 });
  const run = op.run('extract');
  await op.cancel(); assert.equal(deletes, 0);
  ack(); await assert.rejects(run, { code: 'OPERATION_CANCELLED' }); assert.equal(deletes, 1);
  op.update({ state: 'running', elapsedMs: 2000 }); assert.equal(op.snapshot.state, 'cancelled');
  assert.equal(elapsedLabel(65000), '1분 05초');
});

test('completed-before-cancel is applied as success and transient polling failures preserve the same job', async () => {
  let polls = 0, posts = 0; const seen = [];
  const api = async (_, method = 'GET') => {
    if (method === 'POST') { posts++; return { state: 'running', stage: 'analysis', elapsedMs: 10, events: [] }; }
    if (++polls === 1) throw new TypeError('offline');
    return { state: 'completed', result: { saved: true }, elapsedMs: 50, events: [] };
  };
  const op = new WebOperation(api, state => seen.push(state.warning), { pollMs: 1 });
  assert.deepEqual(await op.run('analyze'), { saved: true }); assert.equal(posts, 1); assert(seen.some(Boolean));
  await op.cancel(); assert.equal(op.snapshot.state, 'completed');
});

test('lost POST response recovers by client job ID without submitting twice', async () => {
  let posts = 0;
  const op = new WebOperation(async (_, method) => {
    if (method === 'POST') { posts++; throw new TypeError('lost response'); }
    return { state: 'completed', result: 'original result', elapsedMs: 0, events: [] };
  }, () => {});
  assert.equal(await op.run('extract'), 'original result'); assert.equal(posts, 1);
});

test('failed cancellation stays pending, can be retried, and completed-before-cancel returns committed result', async () => {
  let attempts = 0;
  const op = new WebOperation(async () => { if (!attempts++) throw new TypeError('offline'); return { state: 'completed', result: 'committed', elapsedMs: 10, events: [] }; }, () => {});
  op.acknowledged = true;
  await op.cancel(); assert.equal(op.snapshot.state, 'running'); assert.match(op.warning, /취소 확인/);
  await op.cancel(); assert.equal(op.snapshot.state, 'completed'); assert.equal(op.snapshot.result, 'committed');
});
