import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { execFileSync, fork } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from '../evals/support-cases.mjs';
import { grade, summarize } from '../evals/grade.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { DRAFT_REVIEW_PROMPT } from '../src/prompts.mjs';
import { draftReviewSchema } from '../src/schema.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['evals/support-cases.mjs', 'evals/grade.mjs', 'src/prompts.mjs', 'src/schema.mjs', 'src/domain.mjs', 'src/service.mjs', 'src/openai.mjs', 'src/analysis-changes.mjs', 'scripts/evaluate-ai.mjs'];
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (args.includes('--help')) {
  console.log('Live evaluation (paid API calls): node --env-file=.env scripts/evaluate-ai.mjs --out .artifacts/eval/run.json [--only S01,R03] [--model gpt-5-mini]\n--key-stdin accepts one hidden line; --interactive keeps credentials in memory for another run after code changes. Never writes the key.\nScore saved output offline: node scripts/evaluate-ai.mjs --rescore path/to/run.json');
  process.exit(0);
}
if (args.includes('--rescore')) {
  const report = JSON.parse(readFileSync(option('--rescore'), 'utf8'));
  if (report.hashes['evals/support-cases.mjs'] !== hash(readFileSync(resolve(root, 'evals/support-cases.mjs')))) throw new Error('Dataset hash mismatch');
  for (const result of report.results) {
    const testCase = cases.find(c => c.id === result.id);
    result.stages.forEach((stage, i) => { if (stage.record) stage.grade = grade(stage.record, i ? testCase.after : testCase.expected, i ? result.stages[i-1].record : null); });
  }
  console.log(JSON.stringify(summarize(report.results), null, 2));
  process.exit(0);
}

let lines, lineQueue = [], waiter;
if (args.includes('--key-stdin') || args.includes('--interactive')) {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  lines = createInterface({ input: process.stdin, terminal: false });
  lines.on('line', line => { if (waiter) { const resolve = waiter; waiter = null; resolve(line); } else lineQueue.push(line); });
  process.stdin.on('data', chunk => { if (chunk.includes(3)) process.exit(130); });
}
const readLine = () => lineQueue.length ? Promise.resolve(lineQueue.shift()) : new Promise(resolve => { waiter = resolve; });
let apiKey = process.env.OPENAI_API_KEY || '';
if (args.includes('--key-stdin')) { console.log('Waiting for API key (hidden input; memory only).'); apiKey = (await readLine()).trim(); }
if (args.includes('--internal-ipc')) {
  apiKey = await new Promise(resolve => process.once('message', message => resolve(message.apiKey)));
  process.disconnect();
}
if (!apiKey) throw new Error('Set OPENAI_API_KEY or use --key-stdin. No calls made.');

