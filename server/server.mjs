import http from 'node:http';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export function createSyncServer({path=process.env.DB_PATH||'./data/charge.sqlite',origins=['https://shimixtalk.github.io'],maxVaults=100}={}) {
  mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (vault TEXT NOT NULL, id TEXT NOT NULL, clock INTEGER NOT NULL, device TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(vault,id));');
  const list=db.prepare('SELECT id,clock,device,payload FROM records WHERE vault=?');
  const get=db.prepare('SELECT clock,device FROM records WHERE vault=? AND id=?');
  const put=db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?,?,?)');
  const server=http.createServer(async(req,res)=>{
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    const origin=req.headers.origin;
    if(origin&&!origins.includes(origin)){reply(403,{error:'Origin denied'});return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    if(req.url==='/health'&&req.method==='GET'){reply(200,{ok:true});return;}
    if(req.url!=='/sync'||req.method!=='POST'){reply(404,{error:'Not found'});return;}
    const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if(!token){reply(401,{error:'Invalid pairing key'});return;}
    const vault=createHash('sha256').update(token).digest('hex');
    let size=0;const chunks=[];
    try{
      for await(const chunk of req){size+=chunk.length;if(size>32*1024*1024){reply(413,{error:'Historique trop volumineux'});req.resume();return;}chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!Array.isArray(body.entries)||body.entries.length>10000)throw Error('Invalid entries');
      for(const e of body.entries){
        if(typeof e.id!=='string'||!/^(?:charge|reading):.{1,200}$/.test(e.id)||!Number.isSafeInteger(e.clock)||e.clock<0||typeof e.device!=='string'||!/^[a-f0-9]{32}$/.test(e.device)||typeof e.payload!=='string'||e.payload.length>1500000)throw Error('Invalid entry');
      }
      db.exec('BEGIN IMMEDIATE');
      try{
        if(!db.prepare('SELECT 1 FROM records WHERE vault=? LIMIT 1').get(vault)&&db.prepare('SELECT COUNT(DISTINCT vault) AS n FROM records').get().n>=maxVaults){throw Error('Storage full');}
        for(const e of body.entries){const old=get.get(vault,e.id);if(!old||(!body.bootstrap&&(e.clock>old.clock||(e.clock===old.clock&&e.device>old.device))))put.run(vault,e.id,e.clock,e.device,e.payload);}
        const rows=list.all(vault);
        if(rows.reduce((sum,e)=>sum+e.payload.length,0)>32*1024*1024)throw Error('Storage full');
        db.exec('COMMIT');reply(200,{entries:rows});
      }catch(err){db.exec('ROLLBACK');if(err.message==='Storage full'){reply(507,{error:'Stockage partagé plein'});return;}throw err;}
    }catch(err){reply(400,{error:'Requête de synchronisation invalide'});}
  });
  server.on('close',()=>db.close());return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const server=createSyncServer();server.listen(Number(process.env.PORT||3000),'0.0.0.0');process.on('SIGTERM',()=>server.close());}
