import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

async function fixture(t, options={}) {
  const {server,db}=createApp({database:':memory:',demo:true,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  const call=async(path,body,cookie='',key=randomUUID())=>{
    const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const join=async nickname=>(await call('/api/session',{nickname})).cookie;
  return {call,join,db,url};
}
test('independent players, private sessions, usage aggregation and no hidden answer',async t=>{
  const {call,join}=await fixture(t);
  assert.equal((await call('/api/session')).status,401);
  const a=await join('Alpha'),b=await join('Beta');
  assert.notEqual(a,b);
  assert.equal((await call('/api/session',undefined,a)).data.budget,40);
  const request=await call('/api/rooms/1/assist',{model_alias:'fast'},a);
  assert.equal(request.data.budget,38);
  assert.equal((await call('/api/session',undefined,b)).data.budget,40);
  assert.equal((await call('/api/rooms/1/assist',{model_alias:'premium'},b)).data.budget,31);
  const summary=(await call('/api/dashboard')).data;
  assert.equal(summary.players,2);assert.equal(summary.models.length,2);
  assert.equal(summary.models[0].input_tokens,null);
  const config=(await call('/api/config')).data;
  assert.equal(JSON.stringify(config).includes('345'),false);
  assert.equal(JSON.stringify(config).includes('endpoint_model_name'),false);
});
test('duplicate AI requests and answer submissions cannot double charge or reward',async t=>{
  const {call,join}=await fixture(t);const cookie=await join('Player');const key=randomUUID();
  const first=await call('/api/rooms/1/assist',{model_alias:'balanced'},cookie,key);
  assert.deepEqual((await call('/api/rooms/1/assist',{model_alias:'balanced'},cookie,key)).data,first.data);
  assert.equal((await call('/api/rooms/1/assist',{model_alias:'fast'},cookie,key)).status,409);
  const wrongKey=randomUUID();
  await call('/api/rooms/1/answer',{answer:'111'},cookie,wrongKey);
  await call('/api/rooms/1/answer',{answer:'111'},cookie,wrongKey);
  const answerKey=randomUUID();
  const answer=await call('/api/rooms/1/answer',{answer:'345'},cookie,answerKey);
  assert.equal(answer.data.score,800);assert.equal(answer.data.wrong,1);
  assert.deepEqual((await call('/api/rooms/1/answer',{answer:'345'},cookie,answerKey)).data,answer.data);
  assert.equal((await call('/api/rooms/1/answer',{answer:'345'},cookie)).status,409);
  assert.equal((await call('/api/dashboard')).data.escaped,1);
});
test('a failed provider call charges nothing and records failure',async t=>{
  const {call,join}=await fixture(t,{demo:false,infer:async()=>{throw new Error('private provider details');}});
  const cookie=await join('Player');const r=await call('/api/rooms/1/assist',{model_alias:'fast'},cookie);
  assert.equal(r.status,502);assert.equal(r.data.error.includes('private'),false);
  assert.equal((await call('/api/session',undefined,cookie)).data.budget,40);
  assert.equal((await call('/api/dashboard')).data.models[0].successful,0);
});
test('only one request per player can run; answer cannot race with inference',async t=>{
  let release,entered;const started=new Promise(resolve=>entered=resolve);
  const {call,join}=await fixture(t,{infer:async()=>{entered();return await new Promise(resolve=>release=resolve);}});
  const cookie=await join('Player');const pending=call('/api/rooms/1/assist',{model_alias:'fast'},cookie);
  await started;
  assert.equal((await call('/api/rooms/1/assist',{model_alias:'fast'},cookie)).status,409);
  assert.equal((await call('/api/rooms/1/answer',{answer:'345'},cookie)).status,409);
  release({text:'Try the clues.',input:12,output:4});
  assert.equal((await pending).data.budget,38);
});
test('insufficient budget, malformed answers, cooldown and origin checks',async t=>{
  const {call,join,db,url}=await fixture(t);const cookie=await join('Player');
  db.prepare('UPDATE sessions SET budget=1').run();
  assert.equal((await call('/api/rooms/1/assist',{model_alias:'fast'},cookie)).status,402);
  assert.equal((await call('/api/rooms/1/assist',{model_alias:'bogus'},cookie)).status,400);
  assert.equal((await call('/api/rooms/1/answer',{answer:'345x'},cookie)).status,400);
  const forbidden=await fetch(url+'/api/rooms/1/answer',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json',Cookie:cookie},body:'{}'});
  assert.equal(forbidden.status,403);
  db.prepare('UPDATE sessions SET budget=40').run();
  await call('/api/rooms/1/assist',{model_alias:'fast'},cookie);
  assert.equal((await call('/api/rooms/1/assist',{model_alias:'fast'},cookie)).status,429);
});
test('MaaS adapter sends configured model and captures real usage',async t=>{
  let captured;
  const provider=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;captured={path:req.url,authorization:req.headers.authorization,body:JSON.parse(text)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Try 345.'}}],usage:{prompt_tokens:43,completion_tokens:8}}));});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const previous={url:process.env.MAAS_BASE_URL,key:process.env.MAAS_API_KEY};
  process.env.MAAS_BASE_URL=`http://127.0.0.1:${provider.address().port}/v1`;process.env.MAAS_API_KEY='test-only-secret';
  t.after(async()=>{await new Promise(resolve=>provider.close(resolve));for(const [key,value] of [['MAAS_BASE_URL',previous.url],['MAAS_API_KEY',previous.key]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const {call,join,db}=await fixture(t,{demo:false});const cookie=await join('Live');
  const r=await call('/api/rooms/1/assist',{model_alias:'fast'},cookie);
  assert.equal(r.status,200);assert.equal(r.data.usage.input_tokens,43);assert.equal(r.data.usage.output_tokens,8);
  assert.equal(captured.path,'/v1/chat/completions');assert.equal(captured.body.model,'qwen3-14b');assert.equal(captured.authorization,'Bearer test-only-secret');
  assert.equal((await call('/api/dashboard')).data.models[0].mode,'live');
  await call('/api/rooms/1/answer',{answer:'345'},cookie);
  await call('/api/rooms/1/next',{},cookie);
  db.prepare('UPDATE requests SET created=0').run();
  const hint=await call('/api/rooms/2/assist',{assistance_type:'hint'},cookie);
  assert.equal(hint.status,200);assert.equal(hint.data.game_cost,1);
  assert.match(captured.body.messages[0].content,/Do not reveal the answer/);
  assert.match(captured.body.messages[1].content,/damaged transmission/);
  assert.equal(captured.body.messages[1].content.includes('345'),false);
  assert.equal(captured.body.messages[1].content.includes('NORTH'),false);
  db.prepare('UPDATE sessions SET current_room=4').run();
  db.prepare('UPDATE requests SET created=0').run();
  const context=await call('/api/rooms/4/assist',{model_alias:'fast',selected_context_ids:[]},cookie);
  assert.equal(context.status,200);
  assert.match(captured.body.messages[1].content,/5 → \?/);
  assert.equal(captured.body.messages[1].content.includes('2 → 6'),false);
  db.prepare('UPDATE requests SET created=0').run();
  await call('/api/rooms/4/assist',{model_alias:'fast',selected_context_ids:['examples']},cookie);
  assert.match(captured.body.messages[1].content,/2 → 6/);
  assert.equal(captured.body.messages[1].content.includes('WREN'),false);
  assert.equal(captured.body.messages[1].content.includes('Dinner'),false);
});
test('state and idempotency survive an application restart',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'escape-test-'));const database=join(directory,'game.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const first=createApp({database,demo:true});await new Promise(resolve=>first.server.listen(0,'127.0.0.1',resolve));
  const response=await fetch(`http://127.0.0.1:${first.server.address().port}/api/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:'Persistent'})});
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const key=randomUUID();
  const mutation=await fetch(`http://127.0.0.1:${first.server.address().port}/api/rooms/1/assist`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'Idempotency-Key':key},body:JSON.stringify({model_alias:'fast'})});
  const original=await mutation.json();
  await new Promise(resolve=>first.server.close(resolve));first.db.close();
  const second=await fixture(t,{database});
  assert.equal((await second.call('/api/session',undefined,cookie)).data.nickname,'Persistent');
  assert.deepEqual((await second.call('/api/rooms/1/assist',{model_alias:'fast'},cookie,key)).data,original);
  assert.equal((await second.call('/api/session',undefined,cookie)).data.budget,38);
});

test('three-room progression, hint charging, independent room scoring and replay protection', async t => {
  const {call,join,db}=await fixture(t);const cookie=await join('Explorer');
  assert.equal((await call('/api/rooms/2/answer',{answer:'NORTH'},cookie)).status,409);
  assert.equal((await call('/api/rooms/1/next',{},cookie)).status,409);
  assert.equal((await call('/api/rooms/1/assist',{assistance_type:'hint'},cookie)).status,400);
  await call('/api/rooms/1/answer',{answer:'111'},cookie);
  const first=await call('/api/rooms/1/answer',{answer:'345'},cookie);
  assert.equal(first.data.score,900);assert.equal(first.data.game_completed,false);
  const key=randomUUID();const next=await call('/api/rooms/1/next',{},cookie,key);
  assert.equal(next.data.current_room,2);assert.equal(next.data.room_wrong,0);
  assert.deepEqual((await call('/api/rooms/1/next',{},cookie,key)).data,next.data);
  assert.equal((await call('/api/rooms/1/answer',{answer:'345'},cookie)).status,409);
  const hintKey=randomUUID();const hint=await call('/api/rooms/2/assist',{assistance_type:'hint',model_alias:'premium'},cookie,hintKey);
  assert.equal(hint.data.budget,39);assert.equal(hint.data.game_cost,1);
  assert.equal(hint.data.response.includes('NORTH'),false);
  assert.deepEqual((await call('/api/rooms/2/assist',{assistance_type:'hint',model_alias:'premium'},cookie,hintKey)).data,hint.data);
  const record=db.prepare('SELECT * FROM requests').get();assert.equal(record.model,'fast');assert.equal(record.room,2);assert.equal(record.assistance_type,'hint');
  const end=await call('/api/rooms/2/answer',{answer:'north'},cookie);
  assert.equal(end.data.room_score,980);assert.equal(end.data.score,1880);assert.equal(end.data.game_completed,false);
  assert.equal((await call('/api/rooms/2/next',{},cookie)).data.current_room,3);
  assert.equal((await call('/api/rooms/3/assist',{assistance_type:'hint'},cookie)).status,400);
  assert.equal((await call('/api/rooms/3/answer',{answer:'BLUE'},cookie)).data.correct,false);
  assert.equal((await call('/api/rooms/3/answer',{answer:'GREEN'},cookie)).data.correct,false);
  db.prepare('UPDATE requests SET created=0').run();
  const ai=await call('/api/rooms/3/assist',{model_alias:'balanced'},cookie);
  assert.equal(ai.data.budget,34);assert.match(ai.data.response,/Choose RED/);
  const finalKey=randomUUID();
  const final=await call('/api/rooms/3/answer',{answer:'RED'},cookie,finalKey);
  assert.equal(final.data.room_score,700);assert.equal(final.data.score,2580);
  assert.equal(final.data.game_completed,false);
  assert.deepEqual((await call('/api/rooms/3/answer',{answer:'RED'},cookie,finalKey)).data,final.data);
  assert.equal((await call('/api/rooms/3/next',{},cookie)).data.current_room,4);
  const dashboard=(await call('/api/dashboard')).data;
  assert.equal(dashboard.escaped,3);assert.equal(dashboard.assistance[0].assistance_type,'hint');
});

test('legacy completed sessions migrate without losing progress or spending', async t => {
  const {DatabaseSync}=await import('node:sqlite');
  const directory=mkdtempSync(join(tmpdir(),'escape-migration-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const database=join(directory,'game.sqlite');const legacy=new DatabaseSync(database);
  legacy.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY,nickname TEXT,budget INTEGER,spent INTEGER,wrong INTEGER,score INTEGER,completed INTEGER,started INTEGER);
    INSERT INTO sessions VALUES('${'a'.repeat(64)}','Returning',35,5,1,800,1,0);`);
  legacy.close();
  const {call}=await fixture(t,{database});const cookie=`escape_session=${'a'.repeat(64)}`;
  const player=(await call('/api/session',undefined,cookie)).data;
  assert.equal(player.score,800);assert.equal(player.room_score,800);assert.equal(player.rooms_completed,1);
  const next=(await call('/api/rooms/1/next',{},cookie)).data;
  assert.equal(next.current_room,2);assert.equal(next.budget,35);assert.equal(next.score,800);
});


test('door puzzle has exactly one solution under its stated truth rule', async () => {
  const {rooms,publicRoom}=await import('../rooms.js');
  const room=rooms[2];
  const solutions=room.choices.filter(exit=>[exit==='BLUE',exit!=='BLUE',exit!=='RED'].filter(Boolean).length===1);
  assert.deepEqual(solutions,[room.answer]);
  assert.equal('answer' in publicRoom(room),false);
  assert.equal('explanation' in publicRoom(room),false);
});


test('context selection validates records, controls prompt inputs and charges once', async t => {
  let supplied;
  const {call,join,db}=await fixture(t,{infer:async(model,room,type,documents)=>{supplied=documents;return {text:'Choose 30.',input:40,output:4};}});
  const cookie=await join('Context');
  db.prepare('UPDATE sessions SET current_room=4').run();
  for (const ids of [['examples','examples'],['invented'],'bay',[{}]]) {
    assert.equal((await call('/api/rooms/4/assist',{model_alias:'fast',selected_context_ids:ids},cookie)).status,400);
  }
  const key=randomUUID();const payload={model_alias:'fast',selected_context_ids:['examples'],context_cost:0};
  const result=await call('/api/rooms/4/assist',payload,cookie,key);
  assert.equal(result.data.game_cost,3);assert.equal(result.data.budget,37);
  assert.deepEqual(supplied.map(doc=>doc.id),['examples']);
  assert.deepEqual((await call('/api/rooms/4/assist',payload,cookie,key)).data,result.data);
  assert.equal(db.prepare('SELECT context_cost FROM requests').get().context_cost,1);
  db.prepare('UPDATE requests SET created=0').run();
  const all=await call('/api/rooms/4/assist',{model_alias:'fast',selected_context_ids:[]},cookie);
  assert.equal(all.data.game_cost,2);assert.equal(supplied.length,0);
  const end=await call('/api/rooms/4/answer',{answer:'30'},cookie);
  assert.equal(end.data.game_completed,true);assert.equal(end.data.room_score,900);
  assert.equal((await call('/api/rooms/4/next',{},cookie)).status,409);
});

test('demo context responses distinguish missing and sufficient records',async t=>{
  const {call,join,db}=await fixture(t);const cookie=await join('Demo');
  db.prepare('UPDATE sessions SET current_room=4').run();
  const missing=await call('/api/rooms/4/assist',{model_alias:'fast',selected_context_ids:[]},cookie);
  assert.match(missing.data.response,/I only see/);assert.equal(missing.data.game_cost,2);
  db.prepare('UPDATE requests SET created=0').run();
  const enough=await call('/api/rooms/4/assist',{model_alias:'fast',selected_context_ids:['examples']},cookie);
  assert.match(enough.data.response,/5 × 6 = 30/);
  db.prepare('UPDATE sessions SET budget=2').run();
  assert.equal((await call('/api/rooms/4/assist',{model_alias:'fast',selected_context_ids:['examples']},cookie)).status,402);
});

test('cost snapshots survive price changes and dashboard distinguishes unpriced requests',async t=>{
  const {loadConfig}=await import('../maas.js');const config=loadConfig();
  delete config.models.balanced.pricing;
  config.models.fast.pricing={input_usd_per_million:2,output_usd_per_million:3};
  const {call,join,db}=await fixture(t,{config,demo:false,infer:async()=>({text:'345',input:1000,output:400,reasoning:300})});
  const cookie=await join('Pricing');const key=randomUUID();
  const first=await call('/api/rooms/1/assist',{model_alias:'fast'},cookie,key);
  assert.equal(first.data.usage.reasoning_tokens,300);assert.equal(first.data.estimated_cost_usd,0.0032);assert.equal(first.data.budget,38);
  config.models.fast.pricing.input_usd_per_million=20;
  assert.equal((await call('/api/rooms/1/assist',{model_alias:'fast'},cookie,key)).data.estimated_cost_usd,0.0032);
  const record=db.prepare('SELECT * FROM requests').get();
  assert.equal(JSON.parse(record.pricing_snapshot).input_usd_per_million,2);
  db.prepare('UPDATE requests SET created=0').run();
  const unknown=await call('/api/rooms/1/assist',{model_alias:'balanced'},cookie);
  assert.equal(unknown.data.estimated_cost_usd,null);assert.equal(unknown.data.cost_status,'pricing_unavailable');
  const summary=(await call('/api/dashboard')).data.consumption;
  assert.equal(summary.tokens,2800);assert.equal((await call('/api/dashboard')).data.models.find(m=>m.model==='fast').avg_tokens,1400);assert.equal(summary.estimated_cost_usd,0.0032);
  assert.equal(summary.priced_requests,1);assert.equal(summary.unpriced_requests,1);
});

test('truncated reasoning usage is recorded without charging game coins',async t=>{
  const {call,join}=await fixture(t,{demo:false,infer:async()=>{throw Object.assign(new Error('Response limit reached'),{status:502,usage:{input:100,output:512,reasoning:500}});}});
  const cookie=await join('Reasoning');
  assert.equal((await call('/api/rooms/1/assist',{model_alias:'premium'},cookie)).status,502);
  assert.equal((await call('/api/session',undefined,cookie)).data.budget,40);
  const summary=(await call('/api/dashboard')).data;
  assert.equal(summary.consumption.tokens,612);
  assert.equal(summary.models[0].reasoning_tokens,500);
  assert.equal(summary.models[0].output_tokens,512);
  assert.ok(summary.consumption.estimated_cost_usd>0);
});

test('server timing includes inference waits, freezes on completion and cannot be forged',async t=>{
  let release,entered;const started=new Promise(resolve=>entered=resolve);
  const {call,join,db}=await fixture(t,{infer:async()=>{entered();return new Promise(resolve=>release=resolve);}});
  const cookie=await join('Clock');
  db.prepare('UPDATE sessions SET current_room=4,started=?,room_started=?').run(Date.now()-65000,Date.now()-15000);
  const before=(await call('/api/session',undefined,cookie)).data;
  const pending=call('/api/rooms/4/assist',{model_alias:'fast'},cookie);await started;
  assert.equal((await call('/api/session',undefined,cookie)).data.started,before.started);
  release({text:'30',input:10,output:2});await pending;
  const key=randomUUID();const done=await call('/api/rooms/4/answer',{answer:'30',elapsed_ms:0,finished:0},cookie,key);
  assert.ok(done.data.solve_time_ms>=65000);assert.ok(done.data.room_elapsed_ms>=15000);
  assert.ok(done.data.finished>before.started);
  assert.equal((await call('/api/session',undefined,cookie)).data.solve_time_ms,done.data.solve_time_ms);
  assert.deepEqual((await call('/api/rooms/4/answer',{answer:'30',elapsed_ms:0,finished:0},cookie,key)).data,done.data);
  const board=(await call('/api/dashboard/leaderboard')).data;
  assert.equal(board[0].solve_time_ms,done.data.solve_time_ms);assert.equal(board[0].finished,true);
  assert.equal('id' in board[0],false);
});

test('leaderboard prioritizes progress, then score, then solve speed; untimed legacy saves stay unknown',async t=>{
  const {call,join,db}=await fixture(t);
  for(const [name,score,time,roomsDone] of [['Slower',900,40000,1],['Faster',900,20000,1],['HigherScore',1000,50000,1],['MoreRooms',800,60000,2],['Legacy',900,null,1]]) {
    const cookie=await join(name);const id=cookie.split('=')[1];
    db.prepare('UPDATE sessions SET score=? WHERE id=?').run(score,id);
    for(let room=1;room<=roomsDone;room++)db.prepare('INSERT INTO completions(session,room,score,elapsed_ms) VALUES(?,?,?,?)').run(id,room,score,time);
  }
  const rows=(await call('/api/dashboard')).data.leaderboard;
  assert.deepEqual(rows.map(row=>row.nickname),['MoreRooms','HigherScore','Faster','Slower','Legacy']);
  assert.equal(rows.at(-1).solve_time_ms,null);
});

for (const [alias,room,assistanceType,cost] of [['fast',1,'model',2],['balanced',1,'model',5],['premium',1,'model',9],['fast',2,'hint',1]]) {
test(`${alias} ${assistanceType} stream sends progress before completion and replays without charging twice`,async t=>{
  let release,entered;const began=new Promise(resolve=>entered=resolve);
  const {call,join,db,url}=await fixture(t,{demo:false,infer:async(model,room,type,docs,onEvent)=>{onEvent({type:'reasoning',text:'Check the clues.'});entered();return new Promise(resolve=>release=resolve);}});
  const cookie=await join('Streaming'),key=randomUUID();const payload={model_alias:alias,assistance_type:assistanceType,stream:true};
  db.prepare('UPDATE sessions SET current_room=?').run(room);
  const response=await fetch(url+`/api/rooms/${room}/assist`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'Idempotency-Key':key},body:JSON.stringify(payload)});
  assert.match(response.headers.get('content-type'),/text\/event-stream/);
  await began;
  const reader=response.body.getReader();let text=new TextDecoder().decode((await reader.read()).value);
  assert.match(text,/reasoning/);
  assert.equal((await call('/api/session',undefined,cookie)).data.budget,40);
  assert.equal((await call(`/api/rooms/${room}/assist`,payload,cookie,key)).status,409);
  release({text:'345',input:20,output:10});
  while(true){const {value,done}=await reader.read();if(done)break;text+=new TextDecoder().decode(value);}
  assert.match(text,/"type":"result"/);
  const replay=await call(`/api/rooms/${room}/assist`,payload,cookie,key);
  assert.equal(replay.data.budget,40-cost);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM requests').get().n,1);
  assert.equal(JSON.stringify(replay.data).includes('Check the clues'),false);
});

}

test('streamed inference error is delivered as an event and does not charge coins',async t=>{
  const {join,call,url}=await fixture(t,{demo:false,infer:async(m,r,a,d,event)=>{event({type:'reasoning',text:'Starting'});throw new Error('provider failure');}});
  const cookie=await join('StreamError');
  const response=await fetch(url+'/api/rooms/1/assist',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'Idempotency-Key':randomUUID()},body:JSON.stringify({model_alias:'premium',stream:true})});
  assert.match(await response.text(),/"type":"error"/);
  assert.equal((await call('/api/session',undefined,cookie)).data.budget,40);
});
