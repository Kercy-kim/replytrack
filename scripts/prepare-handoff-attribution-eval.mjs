import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

const base = 'e7717f8a2dc14c4c4bc905f78c4d75cbf343016a';
const snapshot = '.artifacts/handoff-attribution-baseline';
const files = execFileSync('git', ['ls-tree','-r','--name-only',base,'src','public'], { encoding: 'utf8' }).trim().split('\n').filter(f => /\.(mjs|js)$/.test(f));
for (const file of files) {
  const path = `${snapshot}/${file}`, content = execFileSync('git',['show',`${base}:${file}`]);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && !readFileSync(path).equals(content)) throw Error('Baseline snapshot changed: '+file);
  writeFileSync(path,content);
}
writeFileSync(`${snapshot}/base.txt`,base);
const output = 'evals/handoff-attribution-final-cases.json';
if (existsSync(output)) { console.log('Attribution baseline verified; frozen inputs retained.'); process.exit(0); }
const previous = JSON.parse(readFileSync('evals/handoff-tail-cases.json'));
const cases = previous.cases.map(c => ({ ...c, repetitions: c.id === 'U06' ? 6 : c.id === 'NR05' ? 3 : c.id === 'R03' ? 2 : 1 }));
const final = JSON.parse(readFileSync('evals/results/handoff-tail/full.json'));
const failed = final.results.find(r => r.caseId === 'U06' && r.variant === 'after').calls[0].data;
const record = cases.find(c=>c.id==='U06');
const repair = (id,draft,provenance) => ({...record,id,repetitions:2,repair:{draft,feedback:'원문에서 담당자가 서로 다른 사람인지 알 수 없습니다. 안내 내용만 전달하세요.',provenance}});
const rejected = JSON.parse(readFileSync('evals/results/handoff-attribution/rejected-prompt.json'));
const observed = repetition => rejected.results.find(r=>r.id===`U06#${repetition}`&&r.variant==='after').calls[0].data;
const repairs = [
  repair('actor-U06',failed,'Actual initial draft from PR #8 U06, 45.575-second completed handoff.'),
  repair('actor-variant',{...failed,body:failed.body.replaceAll('상담원','담당자').replaceAll('‘','"').replaceAll('’','"')},'Synthetic wording variant frozen before calls; same source and unsupported identity, not unseen source.'),
  repair('actor-plural',observed(1),'Observed plural attribution from rejected prompt candidate; frozen before final calls.'),
  repair('actor-indirect',observed(3),'Observed indirect received guidance from rejected prompt candidate; frozen before final calls.'),
  ...previous.repairs.filter(c=>['repair-R03','repair-H02'].includes(c.id)),
];
writeFileSync(output,JSON.stringify({formatVersion:1,frozenBeforeCalls:true,baseCommit:base,
  scope:'Existing 12 records / 20 full pairs. Separately 6 failed seeds / 12 repair-only pairs; not unseen cases or analysis accuracy.',cases,repairs},null,2)+'\n',{flag:'wx'});
console.log('Frozen 20 full pairs and 12 repair-only pairs for attribution evaluation.');
