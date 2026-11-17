import { savedDraft } from './workspace.js';

export function firstInquiryForm(input,esc) {
  return `<p class="modal-intro">어디에 어떤 문의를 하고 싶은지 알려 주세요. 공식 경로와 준비물을 확인하고 첫 문의 초안을 만들어요.</p><form id="first-inquiry-form">
    <label class="field">문의할 서비스·업체<input name="company" maxlength="50" value="${esc(input.company||'')}" placeholder="예: Google, Netflix" required></label>
    <label class="field">어떤 도움이 필요한가요?<textarea name="goal" rows="5" maxlength="2000" placeholder="예: 구글 계정에 로그인할 수 없어요. 복구 방법과 준비할 내용을 알고 싶어요." required>${esc(input.goal||'')}</textarea></label>
    <div class="form-grid"><label class="field">기록할 문의 방식<select name="channel"><option value="chat" ${input.channel!=='email'?'selected':''}>채팅·문의 양식</option><option value="email" ${input.channel==='email'?'selected':''}>이메일</option></select></label><label class="field">초안 언어<select name="language"><option value="ko" ${input.language!=='en'?'selected':''}>한국어</option><option value="en" ${input.language==='en'?'selected':''}>영어</option></select></label></div>
    <p class="form-note">전화번호·주소는 마스킹한 뒤 AI에 전달해요. 비밀번호·인증코드는 입력하지 마세요. 실제 문의 방식은 확인된 공식 경로를 따라 주세요.</p>
    <div class="modal-actions"><button type="button" class="btn secondary" data-action="close-modal">닫기</button><button class="btn primary" type="submit">공식 경로 확인하고 초안 만들기</button></div></form>`;
}
export function firstGuide(p,esc,date) {
  const evidence=i=>`<details><summary>공식 근거 확인</summary><blockquote>${esc(i.quote)}</blockquote><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a><small>조회 ${esc(date(i.checkedAt))}</small></details>`;
  return `<div class="first-guide"><section><h2>어디로 문의하나요?</h2>${p.routes.length?p.routes.map(i=>`<p>${esc(i.text)}</p><a class="btn secondary" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">공식 안내 열기</a>${evidence(i)}`).join(''):'<p>확인된 공식 문의 경로가 없어요. 업체의 정확한 이름이나 이용 서비스를 추가해 주세요.</p>'}</section>
  <section><h2>어떻게 진행하나요?</h2>${p.steps.length?`<ol>${p.steps.map(i=>`<li>${esc(i.text)}${evidence(i)}</li>`).join('')}</ol>`:'<p>상황에 맞는 공식 절차를 확인하지 못했어요.</p>'}</section>
  <section><h2>무엇을 준비하나요?</h2>${p.preparations.length?`<ul>${p.preparations.map(i=>`<li>${esc(i.text)}${evidence(i)}</li>`).join('')}</ul>`:'<p>공식 자료에서 확인된 준비물이 없어요. 준비물이 필요 없다는 뜻은 아니에요.</p>'}</section>
  ${p.clarifications.length?`<section><h2>이 내용을 더 알려 주세요</h2><ul>${p.clarifications.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></section>`:''}</div>`;
}
export function firstInquiryPanel(c,{esc,button,date,edits,busy,dirty,status}) {
  return `<section class="case-heading"><div><h1>${esc(c.title)}</h1><div class="case-company">${esc(c.company)} · 문의 준비 중</div><p>${esc(c.firstInquiry.goal)}</p></div><div class="heading-actions">${button('case-settings','문의 관리','secondary compact','settings')}${button('export','내려받기','secondary compact','download')}</div></section>
  <p class="first-intro">공식 안내를 확인하고 초안을 수정해 주세요. 아직 업체에 보내지 않은 내용이에요. <a class="first-jump" href="#draft-first">초안으로 이동</a></p>
  <div class="first-layout">${firstGuide(c.firstInquiry,esc,date)}<section class="first-compose"><h2>첫 문의 초안</h2><p>공식 경로에 문의 입력란이 있으면 초안을 활용하세요. 자가 해결 절차만 제공될 수도 있어요. 실제로 보낸 내용은 이후 답변과 함께 관리할 수 있어요.</p>
  <label class="field" for="draft-first">${c.firstInquiry.language==='en'?'영어':'한국어'} 초안 · 직접 수정 가능<textarea id="draft-first" data-draft="first" rows="12" maxlength="6000" ${busy?'readonly':''}>${esc(edits.first??savedDraft(c.drafts.first))}</textarea></label>
  <div class="draft-editor-bottom"><span id="draft-status-first" role="status">${esc(status)}</span><div class="draft-actions">${button('save-draft','편집 저장','secondary compact','check',`data-kind="first" ${!dirty?'disabled':''}`)}${button('copy','복사하기','secondary compact','copy','data-kind="first"')}</div></div>
  <div class="first-send">${button('first-sent','보낸 내용으로 기록하기','primary','arrow')}<p>이 버튼은 업체에 메시지를 보내지 않아요.</p></div>
  ${button('first-refine','조건을 더해 다시 준비하기','text')}</section></div>`;
}
export function firstInquiryMarkdown(c) {
  const p=c.firstInquiry;if(!p)return '';
  return `## 첫 문의 준비\n\n${p.state==='preparing'?'아직 보내지 않은 초안':'사용자가 보낸 내용으로 기록'}\n\n${['routes','steps','preparations'].flatMap(k=>p[k].map(i=>`- ${i.text}\n  - ${i.url}\n  - 근거: ${i.quote}`)).join('\n')}\n\n`;
}
