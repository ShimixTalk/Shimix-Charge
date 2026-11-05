import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createSyncServer} from './server.mjs';

async function start(path){const server=createSyncServer({path});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:'http://127.0.0.1:'+server.address().port};}
async function stop(server){await new Promise(resolve=>server.close(resolve));}
function device(endpoint,db={charges:[],readings:[],trash:[]}){
 const elements={};const storage=new Map();const events={};
 const ctx=vm.createContext({crypto:globalThis.crypto,TextEncoder,TextDecoder,Uint8Array,Uint32Array,btoa,atob,URL,URLSearchParams,AbortSignal,JSON,Date,Map,Set,Promise,console,
 fetch:globalThis.fetch,navigator:{onLine:true},setInterval:()=>{},setTimeout:()=>0,clearTimeout:()=>{},
 localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
 document:{hidden:false,addEventListener:()=>{}},window:{addEventListener:(name,fn)=>events[name]=fn},
 location:{href:'https://shimixtalk.github.io/Shimix-Charge/',hash:'',pathname:'/Shimix-Charge/',search:''},history:{replaceState:()=>{}},
 $:id=>elements[id]||=( {textContent:'',value:'',hidden:false}),render:()=>{}});
 vm.runInContext('const KEY="test"; const SYNC_ENDPOINT='+JSON.stringify(endpoint)+'; let db='+JSON.stringify(db)+';',ctx);
 vm.runInContext(readFileSync(new URL('../sync-client.js',import.meta.url),'utf8'),ctx);
 return {run:code=>vm.runInContext(code,ctx),data:()=>JSON.parse(vm.runInContext('JSON.stringify(db)',ctx)),storage,events};
}

test('encrypted Mac/iPhone sync: merge histories, offline additions, trash, deletion, restore, isolation, restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shimix-sync-'));const path=join(dir,'data.sqlite');
 let {server,url}=await start(path);
 try{
  const mac=device(url,{charges:[{id:'mac',date:'2026-11-03',station:'Electra',kwh:22.042,cost:4.19}],readings:[],trash:[]});
  const iphone=device(url,{charges:[{id:'phone',date:'2026-11-02',station:'Leclerc',kwh:18,cost:3}],readings:[],trash:[]});
  const key='a'.repeat(64);await mac.run('connectSync('+JSON.stringify(key)+')');await iphone.run('connectSync('+JSON.stringify(key)+')');await mac.run('syncNow()');
  assert.equal(mac.data().charges.length,2);assert.equal(iphone.data().charges.length,2);
  mac.run("db.charges.find(x=>x.id==='mac').cost=5;trackSyncChanges()");
  iphone.run("db.charges.push({id:'offline',station:'Tesla',date:'2026-11-04',kwh:4,cost:1});trackSyncChanges()");
  await Promise.all([mac.run('syncNow()'),iphone.run('syncNow()')]);await mac.run('syncNow()');await iphone.run('syncNow()');
  assert.equal(mac.data().charges.length,3);assert.equal(iphone.data().charges.find(x=>x.id==='mac').cost,5);
  mac.run("db.trash.push({...db.charges.find(x=>x.id==='mac'),deletedAt:'now'});db.charges=db.charges.filter(x=>x.id!=='mac');trackSyncChanges()");await mac.run('syncNow()');await iphone.run('syncNow()');assert.equal(iphone.data().trash.length,1);
  iphone.run("db.charges.push(db.trash[0]);db.trash=[];trackSyncChanges()");await iphone.run('syncNow()');await mac.run('syncNow()');assert.equal(mac.data().charges.length,3);
  mac.run("db.charges=db.charges.filter(x=>x.id!=='mac');trackSyncChanges()");await mac.run('syncNow()');
  const stale=device(url,{charges:[{id:'mac',station:'obsolete'}],readings:[],trash:[]});await stale.run('connectSync('+JSON.stringify(key)+')');assert.equal(stale.data().charges.some(x=>x.id==='mac'),false);
  const foreign=device(url);await foreign.run('connectSync('+JSON.stringify('b'.repeat(64))+')');assert.equal(foreign.data().charges.length,0);
  const raw=await fetch(url+'/sync',{method:'POST',headers:{Authorization:'Bearer '+key},body:JSON.stringify({entries:[]})});const text=await raw.text();assert.equal(text.includes('Leclerc'),false);assert.equal(text.includes('Tesla'),false);
  const unauth=await fetch(url+'/sync',{method:'POST',body:'{}'});assert.equal(unauth.status,401);
  const cross=await fetch(url+'/sync',{method:'POST',headers:{Origin:'https://evil.example',Authorization:'Bearer '+key},body:'{}'});assert.equal(cross.status,403);
  const invalid=await fetch(url+'/sync',{method:'POST',headers:{Authorization:'Bearer '+key},body:JSON.stringify({entries:[{id:'invalid'}]})});assert.equal(invalid.status,400);
  await stop(server);({server,url}=await start(path));
  const restarted=device(url);await restarted.run('connectSync('+JSON.stringify(key)+')');assert.equal(restarted.data().charges.length,2);
 }finally{await stop(server);rmSync(dir,{recursive:true,force:true});}
});
