import test from 'node:test';
import assert from 'node:assert/strict';
import {actionChecks,guideChecks,draftChecks,featureReviewSchema,reviewPassed} from '../src/feature-review.mjs';
test('an overall approval cannot override a failed or omitted review criterion',()=>{
  for(const definitions of [actionChecks,guideChecks,draftChecks]) {
    const data={valid:true,feedback:'',checks:Object.fromEntries(Object.keys(definitions).map(k=>[k,true]))};
    assert(reviewPassed(data,definitions));
    for(const key of Object.keys(definitions)) {
      const rejected=structuredClone(data);rejected.checks[key]=false;assert(!reviewPassed(rejected,definitions));
      delete rejected.checks[key];assert(!reviewPassed(rejected,definitions));
    }
    assert(!reviewPassed({valid:true,feedback:''},definitions));
    assert(!reviewPassed({...data,valid:false},definitions));
    assert.deepEqual(featureReviewSchema(definitions).properties.checks.required,Object.keys(definitions));
  }
});
