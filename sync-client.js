// Private, encrypted record sync. A pairing secret stays in the URL fragment, never in server logs.
const syncStorageKey=KEY+'-sync-v1';
let syncState;try{syncState=JSON.parse(localStorage.getItem(syncStorageKey)||'null')}catch{}
const randomHex=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),v=>v.toString(16).padStart(2,'0')).join('');
syncState ||= {device:randomHex(16),key:null,entries:{},outbox:{},baseline:{},clock:0};
const syncStatus=message=>$('syncStatus').textContent=message;
let syncBusy=false,syncDirty=false,syncTimer,cryptoKey;
const persistSync=()=>localStorage.setItem(syncStorageKey,JSON.stringify(syncState));
function syncSnapshot(){const result={};for(const charge of db.charges)result['charge:'+charge.id]={kind:'charge',value:charge};for(const charge of db.trash||[])result['charge:'+charge.id]={kind:'trash',value:charge};for(const reading of db.readings)result['reading:'+reading.date.slice(0,7)]={kind:'reading',value:reading};return JSON.parse(JSON.stringify(result));}
function trackSyncChanges(){
 if(!syncState.key)return;
 const current=syncSnapshot();
 for(const id of new Set([...Object.keys(syncState.baseline),...Object.keys(current)])){
   const value=current[id]||{kind:'deleted'};
   if(JSON.stringify(current[id])!==JSON.stringify(syncState.baseline[id])){
     syncState.clock=Math.max(Date.now(),syncState.clock+1);
     const entry={id,clock:syncState.clock,device:syncState.device,value};
     syncState.entries[id]=entry;syncState.outbox[id]=entry;
   }
 }
 syncState.baseline=current;persistSync();syncDirty=true;
 clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow(),300);
}
const base64=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
const unbase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function syncCryptoKey(){return cryptoKey ||= crypto.subtle.importKey('raw',Uint8Array.from(syncState.key.match(/../g),h=>parseInt(h,16)),'AES-GCM',false,['encrypt','decrypt']);}
async function packEntry(entry){const iv=crypto.getRandomValues(new Uint8Array(12));const aad=new TextEncoder().encode(JSON.stringify([entry.id,entry.clock,entry.device]));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await syncCryptoKey(),new TextEncoder().encode(JSON.stringify(entry.value)));return {id:entry.id,clock:entry.clock,device:entry.device,payload:base64(iv)+'.'+base64(new Uint8Array(ciphertext))};}
async function unpackEntry(entry){const [iv,ciphertext]=entry.payload.split('.');const aad=new TextEncoder().encode(JSON.stringify([entry.id,entry.clock,entry.device]));const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv),additionalData:aad},await syncCryptoKey(),unbase64(ciphertext));const value=JSON.parse(new TextDecoder().decode(clear));if(!['charge','trash','reading','deleted'].includes(value.kind))throw Error('Données partagées invalides');return {...entry,value};}
const newer=(a,b)=>!b||a.clock>b.clock||(a.clock===b.clock&&a.device>b.device);
async function syncNow(){
 if(!syncState.key)return;
 if(syncBusy){syncDirty=true;return;}
 syncBusy=true;syncDirty=false;syncStatus('Synchronisation en cours…');
 try{
   const pending={...syncState.outbox};
   const initial=syncState.bootstrap;
   const payload=await Promise.all(Object.values(pending).map(packEntry));
   const response=await fetch(SYNC_ENDPOINT+'/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+syncState.key},body:JSON.stringify({bootstrap:!!initial,entries:payload}),signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error('Synchronisation indisponible ('+response.status+')');
   const remote=await response.json();
   if(!Array.isArray(remote.entries))throw Error('Réponse invalide');
   const decoded=await Promise.all(remote.entries.map(unpackEntry));
   for(const sent of Object.values(pending))if(syncState.outbox[sent.id]?.clock===sent.clock&&syncState.outbox[sent.id]?.device===sent.device)delete syncState.outbox[sent.id];
   for(const entry of decoded){syncState.clock=Math.max(syncState.clock,entry.clock);if((initial&&!syncState.outbox[entry.id])||newer(entry,syncState.entries[entry.id]))syncState.entries[entry.id]=entry;}
   // Keep edits made while the network request was running.
   for(const entry of Object.values(syncState.outbox))if(newer(entry,syncState.entries[entry.id]))syncState.entries[entry.id]=entry;
   const next={...db,charges:[],readings:[],trash:[]};
   for(const entry of Object.values(syncState.entries)){const v=entry.value;if(v.kind==='charge')next.charges.push(v.value);if(v.kind==='trash')next.trash.push(v.value);if(v.kind==='reading')next.readings.push(v.value);}
   // Persist the merged history before changing the displayed history.
   localStorage.setItem(KEY,JSON.stringify(next));db=next;
   syncState.bootstrap=false;syncState.baseline=syncSnapshot();persistSync();render();
   syncStatus('À jour — '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}));
 }catch(err){syncStatus(navigator.onLine?'Synchronisation en attente. Tes données restent sur cet appareil.':'Hors connexion — synchronisation automatique au retour du réseau.');}
 finally{syncBusy=false;if(syncDirty){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow(),1000);}}
}
async function connectSync(key){
 if(syncBusy)throw Error('Attends la fin de la synchronisation.');
 if(!/^[a-f0-9]{64}$/.test(key))throw Error('Lien privé invalide');
 if(syncState.key&&syncState.key!==key)throw Error('Cet appareil est déjà associé à un historique.');
 if(!syncState.key){
  // Local safety copy before the first merge; it includes this device's existing history.
  localStorage.setItem(KEY+'-before-sync',JSON.stringify(db));
  syncState.key=key;cryptoKey=null;syncState.baseline=syncSnapshot();syncState.bootstrap=true;
  for(const [id,value] of Object.entries(syncState.baseline)){const entry={id,value,clock:++syncState.clock,device:syncState.device};syncState.entries[id]=entry;syncState.outbox[id]=entry;}
  persistSync();
 }
 $('startSync').hidden=true;$('pairSync').hidden=false;await syncNow();
}
$('startSync').onclick=async()=>{try{await connectSync(randomHex(32))}catch(err){syncStatus(err.message)}};
$('pairSync').onclick=async()=>{
 const link=new URL(location.href);link.hash='sync='+syncState.key;
 try{if(navigator.share){await navigator.share({title:'Associer Shimix Charge',text:'Lien privé : ouvre-le uniquement sur ton autre appareil.',url:link.href});return;}await navigator.clipboard.writeText(link.href);syncStatus('Lien privé copié. Ouvre-le sur ton autre appareil une seule fois.');}catch(err){if(err.name!=='AbortError'){const field=$('syncLink');field.hidden=false;field.value=link.href;field.select();syncStatus('Copie ce lien privé pour ton autre appareil.');}}
};
$('syncNow').onclick=()=>syncNow();
const pairingKey=new URLSearchParams(location.hash.slice(1)).get('sync');
if(pairingKey){history.replaceState(null,'',location.pathname+location.search);connectSync(pairingKey).catch(err=>syncStatus(err.message));}
else if(syncState.key){$('startSync').hidden=true;$('pairSync').hidden=false;syncNow();}
else syncStatus('Associe tes appareils une seule fois pour synchroniser automatiquement ton historique.');
window.addEventListener('online',()=>syncNow());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncNow()});
setInterval(()=>{if(!document.hidden)syncNow()},15000);
