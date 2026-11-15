// Paid, synthetic fault-injection experiment. A completed real HTTP response is
// withheld until 75 s, representing a stalled transport, NOT a proven provider cause.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { OpenAIClient } from '../src/openai.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { unseenCases } from '../evals/unseen-cases.mjs';
import { grade } from '../evals/grade.mjs';
import { gradeReasons } from '../evals/reason-quality.mjs';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
assert(args.includes('--run'), 'Use --run for paid synthetic API testing.');
assert(process.env.OPENAI_API_KEY, 'Local API configuration required.');
const mode = option('--mode', 'after'), id = option('--case', 'NU02'), stage = option('--stage', 'initial');
assert(['before', 'after'].includes(mode)); assert(['initial', 'reply'].includes(stage));
const path = option('--out'); assert(path && !existsSync(path), 'Use a new --out path.');
const fixture = unseenCases.find(c => c.id === id); assert(fixture && (stage !== 'reply' || fixture.next));
const report = { mode, id, stage, holdMs: 75000, experiment: 'Injected delivery stall after an actual API response; not a naturally recurring 75-second API delay.',
  at: new Date().toISOString(), model: 'gpt-5-mini-2025-08-07', calls: [], providerRequests: [], stages: [],
  hashes: Object.fromEntries(['src/openai.mjs', 'src/ai-race.mjs', 'src/service.mjs', 'src/prompts.mjs', 'src/schema.mjs', 'scripts/check-analysis-tail.mjs'].map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])) };
mkdirSync(dirname(path), { recursive: true });
const save = () => writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
let phase = 'initial', injected = false;
const ai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: report.model, hedgeAfterMs: mode === 'before' ? 0 : 25000,
  fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body), start = performance.now();
    const hold = !injected && phase === stage && payload.text.format.name === 'replytrack_analysis';
    if (hold) injected = true;
    const entry = { phase, name: payload.text.format.name, injected: hold }; report.providerRequests.push(entry);
    try {
      const res = await fetch(url, options); const text = await res.text();
      entry.providerMs = Math.round(performance.now() - start); entry.status = res.status;
      try { entry.usage = JSON.parse(text).usage ?? null; } catch { /* Never save raw error bodies. */ }
      save();
      if (hold && res.ok) await sleep(Math.max(0, report.holdMs - (performance.now() - start)), null, { signal: options.signal });
      return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
    } catch (error) { entry.aborted = options.signal.aborted; save(); throw error; }
  } });
const measured = { async structured(input) {
  const start = performance.now();
  try { const result = await ai.structured(input); report.calls.push({ phase, name: input.name, ms: Math.round(performance.now() - start), ...result }); save(); return result; }
  catch (e) { report.calls.push({ phase, name: input.name, error: e.code, transport: e.transport }); save(); throw e; }
} };
const store = new CaseStore(':memory:'), svc = new ReplyTrack(store, measured);
async function analyze(c, expected, previous) {
  const started = performance.now(), record = await svc.analyze(c.id, c.version);
  const result = { phase, ms: Math.round(performance.now() - started), record, grade: grade(record, expected, previous), reasonGrade: gradeReasons(record, id) };
  report.stages.push(result); save(); assert(result.grade.pass && result.reasonGrade.pass, 'Analysis quality failed'); return record;
}
try {
  let c = svc.create({ title: fixture.title, messages: fixture.messages });
  c = await analyze(c, fixture.expected, null);
  if (stage === 'reply') {
    const previous = structuredClone(c); phase = 'reply';
    for (const m of fixture.next) c = svc.append(c.id, { ...m, version: c.version });
    c = await analyze(c, fixture.after, previous);
  }
  assert(injected);
  const target = report.calls.find(c => c.phase === stage && c.name === 'replytrack_analysis');
  assert.equal(target.transport.hedged, mode === 'after');
  assert(report.providerRequests.every(r => r.usage), 'Experiment must account for actual completed provider usage');
  report.observedProviderTokens = report.providerRequests.reduce((n, r) => n + r.usage.total_tokens, 0);
  report.passed = true;
} catch (error) { report.passed = false; report.error = { code: error.code, message: error.message }; process.exitCode = 1; }
finally { report.completedAt = new Date().toISOString(); save(); store.close(); console.log(JSON.stringify({ passed: report.passed, mode, id, stage, stages: report.stages.map(s => ({ phase: s.phase, ms: s.ms, pass: s.grade.pass })), error: report.error })); }
