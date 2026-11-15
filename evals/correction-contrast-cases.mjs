const c = text => ({ role: 'customer', text, sentAt: null });
const a = text => ({ role: 'agent', text, sentAt: null });
const q = (topic,status,evidence,reasonPattern) => ({message:0,topic,status,evidence,...(reasonPattern?{reasonPattern}:{})});
const p = (topic,message,deadline) => ({topic,message,deadline,dueAt:deadline.includes('23')?'2026-11-23':deadline.includes('22')?'2026-11-22':'2026-11-20',state:'promised'});
export const correctionContrastCases = [
  { id:'CR01', title:'기한 취소를 부정하는 정정', messages:[c('배송 위치가 어디인가요?'),a('배송 위치를 확인해 2026년 11월 20일까지 안내하겠습니다.')],
    expected:{questions:[q('배송|위치','waiting',[1])],promises:[p('위치|안내|확인',1,'2026년 11월 20일')]},
    next:[a('앞서 말씀드린 2026년 11월 20일 안내 기한은 취소하지 않습니다. 그날까지 위치를 확인해 안내하겠습니다.')],
    // Same action and unchanged deadline: either equivalent statement grounds it.
    after:{questions:[q('배송|위치','waiting',[2])],promises:[{...p('위치|안내|확인',2,'2026년 11월 20일'),messageOptions:[1,2]}]} },
  { id:'CR02', title:'기존 기한 철회와 새 기한 지정', messages:[c('쿠폰이 복구됐나요?'),a('쿠폰 복구 여부를 확인해 2026년 11월 20일까지 알려드리겠습니다.')],
    expected:{questions:[q('쿠폰|복구','waiting',[1])],promises:[p('쿠폰|복구|안내|확인',1,'2026년 11월 20일')]},
    next:[a('기존 안내 기한은 취소합니다. 대신 2026년 11월 22일까지 쿠폰 복구 여부를 확인해 알려드리겠습니다.')],
    after:{questions:[q('쿠폰|복구','waiting',[2])],promises:[p('쿠폰|복구|안내|확인',2,'2026년 11월 22일')]} },
  { id:'CR03', title:'영어 금액 정정', channel:'email', messages:[c('What is the repair fee?'),a('The repair fee is 24000 KRW.')],
    expected:{questions:[q('수리|요금|비용','answered',[1])],promises:[]},
    next:[a('Correction: the repair fee is 18000 KRW, not 24000 KRW.')],
    after:{questions:[q('수리|요금|비용','answered',[2],'18,?000')],promises:[]} },
  { id:'CR04', title:'정정 뒤 조건부 요금과 승인 미정', messages:[c('추가 배송비가 얼마인가요?'),a('추가 배송비는 3,000원입니다.')],
    expected:{questions:[q('배송비','answered',[1])],promises:[]},
    next:[a('배송비 안내를 정정합니다. 특별 승인이 나면 무료입니다. 승인되지 않으면 3,000원입니다. 현재 고객님 건의 승인 여부는 확인되지 않았습니다.')],
    after:{questions:[q('배송비','partial',[2])],promises:[]} },
  { id:'CR05', title:'실제 발송일 정정과 다른 날짜의 부정', messages:[c('보증서를 언제 보내주시나요?'),a('보증서는 2026년 11월 20일까지 보내겠습니다.')],
    expected:{questions:[q('보증서|발송','answered',[1])],promises:[p('보증서|발송|전송',1,'2026년 11월 20일')]},
    next:[a('앞서 안내한 보증서 발송일을 정정합니다. 21일이 아니라 2026년 11월 23일까지 보내겠습니다.')],
    after:{questions:[q('보증서|발송','answered',[2],'23')],promises:[p('보증서|발송|전송',2,'2026년 11월 23일')]} },
  { id:'CR06', title:'실제로 일부만 알려준 서류 목록', channel:'email', messages:[c('What is the full list of required documents?'),a('So far we know your receipt ID is required. The other required documents are still being checked.')],
    expected:{questions:[q('자료|서류|문서|목록','partial',[1])],promises:[]},
    next:[a('The required documents are your receipt ID and a photo of the damaged item. No identity document is required.')],
    after:{questions:[q('자료|서류|문서|목록','answered',[2],'사진|photo')],promises:[]} },
];
