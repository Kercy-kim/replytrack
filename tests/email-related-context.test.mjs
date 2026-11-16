import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ReplyTrack,linkedUnansweredNeedsReview} from '../src/service.mjs';
import {CaseStore} from '../src/store.mjs';
import {emailCases} from '../evals/email-cases.mjs';

test('unanswered with a linked action requests review only in email',()=>{
  const data={questions:[{id:'q',status:'unanswered'}],promises:[{questionIds:['q']}]};
  assert(linkedUnansweredNeedsReview(data,{channel:'email'}));
  assert(!linkedUnansweredNeedsReview(data,{channel:'chat'}));
  assert(!linkedUnansweredNeedsReview({...data,promises:[{questionIds:[]}]},{channel:'email'}));
  assert(!linkedUnansweredNeedsReview({...data,questions:[{id:'q',status:'partial'}]},{channel:'email'}));
});

for(const mode of ['related','unrelated','invalid'])test(`captured inconsistent email is reviewed without automatic status assignment: ${mode}`,async()=>{
  const raw=JSON.parse(readFileSync(new URL('../evals/results/presentation/recording-2026-11-16-readiness.json',import.meta.url)));
  const captured=raw.calls.find(c=>c.name==='replytrack_analysis').data;
  const store=new CaseStore(':memory:');let calls=0;
  try {
    const svc=new ReplyTrack(store,{async structured(args){
      calls++;assert.equal(args.reasoningEffort,'medium');
      let text=JSON.stringify(captured).replaceAll(captured.questions[0].source.messageId,args.data.messages[0].id)
        .replaceAll(captured.promises[0].evidence.messageId,args.data.messages[1].id);
      const data=JSON.parse(text);
      if(calls===2){
        assert.match(args.data.revisionFeedback,/unanswered/);
        data.questions=data.questions.filter(q=>q.id===captured.questions[1].id);
        if(mode==='related'){
          data.questions[0].status='partial';data.questions[0].reason='자료 확인 후 심사하겠다고 안내받았지만 기간은 안내되지 않았습니다.';
          data.questions[0].evidence=[structuredClone(data.promises[0].evidence)];
        }else if(mode==='unrelated')data.promises[0].questionIds=[];
      }
      return {model:'captured-regression',data};
    }});
    const f=emailCases[0],c=svc.create({channel:'email',title:'관련 절차와 기간',messages:[{role:'customer',text:f.customer},{role:'agent',text:f.agent}]});
    if(mode==='invalid'){
      await assert.rejects(svc.analyze(c.id,c.version),e=>e.code==='AI_EVIDENCE');
      assert.equal(store.get(c.id).analysis,null);
    }else{
      const result=await svc.analyze(c.id,c.version);
      assert.equal(result.questions[0].status,'answered');
      assert.equal(result.questions[1].status,mode==='related'?'partial':'unanswered');
      assert(result.promises.every(p=>!p.confirmedAt));
    }
    assert.equal(calls,2);
  }finally{store.close();}
});
