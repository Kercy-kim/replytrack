// Positive/negative pairs test the semantic reviewer independently of the generator.
import { reviewedSources, guideEvidence } from '../src/official-guide.mjs';
const message=(id,role,text)=>({id,role,text});
const item=(quote,extra={})=>({id:'task-1',title:'상품 포장',source:{messageId:'m1',quote},state:'requested',update:null,condition:'',dueText:'',...extra});
const pair=(id,kind,data,mutate)=>{
  const bad=structuredClone(data);mutate(bad);
  return [{id:`${id}-valid`,kind,expected:true,data},{id:`${id}-invalid`,kind,expected:false,data:bad}];
};
export const reviewControls=[
  ...pair('C01','actions',{messages:[message('m1','agent','상품을 포장해 주세요.'),message('m2','customer','아직 포장하지 못했습니다. 오늘 하겠습니다.')],existingItems:[],items:[item('상품을 포장해 주세요.')]},d=>{d.items[0].state='reported_done';d.items[0].update={messageId:'m2',quote:d.messages[1].text};}),
  ...pair('C02','actions',{messages:[message('m1','agent','사진을 보내 주세요.'),message('m2','agent','사진은 잘 받았습니다.')],existingItems:[],items:[item('사진을 보내 주세요.',{title:'사진 제출',state:'reported_done',update:{messageId:'m2',quote:'사진은 잘 받았습니다.'}})]},d=>{d.items[0].state='requested';d.items[0].update=null;}),
  ...pair('C03','actions',{messages:[message('m1','agent','상품을 포장해 주세요.')],existingItems:[item('상품을 포장해 주세요.')],items:[item('상품을 포장해 주세요.')]},d=>d.items.push({...structuredClone(d.items[0]),id:'task-2'})),
  ...pair('C04','actions',{messages:[message('m1','agent','업체에서 금요일 수거를 접수하겠습니다. 상품을 포장해 주세요.')],existingItems:[],items:[item('업체에서 금요일 수거를 접수하겠습니다. 상품을 포장해 주세요.')]},d=>{d.items[0].dueText='금요일';}),
  ...pair('C05','actions',{messages:[message('m1','agent','새 상품을 받은 뒤 기존 상품을 반송해 주세요.')],existingItems:[],items:[item('새 상품을 받은 뒤 기존 상품을 반송해 주세요.',{title:'기존 상품 반송',condition:'새 상품을 받은 뒤'})]},d=>{d.items[0].condition='';}),
  ...pair('C06','actions',{messages:[message('m1','agent','상품을 포장해 주세요.'),message('m2','customer','포장하지 않겠습니다.')],existingItems:[],items:[item('상품을 포장해 주세요.')]},d=>{d.items[0].state='withdrawn';d.items[0].update={messageId:'m2',quote:d.messages[1].text};}),
];
reviewControls.push(...pair('C13','actions',{messages:[message('m0','customer','택배 수거를 요청합니다.'),message('m1','agent','저희가 내일 기사 방문을 접수하겠습니다. 상품을 상자에 담아 문 앞에 준비해 주세요.')],existingItems:[],items:[item('저희가 내일 기사 방문을 접수하겠습니다. 상품을 상자에 담아 문 앞에 준비해 주세요.',{title:'상품 포장 후 문 앞에 준비'})]},d=>{d.items[0].condition='저희가 내일 기사 방문을 접수하겠습니다.';}));
const sources=reviewedSources.filter(s=>s.id==='saved-refund');
const evidence=guideEvidence(sources), claim=(text,index)=>({text,sourceId:evidence[index].sourceId,quote:evidence[index].quote});
const guideData={user:{store:'ssg',goal:'SSG에서 어제 카드로 결제하고 오늘 전액 취소됐어요. 카드에 언제 반영되나요?',answers:{payment:'card',refundState:'approved'}},confirmedSituation:[{question:'결제 방법',answer:'카드'},{question:'취소 상황',answer:'완료 안내'}],intent:'refund',sources,evidence,guide:{steps:[claim('실제 반영 여부는 카드사에서 확인하세요.',2)],conditions:[claim('결제일 이후 취소는 영업일 3~7일로 안내합니다.',1)],unknowns:['개별 카드 내역에 실제로 반영됐는지는 확인이 필요합니다.']}};
reviewControls.push(
  ...pair('C07','guide',guideData,d=>{d.guide.conditions[0].text='결제일 이후 취소는 영업일 30일 이내에 반영됩니다.';}),
  ...pair('C08','guide',guideData,d=>{d.guide.unknowns.push('주문 더하기로 추가 결제했는지 알려 주세요.');}),
  ...pair('C09','guide',guideData,d=>{d.guide.steps[0].text='이미 고객님의 카드에 환불이 완료되었습니다.';}),
  ...pair('C10','guide',guideData,d=>{d.guide.conditions[0].quote=evidence[2].quote;}),
);
const returnSources=reviewedSources.filter(s=>s.topics.includes('return'));
const returnEvidence=guideEvidence(returnSources);
const returnClaim=(text,pattern)=>{const ref=returnEvidence.find(e=>pattern.test(e.quote));return {text,sourceId:ref.sourceId,quote:ref.quote};};
const freshData={user:{store:'ssg',goal:'SSG에서 받은 신선식품을 단순 변심으로 반품하고 싶어요.',answers:{reason:'mind',received:'week'}},confirmedSituation:[{key:'reason',answer:'단순 변심'},{key:'received',answer:'7일 이내'}],intent:'return',sources:returnSources,evidence:returnEvidence,guide:{steps:[returnClaim('해당 상품 상세페이지의 교환·반품 조건을 확인하세요.',/개별 상품 상세/)],conditions:[returnClaim('신선식품이면 단순 변심 반품·교환 대상이 아닙니다.',/신선식품/)],unknowns:['해당 상품 상세페이지에 어떤 개별 조건이 표시되어 있는지 확인이 필요합니다.']}};
reviewControls.push(...pair('C11','guide',freshData,d=>{d.guide.steps=[returnClaim('고객센터에 예외 신청을 하면 신선식품의 단순 변심 반품도 접수해 줍니다.',/채팅, 이메일/)];}));
const installed=structuredClone(freshData);installed.user.goal='SSG에서 구입한 설치 완료 냉장고를 단순 변심으로 반품하고 싶어요.';installed.guide.conditions=[returnClaim('설치 이후의 설치상품은 단순 변심 반품·교환 대상이 아닙니다.',/설치 이후/)];
reviewControls.push(...pair('C12','guide',installed,d=>{d.guide.conditions[0].text='설치상품은 설치 전이든 후든 단순 변심 반품이 모두 불가능합니다.';}));
const cancelSources=reviewedSources.filter(s=>s.id==='saved-cancel'),cancelEvidence=guideEvidence(cancelSources);
const cancelClaim=(text,pattern)=>{const ref=cancelEvidence.find(e=>pattern.test(e.quote));return {text,sourceId:ref.sourceId,quote:ref.quote};};
const cancelData={user:{store:'ssg',goal:'SSG 티셔츠 주문을 취소하고 싶어요.',answers:{order:'preparing'}},confirmedSituation:[{key:'order',answer:'상품 준비 중'}],intent:'cancel',sources:cancelSources,evidence:cancelEvidence,guide:{steps:[cancelClaim('상품 준비 중이므로 취소 요청을 하면 판매자가 출고 여부를 확인합니다.',/상품 준비 중/)],conditions:[cancelClaim('출고가 시작되면 취소가 거절되어 배송될 수 있습니다. 요청과 완료를 구분하세요.',/출고가 시작되면/),cancelClaim('주문 제작이 진행된 상품은 취소가 어려울 수 있습니다.',/주문 제작/)],unknowns:['주문 제작이 진행된 상품인가요?']}};
reviewControls.push(...pair('C14','guide',cancelData,d=>{d.guide.conditions[0].text='상품 준비 중이라 취소 요청을 하면 반드시 취소가 완료됩니다.';}));
