const form=document.querySelector('#auth-form'), error=document.querySelector('#auth-error');
let registration=false, busy=false;
document.querySelector('#auth-switch').addEventListener('click',()=>{
  registration=!registration; error.textContent='';
  document.querySelector('#confirm-field').hidden=!registration;
  form.elements.confirm.required=registration;
  form.elements.password.autocomplete=registration?'new-password':'current-password';
  document.querySelector('#auth-title').textContent=registration?'내 문의를 위한 계정 만들기':'내 문의를 이어서 정리하세요.';
  document.querySelector('#auth-description').textContent=registration?'아이디와 비밀번호만 만들면 바로 사용할 수 있어요.':'로그인하면 저장한 문의와 진행 상황을 볼 수 있어요.';
  document.querySelector('#auth-submit').textContent=registration?'계정 만들고 시작하기':'로그인';
  document.querySelector('#auth-switch').textContent=registration?'이미 계정이 있어요 · 로그인':'처음이신가요? 회원가입';
  form.elements.password.value=''; form.elements.confirm.value=''; form.elements.username.focus();
});
form.addEventListener('submit',async event=>{
  event.preventDefault(); if(busy)return; error.textContent='';
  if(registration&&form.elements.password.value!==form.elements.confirm.value){error.textContent='비밀번호가 서로 다릅니다.';form.elements.confirm.focus();return;}
  busy=true; const data={username:form.elements.username.value.trim(),password:form.elements.password.value};
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
    const res=await fetch(`/api/auth/${registration?'register':'login'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
    const result=await res.json(); if(!res.ok)throw Error(result.error||'로그인하지 못했어요.'); form.reset(); location.replace('/');
  }catch(e){error.textContent=e.name==='TimeoutError'?'연결이 지연되고 있어요. 잠시 뒤 다시 시도해 주세요.':e.message;}
  finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}
});
