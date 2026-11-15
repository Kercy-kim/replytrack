// Frozen draft-only controls: question states are seeded; live generation/review are tested.
const q = (title, quote, status = 'partial') => ({ title, quote, status });
export const followupFocusCases = [
  { id:'F01', title:'안내 기한이 있는 환불일과 넓어진 제목', messages:['환불 금액은 얼마인가요? 어떤 결제수단으로 환불되나요? 환불 예정일은 언제인가요?','환불 금액은 79,000원이며 원래 결제한 카드로 환불됩니다. 환불 예정일은 확인 후 11월 18일까지 안내하겠습니다.'],
    questions:[q('환불 금액','환불 금액은 얼마인가요?','answered'),q('환불 수단','어떤 결제수단으로 환불되나요?','answered'),q('환불 예정일(언제 안내받을지/언제 환불되는지)','환불 예정일은 언제인가요?','waiting')],
    required:['환불'], forbidden:['언제\\s*(?:안내|알려)','안내\\s*(?:시점|기한|일정)','금액','결제수단','입금','반영'],
    good:'환불 예정일을 알려주세요.',bad:'환불 예정일과 언제 안내받을 수 있는지 알려주세요.',otherBad:'카드사에 환불 금액이 입금 반영될 날짜를 알려주세요.' },
  { id:'F02', title:'복합 질문에서 이미 받은 반품비 제외', messages:['반품비와 최종 환불액은 얼마인가요?','반품비는 3,000원입니다. 최종 환불액은 아직 확인되지 않았습니다.'],
    questions:[q('반품비와 최종 환불액','반품비와 최종 환불액은 얼마인가요?')], required:['환불'], forbidden:['반품비[^?]*(?:얼마|알려)','차감','공제','산출'],
    good:'최종 환불액은 얼마인지 알려주세요.',bad:'반품비와 최종 환불액을 알려주세요.' },
  { id:'F03', title:'영어 복합 질문의 서류 답변 제외', language:'en', messages:['What documents do I need and how long does the review take?','Please send the transaction ID from your purchase receipt. The review duration is not known yet.'],
    questions:[q('필요한 자료와 심사 기간','What documents do I need and how long does the review take?')], required:['review','how long|duration|time'], forbidden:['what documents','which documents','what[^?]*ID','additional documents','other documents','besides','sufficient','completion date'],
    good:'How long will the review take?',bad:'What documents do I need and how long will the review take?',otherBad:'Which additional documents do you need besides the transaction ID? Also, how long will the review take?' },
  { id:'F04', title:'자료 수신과 실제 계정 복구 구분', language:'en', messages:['Have you received my receipt? Has my account been restored?','We received your receipt. We cannot determine whether your account has been restored yet.'],
    questions:[q('영수증 수신','Have you received my receipt?','answered'),q('실제 계정 복구','Has my account been restored?','review')], required:['account','restor|recover'], forbidden:['have you received','whether[^?]*receiv'],
    good:'Has my account been restored?',bad:'Have you received my receipt and has my account been restored?' },
  { id:'F05', title:'안내 시점 자체가 미답변이면 유지', messages:['심사 결과를 언제까지 알려주시나요?','현재 심사 중이며 안내 시점은 미정입니다.'],
    questions:[q('심사 결과 안내 시점','심사 결과를 언제까지 알려주시나요?','review')], required:['언제|시점|일정|예정일|날짜|기한','심사|결과'], forbidden:['추가.*서류'],
    good:'심사 결과를 언제까지 알려주실 수 있나요?',bad:'심사 결과를 알려주시고 필요한 추가 서류도 알려주세요.' },
  { id:'F06', title:'조건표와 내 주문 요금 구분', messages:['제 주문의 추가 배송비는 얼마인가요?','추가 배송비는 특별 승인이 있으면 무료, 없으면 3,000원입니다. 고객님 주문의 적용 요금은 아직 확인되지 않았습니다.'],
    questions:[q('내 주문 추가 배송비','제 주문의 추가 배송비는 얼마인가요?')], required:['배송비'], forbidden:['승인[^?]*(?:됐|되었|여부)','배송지','주소'],
    good:'제 주문에 적용되는 추가 배송비는 얼마인가요?',bad:'제 주문의 추가 배송비와 특별 승인 여부를 알려주세요.' },
  { id:'F07', title:'해소되지 않은 상충은 재문의 유지', messages:['어떤 수단으로 환불되나요?','환불은 카드로 진행됩니다.','환불은 계좌로 진행됩니다.'],
    questions:[q('환불 수단 상충','어떤 수단으로 환불되나요?','review')], required:['카드|계좌|수단|방법'], forbidden:['언제','날짜','기한'],
    good:'환불 수단이 카드인지 계좌인지 확인해 주세요.',bad:'환불 수단과 환불 날짜를 알려주세요.' },
  { id:'F08', title:'정정으로 답변된 금액 제외', messages:['환불 금액과 실제 환불 날짜는 무엇인가요?','환불 금액은 40,000원입니다.','앞선 금액을 정정합니다. 환불 금액은 45,000원입니다. 실제 환불 날짜는 미정입니다.'],
    questions:[q('환불 금액','환불 금액과 실제 환불 날짜는 무엇인가요?','answered'),q('실제 환불 날짜','환불 금액과 실제 환불 날짜는 무엇인가요?','review')], required:['환불','날짜|예정일|언제|시점'], forbidden:['금액','40,?000','45,?000'],
    good:'실제 환불 날짜를 알려주세요.',bad:'정정된 환불 금액과 실제 환불 날짜를 알려주세요.' },
  { id:'F09', title:'같은 원문의 남은 두 항목 보존', messages:['환불 금액, 결제수단, 환불 날짜를 알려주세요.','원래 결제한 카드로 환불됩니다. 금액과 날짜는 아직 미정입니다.'],
    questions:[q('환불 금액','환불 금액, 결제수단, 환불 날짜를 알려주세요.','review'),q('환불 결제수단','환불 금액, 결제수단, 환불 날짜를 알려주세요.','answered'),q('환불 날짜','환불 금액, 결제수단, 환불 날짜를 알려주세요.','review')], required:['금액','날짜|예정일|언제|시점'], forbidden:['결제수단','어떤.*카드'],
    good:'환불 금액과 환불 날짜를 알려주세요.',bad:'환불 금액만 알려주세요.' },
  { id:'F10', title:'접수일과 실제 처리일 구분', messages:['접수는 언제 됐고 실제 처리는 언제 완료되나요?','접수는 11월 12일에 완료됐습니다. 실제 처리 완료일은 아직 알 수 없습니다.'],
    questions:[q('접수일과 처리 완료일','접수는 언제 됐고 실제 처리는 언제 완료되나요?')], required:['처리','완료|언제|예정'], forbidden:['접수[^?]*(?:언제|날짜|일자)','12일','완료\\s*여부'],
    good:'실제 처리는 언제 완료되는지 알려주세요.',bad:'접수 날짜와 실제 처리 완료일을 알려주세요.',otherBad:'실제 처리 완료일 또는 완료 여부를 알려주세요.' },
  { id:'F11', title:'실제로 물은 두 서류 중 하나가 미정',language:'en',messages:['Do you need my receipt ID and a photo of my ID card?','Please send your receipt ID. We have not determined whether an ID photo is required.'],
    questions:[q('영수증 ID와 신분증 사진 필요 여부','Do you need my receipt ID and a photo of my ID card?')],required:['photo|ID card','require|need'],forbidden:['do you need my receipt ID','(?:is|whether) (?:my |the )?receipt ID (?:is )?(?:required|needed)'],
    good:'Is a photo of my ID card required?',bad:'Do you need my receipt ID and a photo of my ID card?' },
  { id:'F12', title:'명시적인 일부 서류 목록의 실제 누락',language:'en',messages:['What documents are required?','Your receipt ID is required. This is only a partial list; the other required documents are still unknown.'],
    questions:[q('필수 서류 전체 목록','What documents are required?')],required:['other|addition|remaining|rest|full|complete|else','documents|list'],forbidden:['is my receipt ID required'],
    good:'What other documents are required besides my receipt ID?',bad:'Is my receipt ID required?' },
];

export function gradeFollowup(body, fixture) {
  const issues = [];
  for (const p of fixture.required || []) if (!new RegExp(p,'i').test(body)) issues.push(`missing: ${p}`);
  for (const p of fixture.forbidden || []) if (new RegExp(p,'i').test(body)) issues.push(`unnecessary request: ${p}`);
  if (body.length > 500) issues.push('unnecessarily long');
  return { passed: !issues.length, issues };
}
