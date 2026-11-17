const form=document.querySelector('#auth-form'), error=document.querySelector('#auth-error');
const guestButton=document.querySelector('#guest-start');
let registration=new URLSearchParams(location.search).get('register')==='1', busy=false, guest=false;
function renderMode(){
  document.querySelector('#confirm-field').hidden=!registration;
  form.elements.confirm.required=registration;
  form.elements.password.autocomplete=registration?'new-password':'current-password';
  document.querySelector('#auth-title').textContent=registration?'내 문의를 위한 계정 만들기':'내 문의를 이어서 정리하세요.';
  document.querySelector('#auth-description').textContent=guest
    ? (registration?'가입하면 비회원으로 저장한 문의도 이 계정에 보관해요.':'로그인하면 비회원 문의도 기존 계정에 함께 보관해요.')
    : (registration?'아이디와 비밀번호만 만들면 바로 사용할 수 있어요.':'가입 없이 시작하거나, 로그인해서 저장한 문의를 이어가세요.');
  document.querySelector('#auth-submit').textContent=registration?'계정 만들고 시작하기':'로그인';
  document.querySelector('#account-heading').textContent=registration?'계정 정보 입력':'계정으로 이어서 이용하기';
  document.querySelector('#auth-submit').classList.toggle('primary',registration);
  document.querySelector('#auth-submit').classList.toggle('secondary',!registration);
  guestButton.classList.toggle('primary',!registration);guestButton.classList.toggle('secondary',registration);
  guestButton.textContent=guest?'비회원으로 계속하기':'가입 없이 시작하기';
  document.querySelector('#auth-switch').textContent=registration?'이미 계정이 있어요 · 로그인':'처음이신가요? 회원가입';
}
document.querySelector('#auth-switch').addEventListener('click',()=>{
  if(busy)return;
  registration=!registration;error.textContent='';renderMode();
  form.elements.password.value=''; form.elements.confirm.value=''; form.elements.username.focus();
});
async function submit(kind,data){
  if(busy)return;busy=true;error.textContent='';
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  const active=kind==='guest'?guestButton:document.querySelector('#auth-submit');
  active.textContent=kind==='guest'?'문의 공간을 준비하고 있어요…':'연결하고 있어요…';
  try{
    const res=await fetch(`/api/auth/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
    const result=await res.json().catch(()=>null);
    if(!res.ok||!result?.user)throw Error(result?.error||'서버에 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.');form.reset();location.replace('/');
  }catch(e){error.textContent=e.name==='TimeoutError'?'연결이 지연되고 있어요. 잠시 뒤 다시 시도해 주세요.':e instanceof TypeError?'인터넷 연결을 확인한 뒤 다시 눌러 주세요.':e.message;}
  finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);renderMode();}
}
guestButton.addEventListener('click',()=>submit('guest',{}));
form.addEventListener('submit',event=>{
  event.preventDefault();if(busy)return;error.textContent='';
  if(registration&&form.elements.password.value!==form.elements.confirm.value){error.textContent='비밀번호가 서로 다릅니다.';form.elements.confirm.focus();return;}
  submit(registration?'register':'login',{username:form.elements.username.value.trim(),password:form.elements.password.value});
});
renderMode();
try{const res=await fetch('/api/auth/me',{signal:AbortSignal.timeout(10000)});if(res.ok){guest=(await res.json()).user?.role==='guest';if(!busy)renderMode();}}catch{/* Starting a session remains available if this optional check fails. */}
