import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readEvents} from '../public/stream.js';
import {chat} from '../maas.js';

test('SSE parser preserves split UTF-8, CRLF and multiline data',async()=>{
  const bytes=new TextEncoder().encode(': hello\r\nevent: delta\r\ndata: café\r\ndata: line 2\r\n\r\ndata: [DONE]\n\n');
  const stream=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}});
  const events=[];for await(const item of readEvents(stream))events.push(item);
  assert.deepEqual(events,[{event:'delta',data:'café\nline 2'},{event:'message',data:'[DONE]'}]);
});

test('MaaS streaming separates reasoning, reads late usage and rejects interrupted streams',async t=>{
  let mode='ok',payload,headers;
  const server=http.createServer(async(req,res)=>{
    headers=req.headers;let raw='';for await(const part of req)raw+=part;payload=JSON.parse(raw);
    if(mode==='fallback'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({choices:[{message:{content:'345'},finish_reason:'stop'}]}));}
    res.setHeader('Content-Type','text/event-stream');
    const chunk=value=>res.write(`data: ${JSON.stringify(value)}\r\n\r\n`);
    chunk({choices:[{index:0,delta:{reasoning_content:'Check café. '}}]});
    chunk({choices:[{index:0,delta:{reasoning:'Test the sum.'}}]});
    if(mode==='interrupted')return res.end();
    if(mode==='error'){chunk({error:{message:'private provider details'}});return res.end();}
    chunk({choices:[{index:0,delta:{content:'345'},finish_reason:mode==='length'?'length':'stop'}]});
    if(mode==='eof')return res.end();
    chunk({choices:[],usage:{prompt_tokens:40,completion_tokens:20,completion_tokens_details:{reasoning_tokens:17}}});
    if(mode==='lingering'){setTimeout(()=>res.end(),250).unref();return;}
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const before={url:process.env.MAAS_BASE_URL_PREMIUM,key:process.env.MAAS_API_KEY_PREMIUM};
  process.env.MAAS_BASE_URL_PREMIUM=`http://127.0.0.1:${server.address().port}/v1`;process.env.MAAS_API_KEY_PREMIUM='fixture';
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));for(const [k,v]of [['MAAS_BASE_URL_PREMIUM',before.url],['MAAS_API_KEY_PREMIUM',before.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const model={alias:'premium',endpoint_model_name:'fixture'};const events=[];
  const result=await chat(model,[],event=>events.push(event));
  assert.equal(headers.accept,'text/event-stream');assert.equal(headers['accept-encoding'],'identity');
  assert.equal(payload.stream,true);assert.equal(payload.stream_options.include_usage,true);
  const reasoningEvents=events.filter(e=>e.type==='reasoning');assert.equal(reasoningEvents[0].text,'Check café. ');assert.equal(reasoningEvents[1].text,'Test the sum.');
  assert.equal(events[0].phase,'connected');
  assert.equal(events.filter(e=>e.type==='answering').map(e=>e.text).join(''),'345');
  assert.equal(result.text,'345');assert.equal(result.input,40);assert.equal(result.output,20);
  assert.equal(result.reasoning,17);assert.equal('reasoning_text' in result,false);
  const separate=await chat({...model,reasoning_token_accounting:'separate'},[],()=>{});
  assert.equal(separate.output,37);assert.equal(separate.reasoning,17);
  for(const next of ['interrupted','error','length']){mode=next;await assert.rejects(chat(model,[],()=>{}),error=>error.status===502&&!error.message.includes('private'));}
  mode='eof';const eof=await chat(model,[],()=>{});assert.equal(eof.text,'345');assert.equal(eof.input,null);
  mode='lingering';assert.equal((await chat(model,[],()=>{})).text,'345');
  mode='fallback';assert.equal((await chat(model,[],()=>{})).text,'345');
});


test('stream requests have their own timeout and distinguish timeout from interruption',async t=>{
  const names=['MAAS_BASE_URL_PREMIUM','MAAS_API_KEY_PREMIUM','MAAS_TIMEOUT_MS','MAAS_STREAM_TIMEOUT_MS'];
  const prior=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  let delay=150;
  const server=http.createServer(async(req,res)=>{for await(const part of req){};res.setHeader('Content-Type','text/event-stream');res.write('data: {"choices":[{"delta":{"reasoning_content":"Checking"}}]}\n\n');const timer=setTimeout(()=>res.end('data: {"choices":[{"delta":{"content":"345"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'),delay);res.on('close',()=>clearTimeout(timer));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const name of names){if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];}});
  process.env.MAAS_BASE_URL_PREMIUM=`http://127.0.0.1:${server.address().port}/v1`;process.env.MAAS_API_KEY_PREMIUM='fixture';process.env.MAAS_TIMEOUT_MS='50';process.env.MAAS_STREAM_TIMEOUT_MS='1000';
  const model={alias:'premium',endpoint_model_name:'fixture'};
  assert.equal((await chat(model,[],()=>{})).text,'345');
  delay=1500;process.env.MAAS_STREAM_TIMEOUT_MS='50';
  await assert.rejects(chat(model,[],()=>{}),error=>error.status===504&&error.message.includes('response limit'));
});
