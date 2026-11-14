import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gradeReasons } from '../evals/reason-quality.mjs';
const [input, output] = process.argv.slice(2);
if (!input) throw Error('Usage: node scripts/rescore-reasons.mjs report.json [rescore.json]');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const report = JSON.parse(readFileSync(input));
if (!report.complete) throw Error('Cannot certify an incomplete run');
for (const file of ['evals/support-cases.mjs','evals/status-boundary-cases.mjs','evals/unseen-cases.mjs','evals/reason-cases.mjs','evals/grade.mjs']) {
  if (report.hashes[file] !== hash(file)) throw Error(`Frozen data/rubric mismatch: ${file}`);
}
const results = report.results.map(r => ({ id: r.id, error: r.error || r.draft?.error,
  stages: r.stages.map(s => ({ corePass: s.grade.pass, recorded: s.reasonGrade, current: gradeReasons(s.record,r.id) })) }));
const pass = results.length > 0 && results.every(r => !r.error && r.stages.length && r.stages.every(s => s.corePass && s.current.pass));
const rescored = { source: input, sourceHash: hash(input), recordedGraderHash: report.hashes['evals/reason-quality.mjs'], currentGraderHash: hash('evals/reason-quality.mjs'), pass, results };
if (output) { if (existsSync(output)) throw Error('Refusing to overwrite a rescore'); writeFileSync(output,JSON.stringify(rescored,null,2)+'\n'); }
console.log(JSON.stringify({pass,cases:results.length,questions:results.flatMap(r=>r.stages).reduce((n,s)=>n+s.current.checkedQuestions,0),issues:results.flatMap(r=>r.stages.flatMap(s=>s.current.issues))}));
if (!pass) process.exitCode = 1;