async function run({ out, only = '', model = process.env.OPENAI_MODEL || 'gpt-5-mini' }) {
  if (only === 'draft-probes') return runDraftProbes({ out, model });
  const selected = only ? cases.filter(c => only.split(',').includes(c.id)) : cases;
  if (!selected.length || (only && selected.length !== new Set(only.split(',')).size)) throw new Error('Unknown or empty case selection');
  const outputPath = resolve(root, out);
  if (existsSync(outputPath)) throw new Error('Output already exists; use a new filename to preserve prior results');
  const report = { formatVersion: 1, startedAt: new Date().toISOString(), mode: 'live OpenAI Responses API', requestedModel: model,
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    hashes: Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(resolve(root, file)))])), results: [] };
  mkdirSync(dirname(outputPath), { recursive: true });
  const save = () => { report.summary = summarize(report.results); writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n'); };
  save();
  const client = new OpenAIClient({ apiKey, model });
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const testCase = selected[cursor++], store = new CaseStore(':memory:');
      const result = { id: testCase.id, category: testCase.category, title: testCase.title, stages: [], calls: [] };
      const ai = { async structured(input) {
        const start = performance.now();
        try {
          const response = await client.structured(input);
          result.calls.push({ name: input.name, reasoningEffort: input.reasoningEffort || 'low', ms: Math.round(performance.now()-start), model: response.model, usage: response.usage, data: response.data });
          return response;
        } catch (error) {
          result.calls.push({ name: input.name, ms: Math.round(performance.now()-start), error: { code: error.code || 'UNKNOWN', message: error.message } });
          throw error;
        }
      } };
      const service = new ReplyTrack(store, ai);
      async function analyze(record, expected, previous) {
        const saved = await service.analyze(record.id, record.version);
        result.stages.push({ record: saved, grade: grade(saved, expected, previous) });
        return saved;
      }
      try {
        let record = service.create({ title: testCase.title, company: '가상 고객센터', messages: testCase.messages });
        record = await analyze(record, testCase.expected, null);
        if (testCase.next) {
          const previous = structuredClone(record);
          for (const m of testCase.next) record = service.append(record.id, { ...m, version: record.version });
          record = await analyze(record, testCase.after, previous);
        }
        if (testCase.draft) {
          const selectedQuestions = record.questions.filter(q => q.status !== 'answered');
          try {
            record = await service.draft(record.id, { version: record.version, kind: testCase.draft, questionIds: selectedQuestions.map(q => q.id) });
            result.draft = { kind: testCase.draft, ...record.drafts[testCase.draft], semanticReview: 'pending independent semantic review' };
          } catch (error) { result.draft = { kind: testCase.draft, error: { code: error.code || 'UNKNOWN', message: error.message } }; }
        }
      } catch (error) { result.error = { code: error.code || 'UNKNOWN', message: error.message }; }
      finally { store.close(); }
      report.results.push(result); report.results.sort((a,b) => cases.findIndex(c => c.id === a.id) - cases.findIndex(c => c.id === b.id)); save();
      console.log(`${testCase.id}: ${result.error ? result.error.code : result.stages.every(s => s.grade.pass) ? 'PASS' : 'REVIEW'} (${report.results.length}/${selected.length})`);
      if (result.error?.code === 'AI_AUTH' || result.error?.code === 'AI_LIMIT') cursor = selected.length;
    }
  }
  await Promise.all([worker(), worker()]);
  report.completedAt = new Date().toISOString(); report.complete = report.results.length === selected.length; save();
  console.log(JSON.stringify(report.summary));
  if (!report.complete || report.results.some(r => r.error || r.draft?.error || r.stages.some(s => !s.grade.pass))) process.exitCode = 1;
}
async function runDraftProbes({ out, model }) {
  // Test the new product reviewer against real failed outputs preserved from earlier runs.
  // These are review-only calls, not additional generated/evaluated conversations.
  const path = resolve(root, out);
  if (existsSync(path)) throw new Error('Output already exists');
  const probes = [['iteration-3', 'S02', '선택한 배송비 질문 누락'], ['iteration-3', 'S06', '원문에 없는 동일 상담원 추정'], ['baseline', 'R02', '상담원 입장으로 고객 정보 요구']];
  const client = new OpenAIClient({ apiKey, model });
  const report = { mode: 'live draft review negative probes', startedAt: new Date().toISOString(), requestedModel: model,
    hashes: Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(resolve(root, file)))])), results: [] };
  mkdirSync(dirname(path), { recursive: true });
  for (const [run, id, expectedFailure] of probes) {
    const source = JSON.parse(readFileSync(resolve(root, `evals/results/${run}.json`), 'utf8'));
    const result = source.results.find(r => r.id === id), record = result.stages.at(-1).record;
    const start = performance.now();
    try {
      const response = await client.structured({ name: 'replytrack_draft_review', schema: draftReviewSchema, instructions: DRAFT_REVIEW_PROMPT, reasoningEffort: 'medium',
        data: { kind: result.draft.kind, messages: record.messages, questions: result.draft.kind === 'followup' ? record.questions.filter(q => q.status !== 'answered') : record.questions, promises: record.promises, draft: { body: result.draft.body, sourceMessageIds: result.draft.sourceMessageIds } } });
      report.results.push({ source: `${run}/${id}`, expectedFailure, expectedValid: false, reasoningEffort: 'medium', pass: response.data.valid === false, ms: Math.round(performance.now() - start), ...response });
    } catch (error) { report.results.push({ source: `${run}/${id}`, expectedFailure, pass: false, error: { code: error.code, message: error.message } }); }
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  }
  report.completedAt = new Date().toISOString(); writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.results.map(r => ({ source: r.source, pass: r.pass, feedback: r.data?.feedback, error: r.error }))));
  if (report.results.some(r => !r.pass)) process.exitCode = 1;
}
const runFresh = options => new Promise((resolve, reject) => {
  const child = fork(fileURLToPath(import.meta.url), ['--internal-ipc', '--out', options.out, '--only', options.only || '', '--model', options.model || process.env.OPENAI_MODEL || 'gpt-5-mini'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  child.on('error', reject);
  child.on('exit', code => { if (code) process.exitCode = code; resolve(); });
  child.send({ apiKey });
});
const execute = args.includes('--interactive') ? runFresh : run;
await execute({ out: option('--out', '.artifacts/eval/run.json'), only: option('--only', ''), model: option('--model', process.env.OPENAI_MODEL || 'gpt-5-mini') });
if (args.includes('--interactive')) {
  console.log('Ready for next run: JSON with out/only/model, or quit.');
  while (true) {
    const line = await readLine();
    if (line.trim() === 'quit') break;
    try { await execute(JSON.parse(line)); } catch (error) { console.error(error.message); }
    console.log('Ready for next run.');
  }
}
if (process.stdin.isTTY && lines) process.stdin.setRawMode(false);
lines?.close(); process.stdin.pause();
