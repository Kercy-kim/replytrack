// Offline comparison. Saved API outputs are never changed or regenerated here.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registrationCases } from '../evals/registration-latency-cases.mjs';
import { grade } from '../evals/grade.mjs';
const [input,output]=process.argv.slice(2);assert(input&&output&&!existsSync(output));
const bytes=readFileSync(input),report=JSON.parse(bytes);assert(report.complete);
const distribution=values=>{const xs=values.toSorted((a,b)=>a-b),n=xs.length;return {count:n,medianMs:n?(xs[Math.floor((n-1)/2)]+xs[Math.floor(n/2)])/2:null,meanMs:n?Math.round(xs.reduce((a,b)=>a+b,0)/n):null,minMs:xs[0]??null,maxMs:xs.at(-1)??null};};
const results=report.results.map(r=>{
  const fixture=registrationCases.find(f=>f.id===r.id);assert(fixture);
  const stages=r.stages.map((s,i)=>{
    const messages=i?[...fixture.messages,...fixture.next]:fixture.messages;
    const sourceShape=m=>({role:m.role,text:m.text,sentAt:m.sentAt?new Date(m.sentAt).toISOString():null});
    assert.deepEqual(s.record.messages.map(sourceShape),messages.map(sourceShape));
    const currentGrade=grade(s.record,i?fixture.after:fixture.expected,i?r.stages[i-1].record:null);
    return {phase:s.phase,ms:s.ms,grade:currentGrade,reasonGrade:s.reasonGrade};
  });
  return {...r,stages,passed:!r.error&&stages.every(s=>s.grade.pass&&s.reasonGrade.pass)};
});
const byVariant={};
for(const variant of ['before','after']){
  const rows=results.filter(r=>r.variant===variant);assert.equal(rows.length,registrationCases.length*report.repeats);
  const calls=rows.flatMap(r=>r.calls),usage=key=>calls.reduce((n,c)=>n+(c.usage?.[key]||0),0);
  byVariant[variant]={cases:rows.length,passedCases:rows.filter(r=>r.passed).length,stages:rows.flatMap(r=>r.stages).length,
    passedStages:rows.flatMap(r=>r.stages).filter(s=>s.grade.pass&&s.reasonGrade.pass).length,
    initial:distribution(rows.flatMap(r=>r.stages.filter(s=>s.phase==='initial').map(s=>s.ms))),
    reply:distribution(rows.flatMap(r=>r.stages.filter(s=>s.phase==='reply').map(s=>s.ms))),
    calls:calls.length,observedTokens:usage('total_tokens'),observedOutputTokens:usage('output_tokens'),
    unobservedRequests:calls.reduce((n,c)=>n+(c.transport?.unobservedRequests??c.usage?.unobserved_requests??(c.usage?0:1)),0),
    failures:rows.filter(r=>!r.passed).map(r=>({id:r.id,repeat:r.repeat,error:r.error,issues:r.stages.flatMap(s=>s.grade.issues)}))};
}
const pairs=results.filter(r=>r.variant==='before').map(b=>{
  const a=results.find(r=>r.variant==='after'&&r.id===b.id&&r.repeat===b.repeat);assert(a);
  return {id:b.id,repeat:b.repeat,beforePassed:b.passed,afterPassed:a.passed,stages:b.stages.map((s,i)=>({phase:s.phase,beforeMs:s.ms,afterMs:a.stages[i]?.ms,qualityRegression:s.grade.pass&&!a.stages[i]?.grade.pass}))};
});
const percent=(b,a)=>b?Math.round((b-a)/b*1000)/10:null;
const summary={source:input,sourceSha256:createHash('sha256').update(bytes).digest('hex'),model:report.model,
  fixtureHashAtRun:report.fixtureHash,fixtureHashAtScoring:createHash('sha256').update(JSON.stringify(registrationCases)).digest('hex'),
  gradingNote:'New receipt actions may have new IDs; repeated unchanged promises may cite either declared equivalent message; title synonyms identify the same question. Original scores remain in the source report. Semantic state or promise errors are still failures.',
  ...byVariant,reductionPercent:{initialMedian:percent(byVariant.before.initial.medianMs,byVariant.after.initial.medianMs),replyMedian:percent(byVariant.before.reply.medianMs,byVariant.after.reply.medianMs),
    totalTokens:byVariant.before.unobservedRequests||byVariant.after.unobservedRequests?null:percent(byVariant.before.observedTokens,byVariant.after.observedTokens)},pairs};
writeFileSync(output,JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,pairs:undefined},null,2));
