import test from 'node:test';
import assert from 'node:assert/strict';
import { stripInternalCitations } from '../src/handoff.mjs';
import { validateDraft } from '../src/domain.mjs';
import { createDemo } from '../src/demo.mjs';

test('citation cleanup removes only known pure internal references without changing facts or sources', () => {
  const c=createDemo(), id=c.messages[0].id, second=c.messages[1].id;
  const raw={body:`수리비(${id})와 배송비[ ${second} ] 안내를 기다립니다.`,sourceMessageIds:[id,second]};
  const before=structuredClone(raw), cleaned=stripInternalCitations(raw,c);
  assert.equal(cleaned.body,'수리비와 배송비 안내를 기다립니다.');
  assert.deepEqual(cleaned.sourceMessageIds,raw.sourceMessageIds);
  assert.deepEqual(raw,before);
  assert.deepEqual(stripInternalCitations(cleaned,c),cleaned);
  assert.equal(validateDraft(cleaned,c).body,cleaned.body);
});

test('actual identifiers, mixed text, unknown references and unsupported facts are never silently removed', () => {
  const c=createDemo(), id=c.messages[0].id, sources=[id,c.messages[1].id];
  for(const body of [`근거 ${id}입니다.`,`(${id} 처리 완료)`,`[${id} 추가 사실]`,'(ffffffff-ffff-ffff-ffff-ffffffffffff)','(_r99)']) {
    const raw={body,sourceMessageIds:sources};
    assert.equal(stripInternalCitations(raw,c),raw);
    assert.throws(()=>validateDraft(raw,c),{code:'DRAFT_REFERENCE'});
  }
  const invented={body:`환불 987654원(${id})`,sourceMessageIds:sources};
  assert.throws(()=>validateDraft(stripInternalCitations(invented,c),c),{code:'DRAFT_FACT'});
  const missing={body:`안내(${id})`,sourceMessageIds:['missing']};
  assert.throws(()=>validateDraft(stripInternalCitations(missing,c),c),{code:'DRAFT_EVIDENCE'});
  c.messages[0].text+=` 제 접수번호는 ${id}입니다.`;
  const actual={body:`접수번호(${id})입니다.`,sourceMessageIds:[id]};
  assert.equal(stripInternalCitations(actual,c),actual);
  assert.equal(validateDraft(actual,c).body,actual.body);
  assert.equal(stripInternalCitations(null,c),null);
});
