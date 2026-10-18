import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chat,connection} from '../maas.js';
import {cases,grade} from '../scripts/evaluation-cases.js';

test('evaluation counts are deterministic; grading separates wrong answers and invalid output',()=>{
  assert.equal(cases.find(c=>c.id==='count-strawberry').expected,'6');
  assert.equal(cases.find(c=>c.id==='count-exception').expected,'6');
  assert.deepEqual(grade('{"answer":6}','6'),{status:'answered',correct:true});
  assert.deepEqual(grade('{"answer":5}','6'),{status:'answered',correct:false});
  assert.deepEqual(grade('I considered 6 but choose 5','6'),{status:'format_error',correct:false});
  assert.equal(grade('```json\n{"answer":"RED"}\n```','RED').correct,true);
});

test('MaaS model-specific configuration, usage, failures and secret-safe errors',async t=>{
  const names=['MAAS_BASE_URL','MAAS_API_KEY','MAAS_BASE_URL_FAST','MAAS_API_KEY_FAST','MAAS_MAX_TOKENS'];
  const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  let mode='ok',captured;
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    captured={url:req.url,auth:req.headers.authorization,body:JSON.parse(raw)};
    if(mode==='error'){res.writeHead(401);return res.end('private credentials should not appear');}
    if(mode==='redirect'){res.writeHead(302,{Location:'/other'});return res.end();}
    res.setHeader('Content-Type','application/json');
    res.end(mode==='invalid'?'not JSON':JSON.stringify({choices:[{message:{content:mode==='empty'?'':mode==='thinking'?'<think>internal</think>{"answer":6}':mode==='unfinished'?'<think>unfinished':'{"answer":6}'},finish_reason:mode==='truncated'?'length':'stop'}],...(mode==='missing'?{}:{usage:{prompt_tokens:10,completion_tokens:4,completion_tokens_details:{reasoning_tokens:mode==='large-reasoning'?200:3}}})}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}});
  process.env.MAAS_BASE_URL='http://127.0.0.1:1/wrong';process.env.MAAS_API_KEY='common-key';
  process.env.MAAS_BASE_URL_FAST=`http://127.0.0.1:${server.address().port}/fast/v1`;
  process.env.MAAS_API_KEY_FAST='specific-key';process.env.MAAS_MAX_TOKENS='700';
  const model={alias:'fast',endpoint_model_name:'real-model',chat_template_kwargs:{enable_thinking:false}};
  const result=await chat(model,[{role:'user',content:'count'}]);
  assert.equal(result.reasoning,3);assert.equal(result.input,10);assert.equal(result.output,4);
  assert.equal(captured.url,'/fast/v1/chat/completions');assert.equal(captured.auth,'Bearer specific-key');assert.equal(captured.body.max_tokens,700);assert.equal(captured.body.chat_template_kwargs.enable_thinking,false);
  const separate={...model,reasoning_token_accounting:'separate'};
  assert.equal((await chat(separate,[])).output,7);
  mode='large-reasoning';const large=await chat(separate,[]);assert.equal(large.output,204);assert.equal(large.reasoning,200);
  mode='thinking';assert.equal((await chat(model,[])).text,'{"answer":6}');
  mode='missing';const missing=await chat(model,[]);assert.equal(missing.input,null);assert.equal(missing.reasoning,null);assert.equal((await chat(separate,[])).output,null);
  for(const value of ['error','redirect','invalid','empty','truncated','unfinished']) {
    mode=value;await assert.rejects(chat(model,[]),error=>error.status===502&&!error.message.includes('private')&&!error.message.includes('specific-key'));
  }
  delete process.env.MAAS_API_KEY;delete process.env.MAAS_API_KEY_FAST;
  assert.throws(()=>connection(model),/not configured/);
});

test('evaluation CLI writes a complete report without touching game data',async t=>{
  const {mkdtempSync,readdirSync,readFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join,resolve}=await import('node:path');
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const folder=mkdtempSync(join(tmpdir(),'escape-eval-'));
  const provider=http.createServer(async(req,res)=>{for await(const part of req){};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"answer":6}'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:5}}));});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>provider.close(resolve));rmSync(folder,{recursive:true,force:true});});
  const endpoint=`http://127.0.0.1:${provider.address().port}/v1`;
  await promisify(execFile)(process.execPath,[resolve('scripts/evaluate.js'),'--case','count-strawberry','--models','fast','--repeats','2'],{cwd:folder,env:{...process.env,MODELS_CONFIG:resolve('models.yaml'),MAAS_BASE_URL:endpoint,MAAS_BASE_URL_FAST:endpoint,MAAS_API_KEY:'fixture',MAAS_API_KEY_FAST:'fixture'}});
  const files=readdirSync(join(folder,'data/evaluations'));
  const report=JSON.parse(readFileSync(join(folder,'data/evaluations',files[0])));
  assert.equal(report.results.length,2);assert.equal(report.results.every(r=>r.correct),true);
  assert.equal(report.results[0].input_tokens,20);
  assert.deepEqual(readdirSync(join(folder,'data')),['evaluations']);
});
