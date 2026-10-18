import { readFileSync } from 'node:fs';
import { readEvents } from './public/stream.js';
import { parse } from 'yaml';

export function loadConfig() {
  const config = parse(readFileSync(process.env.MODELS_CONFIG || 'models.yaml', 'utf8'));
  for (const [alias, model] of Object.entries(config.models)) {
    model.alias = alias;
    model.endpoint_model_name = process.env[`MAAS_MODEL_${alias.toUpperCase()}`] || model.endpoint_model_name;
  }
  return config;
}

export function connection(model) {
  const suffix = model.alias?.toUpperCase();
  const base = (suffix && process.env[`MAAS_BASE_URL_${suffix}`]) || process.env.MAAS_BASE_URL;
  const key = (suffix && process.env[`MAAS_API_KEY_${suffix}`]) || process.env.MAAS_API_KEY;
  if (!base || !key) throw Object.assign(new Error('MaaS is not configured. Set the base URL and API key in .env.'), {status:503});
  let url;
  try { url = new URL(base); } catch { throw new Error('Invalid MaaS base URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('MaaS base URL must be an HTTP(S) API root without credentials or query parameters.');
  return {base:base.replace(/\/+$/, ''), key};
}

export async function chat(model, messages, onEvent) {
  if (model.reasoning_token_accounting !== undefined && !['included','separate'].includes(model.reasoning_token_accounting)) throw new Error('Invalid reasoning token accounting mode.');
  const {base,key} = connection(model);
  const timeout = Number(onEvent ? (process.env.MAAS_STREAM_TIMEOUT_MS || 120000) : (process.env.MAAS_TIMEOUT_MS || 30000));
  const timeoutError = () => Object.assign(new Error(`The model exceeded the ${Math.ceil(timeout/1000)}-second response limit. No coins were charged.`),{status:504});
  const maxTokens = Number(process.env.MAAS_MAX_TOKENS || 512);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error('Invalid MaaS timeout or token limit.');
  const signal = AbortSignal.timeout(timeout);
  let response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method:'POST', redirect:'error', signal,
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(onEvent ? {Accept:'text/event-stream','Accept-Encoding':'identity'} : {})},
      body:JSON.stringify({model:model.endpoint_model_name,max_tokens:maxTokens,messages,...(onEvent ? {stream:true,stream_options:{include_usage:true}} : {}),...(model.chat_template_kwargs ? {chat_template_kwargs:model.chat_template_kwargs} : {})}),
    });
  } catch { if(signal.aborted)throw timeoutError();throw Object.assign(new Error('Could not connect to MaaS. No coins were charged.'),{status:502}); }
  if (!response.ok) throw Object.assign(new Error(`MaaS returned HTTP ${response.status}. No coins were charged.`),{status:502});
  let body;
  if (onEvent && response.headers.get('content-type')?.includes('text/event-stream')) {
    onEvent({type:'status',phase:'connected'});
    let content='',reasoningSize=0,finish=null,usage=null,received=false;
    try {
      for await (const event of readEvents(response.body)) {
        if(event.data==='[DONE]'){break;}
        const chunk=JSON.parse(event.data);
        if(!received){received=true;onEvent({type:'status',phase:'responding'});}
        if(chunk.error)throw new Error('Provider stream error');
        if(chunk.usage)usage=chunk.usage;
        for(const choice of chunk.choices||[]) {
          if(choice.index != null && choice.index!==0)continue;
          const delta=choice.delta||choice.message||{};
          const reasoning=delta.reasoning_content || delta.reasoning;
          if(typeof reasoning==='string' && reasoning){
            const piece=reasoning.slice(0,Math.max(0,64000-reasoningSize));reasoningSize+=piece.length;
            if(piece)onEvent({type:'reasoning',text:piece});
          }
          if(typeof delta.content==='string' && delta.content){content+=delta.content;if(content.length>256000)throw new Error('Oversized answer');onEvent({type:'answering',text:delta.content});}
          if(choice.finish_reason)finish=choice.finish_reason;
        }
        // Some gateways keep the SSE connection open after a finished response.
        if(finish && usage)break;
      }
      if(!finish)throw new Error('Incomplete stream');
    } catch {if(signal.aborted)throw timeoutError();throw Object.assign(new Error('The model connection ended before its final answer was complete. No coins were charged.'),{status:502});}
    body={choices:[{message:{content},finish_reason:finish}],usage};
  } else {
    onEvent?.({type:'status',phase:'nonstreaming'});
    try { body=await response.json(); } catch { throw Object.assign(new Error('MaaS returned invalid JSON. No coins were charged.'),{status:502}); }
  }
  if(onEvent && !response.headers.get('content-type')?.includes('text/event-stream')){const reasoning=body.choices?.[0]?.message?.reasoning_content || body.choices?.[0]?.message?.reasoning;if(typeof reasoning==='string'&&reasoning)onEvent({type:'reasoning',text:reasoning.slice(0,64000)});}
  const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
  const completion=count(body.usage?.completion_tokens);
  const reportedReasoning=count(body.usage?.completion_tokens_details?.reasoning_tokens);
  // These deployments report reasoning separately; other providers may include it.
  const separate=model.reasoning_token_accounting==='separate';
  const output=completion === null ? null : count(completion + (separate ? (reportedReasoning ?? 0) : 0));
  const usage={input:count(body.usage?.prompt_tokens),output,reasoning:separate ? reportedReasoning : (reportedReasoning !== null && output !== null && reportedReasoning <= output ? reportedReasoning : null)};
  const incomplete=message=>Object.assign(new Error(message),{status:502,usage});
  if (body.choices?.[0]?.finish_reason === 'length') throw incomplete('The model reached its response limit. No coins were charged.');
  const raw=body.choices?.[0]?.message?.content;
  const text=typeof raw === 'string' ? raw.replace(/<think>[\s\S]*?<\/think>/gi,'').trim() : raw;
  if (typeof text === 'string' && /<think>/i.test(text)) throw incomplete('The model did not finish its answer. No coins were charged.');
  if (typeof text !== 'string' || !text.trim()) throw incomplete('The model returned no answer. No coins were charged.');
  return {text,...usage,finish_reason:body.choices?.[0]?.finish_reason ?? null};
}
