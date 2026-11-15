import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { execFileSync, fork } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from '../evals/support-cases.mjs';
import { boundaryCases } from '../evals/status-boundary-cases.mjs';
import { unseenCases } from '../evals/unseen-cases.mjs';
import { reasonCases } from '../evals/reason-cases.mjs';
import { gradeReasons } from '../evals/reason-quality.mjs';
import { grade, summarize } from '../evals/grade.mjs';
import { performanceSummary } from '../evals/performance.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack, draftQuestionContext, draftSourceContext } from '../src/service.mjs';
import { DRAFT_REVIEW_PROMPT } from '../src/prompts.mjs';
import { HANDOFF_REVIEW_PROMPT } from '../src/handoff.mjs';
import { draftReviewSchema } from '../src/schema.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['evals/support-cases.mjs', 'evals/status-boundary-cases.mjs', 'evals/unseen-cases.mjs', 'evals/grade.mjs', 'src/prompts.mjs', 'src/schema.mjs', 'src/domain.mjs', 'src/service.mjs', 'src/openai.mjs', 'src/analysis-changes.mjs', 'scripts/evaluate-ai.mjs'];
sourceFiles.push('evals/performance.mjs');
sourceFiles.push('src/privacy.mjs');
sourceFiles.push('evals/reason-cases.mjs', 'evals/reason-quality.mjs');
if (existsSync(resolve(root, 'src/ai-wire.mjs'))) sourceFiles.push('src/ai-wire.mjs');
if (existsSync(resolve(root, 'src/handoff.mjs'))) sourceFiles.push('src/handoff.mjs');
const suites = { support: cases, boundary: boundaryCases, all: [...cases, ...boundaryCases], unseen: unseenCases, full: [...cases, ...boundaryCases, ...unseenCases], reasons: reasonCases };
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const analysisEffort = option('--analysis-effort', 'product');
if (!['product', 'low', 'medium'].includes(analysisEffort)) throw new Error('Unknown analysis effort');
if (args.includes('--help')) {
  console.log('--suite support|boundary|all|unseen|full|reasons selects frozen cases. full runs the existing 48; reasons runs 4 additional contrast controls. --analysis-only skips draft generation/review. Interactive JSON also accepts suite and analysisOnly.');
  console.log('--analysis-effort product|low|medium overrides only the first analysis for controlled experiments; repairs/reviews keep product settings.');
  console.log('Live evaluation (paid API calls): node --env-file=.env scripts/evaluate-ai.mjs --out .artifacts/eval/run.json [--only S01,R03] [--model gpt-5-mini]\n--key-stdin accepts one hidden line; --interactive keeps credentials in memory for another run after code changes. Never writes the key.\nScore saved output offline: node scripts/evaluate-ai.mjs --rescore path/to/run.json');
  process.exit(0);
}
if (args.includes('--rescore')) {
  const report = JSON.parse(readFileSync(option('--rescore'), 'utf8'));
  if (report.hashes['evals/support-cases.mjs'] !== hash(readFileSync(resolve(root, 'evals/support-cases.mjs')))) throw new Error('Dataset hash mismatch');
  const suiteCases = suites[report.suite || 'support'];
  if (!suiteCases) throw new Error('Unknown saved suite');
  if (['boundary', 'all', 'full'].includes(report.suite) && report.hashes['evals/status-boundary-cases.mjs'] !== hash(readFileSync(resolve(root, 'evals/status-boundary-cases.mjs')))) throw new Error('Boundary dataset hash mismatch');
  if (['unseen', 'full'].includes(report.suite) && report.hashes['evals/unseen-cases.mjs'] !== hash(readFileSync(resolve(root, 'evals/unseen-cases.mjs')))) throw new Error('Unseen dataset hash mismatch');
  if (report.suite === 'reasons' && report.hashes['evals/reason-cases.mjs'] !== hash(readFileSync(resolve(root, 'evals/reason-cases.mjs')))) throw new Error('Reason dataset hash mismatch');
  for (const result of report.results) {
    const testCase = suiteCases.find(c => c.id === result.id);
    if (!testCase) throw new Error('Unknown saved case');
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

async function run({ out, only = '', model = process.env.OPENAI_MODEL || 'gpt-5-mini', suite = 'support', analysisOnly = false }) {
  if (only === 'draft-probes') return runDraftProbes({ out, model });
  const suiteCases = suites[suite];
  if (!suiteCases) throw new Error('Unknown suite');
  const selected = only ? suiteCases.filter(c => only.split(',').includes(c.id)) : suiteCases;
  if (!selected.length || (only && selected.length !== new Set(only.split(',')).size)) throw new Error('Unknown or empty case selection');
  const outputPath = resolve(root, out);
  if (existsSync(outputPath)) throw new Error('Output already exists; use a new filename to preserve prior results');
  const report = { formatVersion: 1, startedAt: new Date().toISOString(), mode: 'live OpenAI Responses API', requestedModel: model, suite, analysisOnly,
    analysisEffort,
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    hashes: Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(resolve(root, file)))])), results: [] };
  mkdirSync(dirname(outputPath), { recursive: true });
  const save = () => { report.summary = summarize(report.results); report.performance = performanceSummary(report.results); writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n'); };
  save();
  const client = new OpenAIClient({ apiKey, model });
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const testCase = selected[cursor++], store = new CaseStore(':memory:');
      const result = { id: testCase.id, category: testCase.category, title: testCase.title, stages: [], calls: [], operations: [] };
      const ai = { async structured(input) {
        // Evaluation-only override: keep repairs and every semantic review unchanged.
        if (analysisEffort !== 'product' && input.name === 'replytrack_analysis' && !input.data.revisionFeedback) input = { ...input, reasoningEffort: analysisEffort };
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
        const start = performance.now(); let success = false;
        try {
          const saved = await service.analyze(record.id, record.version); success = true;
          result.stages.push({ record: saved, grade: grade(saved, expected, previous), reasonGrade: gradeReasons(saved, testCase.id) });
          return saved;
        } finally { result.operations.push({ kind: 'analysis', ms: Math.round(performance.now() - start), success }); }
      }
      try {
        let record = service.create({ title: testCase.title, company: '가상 고객센터', messages: testCase.messages });
        // Frozen support/boundary/unseen fixtures contain no personal data to mask.
        // A privacy false positive must fail even when the question-state grade passes.
        if (record.messages.some((m, i) => m.text !== testCase.messages[i].text)) throw Object.assign(new Error('Synthetic source text changed during masking'), { code: 'SOURCE_ALTERED' });
        record = await analyze(record, testCase.expected, null);
        if (testCase.next) {
          const previous = structuredClone(record);
          for (const m of testCase.next) record = service.append(record.id, { ...m, version: record.version });
          if (record.messages.slice(previous.messages.length).some((m, i) => m.text !== testCase.next[i].text)) throw Object.assign(new Error('Synthetic follow-up text changed during masking'), { code: 'SOURCE_ALTERED' });
          record = await analyze(record, testCase.after, previous);
        }
        if (testCase.draft && !analysisOnly) {
          const selectedQuestions = record.questions.filter(q => q.status !== 'answered');
          const start = performance.now(); let success = false;
          try {
            record = await service.draft(record.id, { version: record.version, kind: testCase.draft, questionIds: selectedQuestions.map(q => q.id) });
            success = true;
            result.draft = { kind: testCase.draft, ...record.drafts[testCase.draft], semanticReview: 'pending independent semantic review' };
          } catch (error) { result.draft = { kind: testCase.draft, error: { code: error.code || 'UNKNOWN', message: error.message } }; }
          finally { result.operations.push({ kind: 'draft', ms: Math.round(performance.now() - start), success }); }
        }
      } catch (error) { result.error = { code: error.code || 'UNKNOWN', message: error.message }; }
      finally { store.close(); }
      report.results.push(result); report.results.sort((a,b) => suiteCases.findIndex(c => c.id === a.id) - suiteCases.findIndex(c => c.id === b.id)); save();
      console.log(`${testCase.id}: ${result.error ? result.error.code : result.stages.every(s => s.grade.pass && s.reasonGrade.pass) ? 'PASS' : 'REVIEW'}${result.draft?.error ? ' / ' + result.draft.error.code : ''} (${report.results.length}/${selected.length})`);
      if (result.error?.code === 'AI_AUTH' || result.error?.code === 'AI_LIMIT') cursor = selected.length;
    }
  }
  await Promise.all([worker(), worker()]);
  report.completedAt = new Date().toISOString(); report.complete = report.results.length === selected.length; save();
  console.log(JSON.stringify(report.summary));
  if (!report.complete || report.results.some(r => r.error || r.draft?.error || r.stages.some(s => !s.grade.pass || !s.reasonGrade.pass))) process.exitCode = 1;
}
async function runDraftProbes({ out, model }) {
  // Test the new product reviewer against real failed outputs preserved from earlier runs.
  // These are review-only calls, not additional generated/evaluated conversations.
  const path = resolve(root, out);
  if (existsSync(path)) throw new Error('Output already exists');
  const probes = [['iteration-3', 'S02', '선택한 배송비 질문 누락'], ['iteration-3', 'S06', '원문에 없는 동일 상담원 추정'], ['baseline', 'R02', '상담원 입장으로 고객 정보 요구'],
    ['unseen/baseline', 'NR05', '중간의 계좌 안내를 초기 안내로 요약'], ['unseen/baseline', 'NS03', '장소 확인 뒤 안내를 정확히 전달한 정상 인계', true],
    ['unseen/iteration-1', 'NS03', '역할명만 쓴 정상 인계를 동일인 주장으로 오인하지 않기', true, true],
    ['unseen/regression-1', 'R02', '질문형 문장에서 원문에 없는 비용 차감 관계 전제'],
    ['reason-scope/accepted', 'NU03', '현재 예약 상태 외에 추가 조작·확인 절차를 요구'],
    ['full-regression/accepted', 'NU03', '현재 예약 상태만 묻는 정상 재문의', true]];
  const client = new OpenAIClient({ apiKey, model });
  const report = { mode: 'live draft review control probes', startedAt: new Date().toISOString(), requestedModel: model,
    hashes: Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(resolve(root, file)))])), results: [] };
  mkdirSync(dirname(path), { recursive: true });
  for (const [run, id, expectedFailure, expectedValid = false, lastAttempt = false] of probes) {
    const source = JSON.parse(readFileSync(resolve(root, `evals/results/${run}.json`), 'utf8'));
    const result = source.results.find(r => r.id === id), record = result.stages.at(-1).record;
    const draft = lastAttempt ? result.calls.filter(c => c.name === 'replytrack_draft').at(-1).data : result.draft;
    const start = performance.now();
    try {
      const response = await client.structured({ name: 'replytrack_draft_review', schema: draftReviewSchema, instructions: result.draft.kind === 'handoff' ? HANDOFF_REVIEW_PROMPT : DRAFT_REVIEW_PROMPT, reasoningEffort: 'medium',
        data: { kind: result.draft.kind, ...draftSourceContext(record, result.draft.kind), questions: draftQuestionContext(result.draft.kind === 'followup' ? record.questions.filter(q => q.status !== 'answered') : record.questions), draft: { body: draft.body, sourceMessageIds: draft.sourceMessageIds } } });
      report.results.push({ source: `${run}/${id}`, expectedFailure, expectedValid, reasoningEffort: 'medium', pass: response.data.valid === expectedValid, ms: Math.round(performance.now() - start), ...response });
    } catch (error) { report.results.push({ source: `${run}/${id}`, expectedFailure, pass: false, error: { code: error.code, message: error.message } }); }
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  }
  report.completedAt = new Date().toISOString(); writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.results.map(r => ({ source: r.source, pass: r.pass, feedback: r.data?.feedback, error: r.error }))));
  if (report.results.some(r => !r.pass)) process.exitCode = 1;
}
const runFresh = options => new Promise((resolve, reject) => {
  const child = fork(fileURLToPath(import.meta.url), ['--internal-ipc', '--analysis-effort', analysisEffort, '--out', options.out, '--only', options.only || '', '--model', options.model || process.env.OPENAI_MODEL || 'gpt-5-mini', '--suite', options.suite || 'support', ...(options.analysisOnly ? ['--analysis-only'] : [])], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  child.on('error', reject);
  child.on('exit', code => { if (code) process.exitCode = code; resolve(); });
  child.send({ apiKey });
});
const execute = args.includes('--interactive') ? runFresh : run;
await execute({ out: option('--out', '.artifacts/eval/run.json'), only: option('--only', ''), model: option('--model', process.env.OPENAI_MODEL || 'gpt-5-mini'), suite: option('--suite', 'support'), analysisOnly: args.includes('--analysis-only') });
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
