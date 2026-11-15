import { cases } from './support-cases.mjs';
import { unseenCases } from './unseen-cases.mjs';
const role=(role,text)=>({role,text,sentAt:null});
export const registrationCases=[...cases.filter(c=>['S06','R03'].includes(c.id)),...unseenCases.filter(c=>['NS03','NU02'].includes(c.id)),
  {id:'WEB-REFUND',title:'환불 금액·결제수단·예정일',messages:[role('customer','환불 금액은 얼마인가요? 어떤 결제수단으로 환불되나요? 환불 예정일은 언제인가요?'),role('agent','환불 금액은 79,000원입니다. 환불 예정일은 담당 부서 확인 후 11월 18일까지 안내하겠습니다.')],
    expected:{questions:[{message:0,topic:'금액',status:'answered',evidence:[1]},{message:0,topic:'결제|수단',status:'unanswered',evidence:[]},{message:0,topic:'예정|날짜|언제',status:'waiting',evidence:[1]}],promises:[{message:1,topic:'예정|안내|확인',state:'promised',dueAt:null,deadline:'11월 18일'}]},
    next:[role('agent','환불은 원래 결제하신 카드로 진행됩니다. 환불 예정일은 아직 확인 중이며 11월 18일까지 안내하겠습니다.')],
    after:{questions:[{message:0,topic:'금액',status:'answered',evidence:[1]},{message:0,topic:'결제|수단',status:'answered',evidence:[2]},{message:0,topic:'예정|날짜|언제',status:'waiting',evidence:[2]}],promises:[{message:2,messageOptions:[1,2],topic:'예정|안내|확인',state:'promised',dueAt:null,deadline:'11월 18일'}]}},
  {id:'WEB-EMAIL',title:'계정 복구 영어 문의',channel:'email',messages:[role('customer','What documents do I need to recover my account? How long will the review take? What is my case reference number?'),role('agent','Please provide the transaction ID from your purchase receipt. Do not send your password or verification codes.')],
    expected:{questions:[{message:0,topic:'서류|자료|문서',status:'answered',evidence:[1]},{message:0,topic:'기간|시간|얼마나|소요',status:'unanswered',evidence:[]},{message:0,topic:'번호',status:'unanswered',evidence:[]}],promises:[]},
    next:[role('agent','We received your transaction ID. The review will take 3 business days. Your account has not been restored yet.')],
    after:{questions:[{message:0,topic:'서류|자료|문서',status:'answered',evidence:[1]},{message:0,topic:'기간|시간|얼마나|소요',status:'answered',evidence:[2]},{message:0,topic:'번호',status:'unanswered',evidence:[]}],promises:[{message:2,topic:'수신|접수|거래|수령|[Rr]eceived',state:'reported',dueAt:null,deadline:'',isNew:true}]}}
];
