import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

const base = '67b8e5a11ee101701ba3bbea3f4a7a7050557602';
const snapshot = '.artifacts/handoff-tail-baseline';
const files = execFileSync('git', ['ls-tree','-r','--name-only',base,'src','public'], { encoding: 'utf8' }).trim().split('\n').filter(f => /\.(mjs|js)$/.test(f));
for (const file of files) {
  const path = `${snapshot}/${file}`, content = execFileSync('git',['show',`${base}:${file}`]);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && !readFileSync(path).equals(content)) throw Error('Baseline snapshot changed: '+file);
  writeFileSync(path,content);
}
writeFileSync(`${snapshot}/base.txt`,base);
const output = 'evals/handoff-tail-cases.json';
if (existsSync(output)) { console.log('Tail baseline verified; frozen inputs retained.'); process.exit(0); }
const original = JSON.parse(readFileSync('evals/handoff-cases.json'));
const cases = original.cases.map(c => ({ ...c, repetitions: c.id === 'R03' ? 6 : c.id === 'NR05' ? 4 : 1 }));
const final = JSON.parse(readFileSync('evals/results/handoff/final.json'));
const probes = JSON.parse(readFileSync('evals/handoff-review-probes.json')).probes;
const controls = JSON.parse(readFileSync('evals/results/handoff/review-controls.json')).results;
const repairs = ['R03','NR05','U06','H02'].map(caseId => {
  const c = cases.find(c => c.id === caseId);
  let draft, feedback;
  if (['R03','NR05'].includes(caseId)) {
    const r = final.results.find(r => r.id === `${caseId}#1` && r.variant === 'after');
    draft = r.calls.find(c => c.name === 'replytrack_draft').data;
    feedback = r.calls.find(c => c.data?.valid === false)?.data.feedback || '본문의 내부 메시지 ID를 제거하고 근거는 sourceMessageIds에만 유지하세요.';
  } else {
    const id = caseId === 'U06' ? 'U06#2/after' : 'H02/consumer-perspective';
    draft = probes.find(p => p.id === id).draft;
    feedback = controls.find(p => p.id === id).data.feedback;
  }
  return { ...c, id: `repair-${caseId}`, repetitions: 2, repair: { draft, feedback, provenance: 'Preserved failed output and review from PR #7; first failed generation/review replayed, real repair and final review only.' } };
});
writeFileSync(output,JSON.stringify({ formatVersion: 1, frozenBeforeCalls: true, baseCommit: base,
  scope: 'Existing fixed analysis records; targeted repetition, not unseen cases or analysis accuracy.', cases, repairs },null,2)+'\n',{ flag: 'wx' });
console.log('Frozen 12 records / 20 full pairs and 4 failed drafts / 8 repair-only pairs.');
