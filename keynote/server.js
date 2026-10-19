import http from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {loadConfig,chat} from '../maas.js';
import {estimateCost,validatePricing} from '../pricing.js';
import {challenges,publicChallenge,correct,simulate,demoUsage} from './challenges.js';
const root=fileURLToPath(new URL('./public/',import.meta.url));
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createKeynote(options={}) {
 const demo=options.demo ?? true, config=options.config ?? loadConfig(), infer=options.infer ?? chat;
 const database=options.database ?? `data/keynote-v2-${demo?'demo':'live'}.sqlite`;
 if(database!==':memory:') mkdirSync(dirname(resolve(database)),{recursive:true});
 const db=new DatabaseSync(database);
 db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,nickname TEXT,started INTEGER);
 CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,player TEXT,challenge INTEGER,model TEXT,mode TEXT,correct INTEGER,response TEXT,prompt TEXT,context TEXT,input INTEGER,output INTEGER,cost REAL,latency INTEGER,created INTEGER,status TEXT);`);
 for(const [alias,m] of Object.entries(config.models)){m.alias=alias;validatePricing(m.pricing);}
 const busy=new Set();
 const attempts=id=>db.prepare('SELECT id,challenge,model,mode,correct,response,input,output,cost,latency,status FROM attempts WHERE player=? ORDER BY id').all(id);
 const state=id=>{const player=db.prepare('SELECT nickname,started FROM players WHERE id=?').get(id);if(!player)throw fail(401,'Join the board first.');return {...player,ends:player.started+240000,attempts:attempts(id)};};
 const snapshot=()=>{
  const players=db.prepare('SELECT id,nickname,started FROM players ORDER BY started').all().map(p=>{
   const rows=attempts(p.id),ai=rows.filter(r=>r.model!=='manual');
   return {...p,id:createHash('sha256').update(p.id).digest('hex').slice(0,16),solved:new Set(rows.filter(r=>r.correct).map(r=>r.challenge)).size,attempts:rows.length,cost:ai.some(r=>r.cost!==null)?ai.reduce((s,r)=>s+(r.cost??0),0):ai.length?null:0,unpriced:ai.filter(r=>r.cost===null).length};
  });
  const comparable=new Map(players.map(p=>[p.solved,players.filter(q=>q.solved===p.solved).every(q=>q.unpriced===0)]));
  players.sort((a,b)=>b.solved-a.solved || (comparable.get(a.solved)?(a.cost??0)-(b.cost??0):0) || a.started-b.started);
  const rows=db.prepare('SELECT a.id,p.nickname,a.challenge,a.model,a.mode,a.correct,a.response,a.prompt,a.context,a.input,a.output,a.cost,a.latency,a.status FROM attempts a JOIN players p ON p.id=a.player ORDER BY a.id DESC').all();
  return {players,requests:rows.filter(r=>r.model!=='manual').length,correct:rows.filter(r=>r.correct).length,solved:players.reduce((s,p)=>s+p.solved,0),tokens:rows.some(r=>r.input!==null&&r.output!==null)?rows.reduce((s,r)=>s+(r.input??0)+(r.output??0),0):null,cost:rows.some(r=>r.model!=='manual'&&r.cost!==null)?rows.filter(r=>r.model!=='manual').reduce((s,r)=>s+(r.cost??0),0):rows.some(r=>r.model!=='manual')?null:0,unknown:rows.filter(r=>r.model!=='manual'&&(r.input===null||r.output===null)).length,unpriced:rows.filter(r=>r.model!=='manual'&&r.cost===null).length,models:Object.keys(config.models).map(alias=>({alias,count:rows.filter(r=>r.model===alias).length})),traces:rows.slice(0,30)};
 };
 const server=http.createServer(async(req,res)=>{
  const send=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
  try {
   const url=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&!url.pathname.startsWith('/api/')) {
    const routes={'/':'index.html','/stage':'index.html','/app.js':'app.js','/style.css':'style.css'};
    const file=routes[url.pathname];if(!file)throw fail(404,'Not found.');
    res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});return res.end(readFileSync(resolve(root,file)));
   }
   const id=req.headers.cookie?.match(/(?:^|;\s*)keynote_session=([a-f0-9]{48})(?:;|$)/)?.[1];
   if(req.method==='GET'&&url.pathname==='/api/config')return send(200,{demo,duration:240,challenges:challenges.map(publicChallenge),models:Object.entries(config.models).map(([alias,m])=>({alias,name:m.display_name,pricing:m.pricing})),benchmarkStatus:'pending'});
   if(req.method==='GET'&&url.pathname==='/api/me')return send(200,state(id??''));
   if(req.method==='GET'&&url.pathname==='/api/dashboard')return send(200,snapshot());
   if(req.method!=='POST')throw fail(404,'Not found.');
   if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`)throw fail(403,'Request origin rejected.');
   if(!req.headers['content-type']?.startsWith('application/json'))throw fail(415,'Send JSON.');
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)throw fail(413,'Request too large.');}
   let body;try{body=JSON.parse(raw);}catch{throw fail(400,'Invalid JSON.');}
   if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Invalid request.');
   if(url.pathname==='/api/join') {
    if(id&&db.prepare('SELECT id FROM players WHERE id=?').get(id))return send(200,state(id));
    const nickname=String(body.nickname??'').trim();if(nickname.length<1||nickname.length>24)throw fail(400,'Use a name between 1 and 24 characters.');
    const token=randomBytes(24).toString('hex');db.prepare('INSERT INTO players VALUES(?,?,?)').run(token,nickname,Date.now());
    return send(201,state(token),{'Set-Cookie':`keynote_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='true'?'; Secure':''}`});
   }
   if(url.pathname!=='/api/attempt')throw fail(404,'Not found.');
   const me=state(id??'');if(Date.now()>=me.ends)throw fail(409,'Your four-minute round has finished.');
   const c=challenges.find(c=>c.id===body.challenge);if(!c)throw fail(400,'Unknown challenge.');
   if(me.attempts.some(a=>a.challenge===c.id&&a.correct))throw fail(409,'You already solved this challenge.');
   if(busy.has(id))throw fail(409,'Wait for your current attempt.');
   if(body.model==='manual')throw fail(400,'Choose an AI model for this challenge.');
   const alias=c.type==='model'?body.model:'fast';
   const model=config.models[alias];if(!model)throw fail(400,'Choose a model.');
   const prompt=typeof body.prompt==='string'?body.prompt.trim():'';
   if(c.type==='prompt'&&(!prompt||prompt.length>1000))throw fail(400,'Write an instruction of 1–1000 characters.');
   const context=c.type==='context'?(body.context??[]):[];
   if(!Array.isArray(context)||context.length>10||new Set(context).size!==context.length||context.some(id=>!c.documents.some(d=>d.id===id)))throw fail(400,'Invalid context selection.');
   const content=c.type==='prompt'?`INSTRUCTION:\n${prompt}\n\nSOURCE NOTE:\n${c.source}`:`${c.task}${c.type==='context'?'\n\nSELECTED DOCUMENTS:\n'+c.documents.filter(d=>context.includes(d.id)).map(d=>d.text).join('\n\n'):''}`;
   const messages=[{role:'system',content:'Complete the user task. Follow the requested output format. If information is missing, say so. Do not invent source facts.'},{role:'user',content}];
   busy.add(id);const started=Date.now();
   try {
    let answer,status='success',error=null;
    try{if(demo){const text=simulate(c,prompt,context);answer={text,...demoUsage(model,messages,text)};await new Promise(r=>setTimeout(r,350+Math.floor(Math.random()*350)));}else{answer=await infer(model,messages);}}catch(e){status='error';error='Model request failed. Retry or choose another challenge.';answer={text:error,input:e.usage?.input??null,output:e.usage?.output??null};}
    const cost=estimateCost(model.pricing,answer.input,answer.output,false).estimated_cost_usd;
    const won=status==='success'&&correct(c,answer.text);
    db.prepare('INSERT INTO attempts(player,challenge,model,mode,correct,response,prompt,context,input,output,cost,latency,created,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,c.id,alias,demo?'demo':'live',+won,answer.text,c.type==='prompt'?prompt:content,JSON.stringify(context),answer.input,answer.output,cost,Date.now()-started,started,status);
    return send(200,{correct:won,response:answer.text,error,model:alias,demo,input:answer.input,output:answer.output,cost,latency:Date.now()-started,...(won?{lesson:c.lesson,comparison:c.comparison}:{}),...state(id)});
   }finally{busy.delete(id);}
  }catch(e){send(e.status??500,{error:e.status?e.message:'Unable to process this request.'});}
 });
 return {server,db};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const demo=!process.argv.includes('--live');const {server}=createKeynote({demo});
 const port=Number(process.env.KEYNOTE_PORT??3001);
 server.listen(port,process.env.HOST??'127.0.0.1',()=>console.log(`AI Challenge Board (${demo?'SIMULATED DEMO':'LIVE MaaS'}) http://localhost:${port}\nStage: http://localhost:${port}/stage`));
}
