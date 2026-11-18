// Supabase-tilkobling. Kun publiserbar nøkkel brukes i nettleseren.
const CLOUD_URL='https://fwjckmgewspevokemchn.supabase.co';
const CLOUD_KEY='sb_publishable_yqbi_IGTz0UG-pLv8nd2Cw_0VQUgsPj';
const CLOUD_SESSION_KEY='jj-cloud-session-v1';
let cloudSession=null,cloudUser=null,cloudPending=Promise.resolve(),cloudReady=false;
const authMessage=(message,isError=false)=>{const out=$('authMessage');out.textContent=message;out.style.color=isError?'#ac2925':'#35546f'};
const cloudHeaders=(token=cloudSession?.access_token)=>({'apikey':CLOUD_KEY,'Authorization':'Bearer '+(token||CLOUD_KEY),'Content-Type':'application/json'});
async function cloudRequest(path,{method='GET',body=null,token,prefer}={}){
 const h=cloudHeaders(token);if(prefer)h.Prefer=prefer;
 const response=await fetch(CLOUD_URL+path,{method,headers:h,body:body===null?undefined:JSON.stringify(body)});
 const raw=await response.text();let json;try{json=raw?JSON.parse(raw):null}catch{json=raw}
 if(!response.ok)throw Error(json?.msg||json?.message||json?.error_description||json?.error||'Serverfeil ('+response.status+')');
 return json;
}
function saveCloudSession(session){cloudSession=session;localStorage.setItem(CLOUD_SESSION_KEY,JSON.stringify(session))}
async function cloudAccessToken(){
 if(!cloudSession)throw Error('Du må logge inn');
 if(Date.now()+60000>cloudSession.expires_at*1000){
  let r=await cloudRequest('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:cloudSession.refresh_token}});
  saveCloudSession({...r,expires_at:Math.floor(Date.now()/1000)+(r.expires_in||3600)});
 }
 return cloudSession.access_token;
}
function recordKey(row){return row.party+'|'+row.training_date}
function cloudRow(key,value){const [party,training_date]=key.split('|');return {user_id:cloudUser.id,party,training_date,warm:value.warm||'',main:value.main||'',end:value.end||'',note:value.note||'',format:value.format==='html'?'html':'text'}}
function queueCloud(key,value){
 if(!cloudReady)return;
 const snapshot=value?structuredClone(value):null;
 cloudPending=cloudPending.catch(()=>{}).then(async()=>{
  const token=await cloudAccessToken(),[party,date]=key.split('|');
  if(snapshot){
   await cloudRequest('/rest/v1/training_sessions?on_conflict=user_id,party,training_date',{method:'POST',token,prefer:'resolution=merge-duplicates,return=minimal',body:cloudRow(key,snapshot)});
  }else{
   await cloudRequest('/rest/v1/training_sessions?party=eq.'+encodeURIComponent(party)+'&training_date=eq.'+date,{method:'DELETE',token});
  }
  $('saved').textContent='Lagret i skyen ✓';
 }).catch(error=>{$('saved').textContent='Kun lokalt – skyfeil';authMessage('Kunne ikke lagre i databasen: '+error.message,true);throw error});
}
async function cloudLoad(){
 const token=await cloudAccessToken();
 const rows=await cloudRequest('/rest/v1/training_sessions?select=party,training_date,warm,main,end,note,format,updated_at&order=training_date.desc&limit=10000',{token});
 const localBefore={...data};
 if(Object.keys(localBefore).length&& !localStorage.getItem('jj-dagbok-precloud-backup'))localStorage.setItem('jj-dagbok-precloud-backup',JSON.stringify(localBefore));
 data={};for(const row of rows){data[recordKey(row)]={warm:row.warm,main:row.main,end:row.end,note:row.note,format:row.format,updated:row.updated_at}}
 localStorage.setItem(KEY,JSON.stringify(data));
 cloudReady=true;lastKey='';prevIndex=0;render();
 $('cloudAccount').textContent=cloudUser.email||'Innlogget';$('cloudStatus').hidden=false;
 $('authPanel').hidden=true;document.body.classList.remove('cloud-locked');
 $('importLocal').hidden=!Object.keys(localBefore).some(k=>!data[k]);
 authMessage('');
}
async function cloudLogin(email,password,isSignup){
 try{
  $('authSubmit').disabled=true;authMessage('Kontakter databasen …');
  const endpoint=isSignup?'/auth/v1/signup':'/auth/v1/token?grant_type=password';
  const options=isSignup?{email,password,options:{email_redirect_to:location.origin+location.pathname}}:{email,password};
  const result=await cloudRequest(endpoint,{method:'POST',body:options});
  if(!result.access_token){authMessage('Brukeren er registrert. Sjekk e-posten din og bekreft kontoen. Deretter logger du inn.');return}
  saveCloudSession({...result,expires_at:Math.floor(Date.now()/1000)+(result.expires_in||3600)});
  cloudUser=result.user;await cloudLoad();
 }catch(error){authMessage(error.message,true)}finally{$('authSubmit').disabled=false}
}
async function cloudRestore(){
 try{
  const saved=JSON.parse(localStorage.getItem(CLOUD_SESSION_KEY)||'null');
  if(!saved?.refresh_token)return;
  cloudSession=saved;
  const token=await cloudAccessToken();
  cloudUser=await cloudRequest('/auth/v1/user',{token});
  await cloudLoad();
 }catch(error){cloudSession=null;cloudUser=null;cloudReady=false;localStorage.removeItem(CLOUD_SESSION_KEY);authMessage('Logg inn for å åpne treningsdagboken.')}
}
$('authForm').onsubmit=event=>{
 event.preventDefault();cloudLogin($('authEmail').value.trim(),$('authPassword').value,$('authMode').value==='signup');
};
$('authMode').onchange=()=>{$('authSubmit').textContent=$('authMode').value==='signup'?'Opprett konto':'Logg inn';authMessage('')};
$('cloudLogout').onclick=async()=>{
 try{if(cloudSession)await cloudRequest('/auth/v1/logout',{method:'POST',token:await cloudAccessToken()})}catch{}
 cloudSession=null;cloudUser=null;cloudReady=false;localStorage.removeItem(CLOUD_SESSION_KEY);
 data={};lastKey='';render();$('authPanel').hidden=false;$('cloudStatus').hidden=true;document.body.classList.add('cloud-locked');authMessage('Du er logget ut.');
};
$('importLocal').onclick=async()=>{
 const backup=JSON.parse(localStorage.getItem('jj-dagbok-precloud-backup')||'{}');
 const entries=Object.entries(backup).filter(([k])=>!data[k]);
 if(!entries.length){alert('Ingen lokale økter å importere');return}
 if(!confirm('Overføre '+entries.length+' lokale treningsøkter til skyen? Eksisterende skyøkter blir ikke overskrevet.'))return;
 for(const [key,record] of entries){data[key]=record;queueCloud(key,record)}
 localStorage.setItem(KEY,JSON.stringify(data));render();$('importLocal').hidden=true;
 await cloudPending.catch(()=>{});alert('Overføringen er forsøkt. Kontroller lagringsstatusen før du avslutter.');
};
document.body.classList.add('cloud-locked');
cloudRestore();
