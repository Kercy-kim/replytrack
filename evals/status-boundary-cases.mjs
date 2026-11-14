// Additional boundary controls fixed before the first live run of ADR 0006.
const c = text => ({ role: 'customer', text, sentAt: null });
const a = text => ({ role: 'agent', text, sentAt: null });
const question = (topic, status, evidence) => ({ message: 0, topic, status, evidence });
export const boundaryCases = [
  { id: 'B01', category: '배송', title: '업체 응답 자체가 없음', messages: [c('배송 위치를 알려 주세요.')],
    expected: { questions: [question('배송|위치', 'unanswered', [])], promises: [] } },
  { id: 'B02', category: '환불', title: '인사와 단순 접수 인사만 있음', messages: [c('환불 금액은 얼마인가요?'), a('안녕하세요. 문의해 주셔서 감사합니다.')],
    expected: { questions: [question('환불|금액', 'unanswered', [])], promises: [] } },
  { id: 'B03', category: '환불', title: '조작 지시 없이도 명시적 미정은 확인 필요', messages: [c('환불 금액은 얼마인가요?'), a('환불 금액은 아직 확정되지 않았습니다.')],
    expected: { questions: [question('환불|금액', 'review', [1])], promises: [] } },
  { id: 'B04', category: '구독', title: '자동 갱신 상태 대신 변경 방법만 안내', messages: [c('제 계정의 자동 갱신이 지금 꺼져 있나요?'), a('자동 갱신을 끄려면 설정에서 갱신 스위치를 끔으로 바꾸시면 됩니다.')],
    expected: { questions: [question('갱신', 'partial', [1])], promises: [] } },
  { id: 'B05', category: '배송', title: '다른 문제의 구체적인 방법은 관련 정보가 아님', messages: [c('배송 위치를 알려 주세요.'), a('구독을 해지하려면 설정 메뉴의 구독 해지 버튼을 누르시면 됩니다.')],
    expected: { questions: [question('배송|위치', 'unanswered', [])], promises: [] } },
  { id: 'B06', category: '구독', title: '방법을 질문했다면 방법 안내로 답변 충족', messages: [c('자동 갱신은 어떻게 끄나요?'), a('자동 갱신을 끄려면 설정에서 갱신 스위치를 끔으로 바꾸시면 됩니다.')],
    expected: { questions: [question('갱신', 'answered', [1])], promises: [] } },
  { id: 'B07', category: '환불', title: '미정에 명시적 안내 약속이 추가되면 답변 대기', messages: [c('환불 금액은 얼마인가요?'), a('환불 금액은 아직 확정되지 않았습니다. 담당 부서에 확인해서 금액을 안내하겠습니다.')],
    expected: { questions: [question('환불|금액', 'waiting', [1])], promises: [{ message: 1, topic: '확인|안내', state: 'promised', dueAt: null, deadline: '' }] } },
  { id: 'B08', category: '배송', title: '부분 정보가 있어도 남은 정보의 명시적 안내 약속은 대기', messages: [c('제 주문의 추가 배송비는 얼마인가요?'), a('제주도는 추가 배송비 3,000원이고 다른 지역은 무료입니다. 고객님의 배송 지역을 확인해서 이 주문에 적용되는 금액을 안내하겠습니다.')],
    expected: { questions: [question('배송비', 'waiting', [1])], promises: [{ message: 1, topic: '확인|안내', state: 'promised', dueAt: null, deadline: '' }] } },
];
