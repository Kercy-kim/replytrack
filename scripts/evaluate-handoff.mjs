import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fork } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performanceSummary } from '../evals/performance.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key)+1] : fallback;
const suite = option('--suite', 'handoff');
const profiles = { handoff: { dataset: 'evals/handoff-cases.json', baseline: '.artifacts/handoff-baseline' }, tail: { dataset: 'evals/handoff-tail-cases.json', baseline: '.artifacts/handoff-tail-baseline' } };
if (!profiles[suite]) throw Error('Unknown handoff suite');
const profile = profiles[suite];
const hash = value => createHash('sha256').update(value).digest('hex');
let lines, queue = [], waiting;
if (args.includes('--key-stdin') || args.includes('--interactive')) {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  lines = createInterface({ input: process.stdin, terminal: false });
  lines.on('line', line => { if (waiting) { const resolve = waiting; waiting = null; resolve(line); } else queue.push(line); });
}
const line = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { waiting = resolve; });
let apiKey = process.env.OPENAI_API_KEY || '';
if (args.includes('--key-stdin')) { console.log('Waiting for API key (hidden input; memory only).'); apiKey = (await line()).trim(); }
if (args.includes('--internal-ipc')) { apiKey = await new Promise(resolve => process.once('message', m => resolve(m.apiKey))); process.disconnect(); }
if (!apiKey) throw Error('API key required; no calls made.');

