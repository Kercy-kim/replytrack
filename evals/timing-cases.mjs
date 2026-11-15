// Contrast controls for processing time versus time to provide an answer.
// Harness calibration is documented in docs/USABILITY-COMPLETENESS.md.
const c = text => ({ role: 'customer', text, sentAt: null });
const a = text => ({ role: 'agent', text, sentAt: null });
export const timingCases = [
  { id: 'T01', category: '환불', title: '환불 날짜를 알아봐 줄 기한',
    messages: [c('환불 예정일은 언제인가요?'), a('환불 예정일은 담당 부서 확인 후 11월 18일까지 안내하겠습니다.')],
    expected: { questions: [{ message: 0, topic: '환불', status: 'waiting', evidence: [1] }], promises: [{ topic: '안내|확인|예정일', state: 'promised', message: 1, dueAt: null, deadline: '11월 18일' }] } },
  { id: 'T02', category: '환불', title: '환불 날짜 안내 자체의 기한 질문',
    messages: [c('환불 예정일을 언제까지 알려주시나요?'), a('환불 예정일은 담당 부서 확인 후 11월 18일까지 안내하겠습니다.')],
    expected: { questions: [{ message: 0, topic: '환불|안내', status: 'answered', evidence: [1] }], promises: [{ topic: '안내|확인|예정일', state: 'promised', message: 1, dueAt: null, deadline: '11월 18일' }] } },
  { id: 'T03', category: '환불', title: '실제 환불 처리 예정일',
    messages: [c('환불 예정일은 언제인가요?'), a('11월 18일까지 환불하겠습니다.')],
    expected: { questions: [{ message: 0, topic: '환불', status: 'answered', evidence: [1] }], promises: [{ topic: '환불', state: 'promised', message: 1, dueAt: null, deadline: '11월 18일' }] } },
  { id: 'T04', category: '배송', title: '처리 날짜와 이후 안내 약속이 모두 있는 답변',
    messages: [c('교환품은 언제 발송하나요?'), a('교환품은 11월 18일에 발송하겠습니다.'), a('발송 후 운송장 번호를 안내하겠습니다.')],
    expected: { questions: [{ message: 0, topic: '발송|교환', status: 'answered', evidence: [1] }], promises: [{ topic: '발송', state: 'promised', message: 1, dueAt: null, deadline: '11월 18일' }, { topic: '운송장|번호', state: 'promised', message: 2, dueAt: null, deadlineOptions: ['', '발송 후'] }] } },
];
