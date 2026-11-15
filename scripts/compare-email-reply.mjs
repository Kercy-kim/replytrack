// Paired, interleaved real API comparison using identical synthetic saved records.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { emailReplyPlan } from '../src/email-reply.mjs';
import { analysisSchemaFor } from '../src/schema.mjs';
assert(process.argv.includes('--run'), 'Use --run for paid synthetic tests.');
process.loadEnvFile('.env');
const output = process.env.EMAIL_COMPARE_REPORT || '.artifacts/email-reply-compare.json';
assert(!existsSync(output), 'Choose a new report path.');
const saved = JSON.parse(readFileSync('evals/results/live-browser/inquiry-overview.json')).cases.find(c => c.name === 'email');
const effort = process.env.EMAIL_COMPARE_EFFORT || 'low';
const report = { at: new Date().toISOString(), effort, hashes: Object.fromEntries(['src/email-reply.mjs', 'src/service.mjs', 'scripts/compare-email-reply.mjs'].map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])), trials: [] };
const save = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2)); };
for (let round = 0; round < 3; round++) {
  for (const variant of round % 2 ? ['compact', 'baseline'] : ['baseline', 'compact']) {
    const entry = { round, variant, calls: [] }; report.trials.push(entry);
    const store = new CaseStore(':memory:');
    const c = structuredClone(saved.initial); c.messages = structuredClone(saved.updated.messages);
    const record = store.create(c), plan = emailReplyPlan(record);
    assert(plan);
    const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini-2025-08-07' });
    const service = new ReplyTrack(store, { configured: true, async structured(args) {
      const first = args.name === 'replytrack_analysis' && !args.data.revisionFeedback;
      const compact = variant === 'compact' && first;
      const start = Date.now();
      const instructions = args.instructions.replace(plan.instructions, '');
      let r = await client.structured(first ? { ...args, schema: compact ? plan.schema : analysisSchemaFor(record.messages, 'email'), reasoningEffort: compact ? effort : 'medium', instructions: instructions + (compact ? plan.instructions : '') } : args);
      entry.calls.push({ name: args.name, ms: Date.now() - start, usage: r.usage, transport: r.transport });
      if (compact) r = { ...r, data: plan.restore(r.data) };
      save(); return r;
    } });
    try {
      const at = Date.now(); entry.result = await service.analyze(record.id, record.version); entry.ms = Date.now() - at;
      assert.deepEqual(entry.result.questions.map(q => q.status).sort(), ['answered', 'answered', 'unanswered']);
      assert.deepEqual(entry.result.questions.map(q => q.id).sort(), c.questions.map(q => q.id).sort());
      assert.deepEqual(entry.result.warnings, []);
      assert(entry.result.promises.some(p => p.state === 'reported' && /received your transaction ID/.test(p.evidence.quote)));
      // A long quote may mention that recovery has NOT happened; inspect the action, not a banned keyword in source text.
      assert.equal(entry.result.promises.length, 1);
      assert(entry.result.promises.every(p => !p.confirmedAt && p.state === 'reported' && /거래|ID|아이디/.test(p.title) && p.dueText === ''));
      entry.passed = true;
    } catch (e) { entry.passed = false; entry.error = e.message; process.exitCode = 1; }
    finally { store.close(); save(); console.log(`${round} ${variant}: ${entry.ms}ms ${entry.passed ? 'PASS' : entry.error}`); }
  }
}