async function run({ out, only = '', variant = 'paired' }) {
  if (only === 'review-probes') return runReviewProbes(out);
  const output = resolve(root, out);
  if (existsSync(output)) throw Error('Refusing to overwrite prior results');
  const datasetPath = resolve(root, profile.dataset);
  const dataset = JSON.parse(readFileSync(datasetPath));
  const repairOnly = only === 'repair-probes';
  const selected = repairOnly ? (dataset.repairs || []) : dataset.cases.filter(c => !only || only.split(',').includes(c.id));
  if (!selected.length || (!repairOnly && only && selected.length !== new Set(only.split(',')).size)) throw Error('Unknown case selection');
  if (!['paired','current'].includes(variant)) throw Error('Unknown variant');
  const variants = variant === 'paired' ? ['before', 'after'] : ['after'];
  const modules = {}, sources = {}, productFiles = ['service.mjs','prompts.mjs','schema.mjs','domain.mjs','openai.mjs','ai-wire.mjs','store.mjs','analysis-changes.mjs'];
  for (const name of variants) {
    const dir = name === 'before' ? profile.baseline : '.';
    const module = file => import(pathToFileURL(resolve(root, dir, 'src', file)).href);
    const [service, store, client, domain] = await Promise.all([module('service.mjs'), module('store.mjs'), module('openai.mjs'), module('domain.mjs')]);
    modules[name] = { ...service, ...store, ...client, validateDraft: domain.validateDraft };
    const files = [...productFiles, ...(existsSync(resolve(root, dir, 'src/handoff.mjs')) ? ['handoff.mjs'] : [])];
    sources[name] = Object.fromEntries(files.map(f => [f, hash(readFileSync(resolve(root, dir, 'src', f)))]));
  }
  if (variants.includes('before') && readFileSync(resolve(root, profile.baseline, 'base.txt'), 'utf8') !== dataset.baseCommit) throw Error('Baseline commit mismatch');
  const report = { formatVersion: 1, suite, mode: repairOnly ? 'paired repair-only replay; initial failed generation/review excluded' : 'live paired handoff-only comparison', requestedModel: 'gpt-5-mini-2025-08-07', baseCommit: dataset.baseCommit,
    startedAt: new Date().toISOString(), fixtureHash: hash(readFileSync(datasetPath)), evaluatorHash: hash(readFileSync(fileURLToPath(import.meta.url))),
    performanceHash: hash(readFileSync(resolve(root, 'evals/performance.mjs'))), sources, variants, results: [] };
  const jobs = selected.flatMap(c => Array.from({ length: c.repetitions }, (_, repetition) => ({ c, repetition: repetition + 1 })));
  report.expectedResults = jobs.length * variants.length;
  mkdirSync(dirname(output), { recursive: true });
  function save() {
    report.performance = Object.fromEntries(variants.map(v => [v, performanceSummary(report.results.filter(r => r.variant === v))]));
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  save(); let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor++, { c, repetition } = jobs[index];
      // Alternate AB / BA per pair; two workers, at most two API requests concurrently.
      for (const name of index % 2 ? [...variants].reverse() : variants) {
        const { ReplyTrack, CaseStore, OpenAIClient, validateDraft } = modules[name];
        const store = new CaseStore(':memory:'), client = new OpenAIClient({ apiKey, model: report.requestedModel });
        const result = { id: `${c.id}#${repetition}`, caseId: c.id, repetition, variant: name, orderInPair: (index % 2 ? [...variants].reverse() : variants).indexOf(name), calls: [], operations: [] };
        let generations = 0;
        let replayReviewFailure = Boolean(c.repair);
        if (c.repair) {
          try { validateDraft(c.repair.draft,c.record); }
          catch { replayReviewFailure = false; } // A server-invalid seed never had an AI review to replay.
        }
        const ai = { async structured(input) {
          if (input.name === 'replytrack_draft') generations++;
          if (c.repair && generations === 1 && (input.name === 'replytrack_draft' || replayReviewFailure)) {
            const data = input.name === 'replytrack_draft' ? structuredClone(c.repair.draft) : { valid: false, feedback: c.repair.feedback };
            (result.replayedCalls ||= []).push({ name: input.name, data });
            return { data, model: 'replayed-initial-failure' };
          }
          const start = performance.now();
          try {
            const response = await client.structured(input);
            result.calls.push({ name: input.name, attempt: generations, effort: input.reasoningEffort, ms: Math.round(performance.now()-start), ...response }); return response;
          } catch (e) { result.calls.push({ name: input.name, attempt: generations, effort: input.reasoningEffort, ms: Math.round(performance.now()-start), error: { code: e.code, message: e.message } }); throw e; }
        } };
        const service = new ReplyTrack(store, ai), record = store.create({ ...structuredClone(c.record), drafts: {} });
        const start = performance.now(); let success = false;
        try {
          const saved = await service.draft(record.id, { version: record.version, kind: 'handoff', questionIds: record.questions.map(q => q.id) });
          result.draft = saved.drafts.handoff; result.semanticReview = 'Requires independent source/rubric review'; success = true;
        } catch (e) { result.error = { code: e.code, message: e.message }; }
        finally { result.operations.push({ kind: 'draft', ms: Math.round(performance.now()-start), success }); store.close(); }
        report.results.push(result); save();
        console.log(`${result.id} ${name}: ${success ? 'SAVED' : result.error.code} (${report.results.length}/${report.expectedResults})`);
        if (result.error?.code === 'AI_AUTH' || result.error?.code === 'AI_LIMIT') cursor = jobs.length;
      }
    }
  }
  await Promise.all([worker(), worker()]);
  report.completedAt = new Date().toISOString(); report.complete = report.results.length === report.expectedResults; save();
  console.log(JSON.stringify(report.performance));
  if (!report.complete || report.results.some(r => r.error)) process.exitCode = 1;
}
async function runReviewProbes(out) {
  const output = resolve(root, out);
  if (existsSync(output)) throw Error('Refusing to overwrite prior results');
  const datasetPath = resolve(root, profile.dataset), probesPath = resolve(root, 'evals/handoff-review-probes.json');
  const dataset = JSON.parse(readFileSync(datasetPath)), probes = JSON.parse(readFileSync(probesPath)).probes;
  const [{ OpenAIClient }, { draftSourceContext, draftQuestionContext }, { draftReviewSchema }, { HANDOFF_REVIEW_PROMPT }] = await Promise.all([
    import('../src/openai.mjs'), import('../src/service.mjs'), import('../src/schema.mjs'), import('../src/handoff.mjs'),
  ]);
  const model = 'gpt-5-mini-2025-08-07', client = new OpenAIClient({ apiKey, model });
  const report = { mode: 'live handoff reviewer controls; no generation', startedAt: new Date().toISOString(), requestedModel: model,
    fixtureHash: hash(readFileSync(datasetPath)), probesHash: hash(readFileSync(probesPath)), evaluatorHash: hash(readFileSync(fileURLToPath(import.meta.url))),
    sources: Object.fromEntries(['handoff.mjs','prompts.mjs','service.mjs','schema.mjs','openai.mjs'].map(f => [f, hash(readFileSync(resolve(root,'src',f)))])), results: [] };
  mkdirSync(dirname(output), { recursive: true });
  for (const probe of probes) {
    const record = dataset.cases.find(c => c.id === probe.caseId)?.record;
    if (!record) throw Error('Unknown probe case');
    const start = performance.now();
    try {
      const response = await client.structured({ name: 'replytrack_draft_review', schema: draftReviewSchema, instructions: HANDOFF_REVIEW_PROMPT, reasoningEffort: 'medium',
        data: { kind: 'handoff', ...draftSourceContext(record), questions: draftQuestionContext(record.questions), draft: probe.draft } });
      report.results.push({ ...probe, pass: response.data.valid === probe.expectedValid, ms: Math.round(performance.now()-start), ...response });
    } catch(e) { report.results.push({ ...probe, pass: false, error: { code: e.code, message: e.message } }); }
    writeFileSync(output, JSON.stringify(report,null,2)+'\n');
  }
  report.completedAt = new Date().toISOString(); report.complete = report.results.length === probes.length;
  writeFileSync(output, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.results.map(r => ({ id: r.id, pass: r.pass, feedback: r.data?.feedback, error: r.error }))));
  if (report.results.some(r => !r.pass)) process.exitCode = 1;
}
const runFresh = options => new Promise((resolve, reject) => {
  const target = options.control ? 'scripts/evaluate-ai.mjs' : 'scripts/evaluate-handoff.mjs';
  const params = options.control ? ['--only','draft-probes','--model','gpt-5-mini-2025-08-07'] : ['--only',options.only || '', '--variant',options.variant || 'paired','--suite',suite];
  const child = fork(resolvePath(target), ['--internal-ipc','--out',options.out,...params], { stdio: ['ignore','inherit','inherit','ipc'] });
  child.on('error', reject); child.on('exit', code => { if (code) process.exitCode = code; resolve(); }); child.send({ apiKey });
});
const resolvePath = file => resolve(root, file);
const execute = args.includes('--interactive') ? runFresh : run;
await execute({ out: option('--out','.artifacts/eval/handoff-paired.json'), only: option('--only',''), variant: option('--variant','paired') });
if (args.includes('--interactive')) {
  console.log('Ready: JSON with out/only/variant/control, or quit.');
  while (true) { const next = await line(); if (next.trim() === 'quit') break; try { await runFresh(JSON.parse(next)); } catch(e) { console.error(e.message); } console.log('Ready.'); }
}
if (process.stdin.isTTY && lines) process.stdin.setRawMode(false);
lines?.close(); process.stdin.pause();
