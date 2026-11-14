// Contrast controls frozen before the first live reason-scope evaluation.
// These complement (and do not replace or change) the existing 48 cases.
const c = text => ({ role: 'customer', text, sentAt: null });
const a = text => ({ role: 'agent', text, sentAt: null });
export const reasonCases = [
  { id: 'Q01', category: '구독', title: '실제로 요청한 상세 경로는 생략하지 않기',
    messages: [c('자동 갱신을 끄려는데 앱에서 어느 화면을 차례로 눌러야 하나요? 구체적인 화면 경로를 알려 주세요.'), a('설정에서 갱신 스위치를 끔으로 바꾸시면 됩니다. 구체적인 화면 경로는 알 수 없습니다.')],
    expected: { questions: [{ message: 0, topic: '갱신|경로|화면', status: 'partial', evidence: [1] }], promises: [] } },
  { id: 'Q02', category: '환불', title: '실제로 요청한 입금 시각은 생략하지 않기',
    messages: [c('환불금이 제 은행 계좌에 실제로 입금된 정확한 시각을 알려 주세요.'), a('은행 계좌의 실제 입금 시각은 저희 쪽에서 알 수 없습니다.')],
    expected: { questions: [{ message: 0, topic: '입금|시각', status: 'review', evidence: [1] }], promises: [] } },
  { id: 'Q03', category: '환불', title: '답변에 실제로 있는 예외 조건은 보존하기',
    messages: [c('이미 사용한 제품인데 환불 가능한가요?'), a('사용한 제품은 원칙적으로 환불 불가하지만, 제품 불량이 확인되면 환불 가능합니다.')],
    expected: { questions: [{ message: 0, topic: '환불', status: 'answered', evidence: [1] }], promises: [] } },
  { id: 'Q04', category: '배송', title: '방문 날짜와 별도로 질문한 시각을 구분하기',
    messages: [c('방문 배송 날짜는 언제인가요?'), c('그날 정확히 몇 시에 방문하나요?'), a('방문 배송 날짜는 11월 20일입니다. 정확한 방문 시각은 아직 정해지지 않았습니다.')],
    expected: { questions: [{ message: 0, topic: '날짜|언제|일', status: 'answered', evidence: [2] }, { message: 1, topic: '시|방문', status: 'review', evidence: [2] }], promises: [] } },
];
