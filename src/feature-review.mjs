const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const actionChecks = {
  requestsOnly:'업체가 실제로 소비자에게 요청한 행동만 있는가. 일반 절차·업체 약속·소비자 계획을 요청으로 만들면 false.',
  conditionsComplete:'업체가 행동에 명시한 선행 조건을 condition 필드에도 보존했는가. 조건이 인용에만 남으면 false. 조건 없는 요청은 condition이 비어 있는 것이 맞다.',
  constraintsGrounded:'condition/dueText가 비어 있지 않으면 실제 소비자 행동의 명시적 조건/기한인가. 업체의 방문 접수 약속이나 소비자의 상담 배경을 condition에 넣으면 false. 업체 방문 예정일을 소비자의 수행 기한으로 넣으면 false. 예: condition=저희가 내일 기사 방문을 접수하겠습니다 는 요청의 조건이 아니므로 false.',
  latestState:'후속 수신·실제 수행·철회를 반영했는가. 미래 계획·거절·아직 안 했다는 정정은 requested/update=null이며 수행이 아니다.',
  identityAndCoverage:'현재 요청이 빠지거나 새 items 안에서 중복되지 않았는가. existingItems와 items의 같은 ID는 정상 보존이다.',
};
export const guideChecks = {
  quoteSupport:'steps/conditions의 정책·수치·절차는 해당 항목 quote로 뒷받침되는가. 같은 source의 다른 문장만 근거이면 false. 사용자 본인의 진술은 user가 근거다. unknowns는 미확인 정보를 묻는 문자열이므로 quote가 필요하지 않다.',
  userSituation:'사용자가 밝힌 결제·주문 상태·상품·사유에 적용되는가. 알려준 정보와 반대되는 조건으로 진행시키면 false.',
  conditionsComplete:'안내한 정책의 적용 조건·예외와 현재 상황의 핵심 제한이 보존됐는가. 설치 이후를 모든 설치상품으로, 고객 귀책 예외를 무조건 판매자 부담으로 바꾸면 false. 다른 선택 경로나 사용자가 묻지 않은 절차를 모두 포함할 필요는 없다.',
  noPersonalCompletion:'개인 주문의 실제 승인·입금·카드 반영을 확인했다고 단정하지 않는가. 사용자가 취소됐다고 해도 카드 환불 반영 완료를 AI가 단정하면 false.',
  relevantUnknowns:'unknowns가 실제로 남은 정보만 묻는가. 사용자가 말하지 않은 주문 더하기·기존 교환 접수·선출고를 묻거나 알려준 사유를 다시 물으면 false.',
};
export const draftChecks = {
  consumerVoice:'소비자가 고객센터에 보내는 글인가. 고객님에게 배송지·계정 정보를 요구하거나 상담원처럼 답하면 false.',
  selectedQuestionsCovered:'선택한 원문 질문의 아직 부족한 정보가 모두 있는가. 부분 답변의 받은 부분을 제외하는 것은 누락이 아니다. 예: 서류와 기간을 물어 구체적인 서류를 안내받고 기간만 미정이면 기간만 묻는 초안은 true다. 안내된 서류만으로 충분한지 새로 묻도록 요구하면 안 된다. 명시적인 일부 목록이나 실제로 물은 다른 서류가 빠진 경우만 자료 질문을 유지한다. topicHint의 부연을 새로운 요청으로 취급하지 않는다.',
  sourceFactsOnly:'개별 사실·조건·상태는 원문에 있는가. 정책의 예시를 사용자 사실로 바꾸거나 미확인 배송지를 확정하면 false.',
  noExtraRequests:'선택한 원문에서 실제 남은 정보만 요청하는가. 환불 예정일을 카드사 입금·반영일로 바꾸거나 처리 날짜에 완료 여부를 대안으로 붙이면 false. 그 단계나 여부는 사용자가 직접 물었을 때만 허용한다. 소요 기간을 물었는데 시작일 없이 달력상의 완료 날짜를 대신 요구해도 false. 배송비만 물었는데 특별 승인 여부나 배송지도 확인해 달라고 추가하면 false. 답을 결정하는 조건이라도 고객이 그 조건 확인을 직접 요청하지 않았다면 새 요청이다. Do NOT infer extra missing requirements: asking for other/additional documents or whether the given documents are sufficient is an EXTRA request and must be false, unless the source explicitly says the list is partial or leaves a specifically asked document unresolved. Not saying only/all does NOT make a list partial. Adding procedures also fails.',
  noAnsweredRequests:'질문한 구체 정보가 실제로 충족된 항목을 다시 묻지 않는가. 미정·알 수 없음·확인 중·not known yet은 필요한 답을 받은 것이 아니므로 그 정보를 다시 묻는 것은 true다. 실제 환불일이 미정이어도 안내 기한을 받았다면 언제 알려줄지 재요청하면 false. 부분 답변의 받은 항목이나 answeredQuestions의 해당 항목을 다시 물어도 false. 명시적으로 정정되어 확정된 금액을 정정된 금액이라며 다시 묻는 것도 false다. 같은 source에 금액과 날짜가 함께 있어도 금액은 answeredQuestions이고 날짜만 선택됐다면 금액을 재요청할 수 없다. 알려진 사실의 필요한 식별 맥락과 아직 해소되지 않은 충돌·정정 확인·다른 대상 질문은 허용한다.',
};
export function featureReviewSchema(checks) {
  return object({checks:object(Object.fromEntries(Object.entries(checks).map(([key,description])=>[key,{type:'boolean',description}]))),feedback:{type:'string'},valid:{type:'boolean'}});
}
export function reviewPassed(data, checks) {
  return data?.valid===true && Object.keys(checks).every(key=>data.checks?.[key]===true);
}
