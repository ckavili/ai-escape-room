import { chromium } from '@playwright/test';
import { createApp } from '../server.js';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(...args)=>{const start=Date.now();const r=await originalFetch(...args);console.log(JSON.stringify({upstreamHeadersMs:Date.now()-start,type:r.headers.get('content-type'),encoding:r.headers.get('content-encoding')}));return r;};
const {server,db}=createApp({database:':memory:',demo:false});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();
 await page.addInitScript(()=>{
  const original=window.fetch;
  window.streamTiming=[];
  window.fetch=async(...args)=>{
   const start=performance.now(),response=await original(...args);
   if(response.headers.get('content-type')?.includes('text/event-stream')){
    const reader=response.clone().body.getReader();
    (async()=>{let buffer='';const decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const frames=buffer.split('\n\n');buffer=frames.pop();for(const frame of frames){if(!frame.startsWith('data:'))continue;const e=JSON.parse(frame.slice(5));window.streamTiming.push({ms:Math.round(performance.now()-start),type:e.type,phase:e.phase});}}})();
   }
   return response;
  };
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByLabel('What should we call you?').fill('StreamCheck');
 await page.getByRole('button',{name:'Enter the escape room'}).click();
 await page.locator('[data-model="premium"]').click();
 await page.waitForFunction(()=>window.streamTiming.some(e=>['result','error'].includes(e.type)),{},{timeout:130000});
 const events=await page.evaluate(()=>window.streamTiming);
 const groups={};for(const e of events){const k=e.phase||e.type;groups[k]??={first:e.ms,last:e.ms,count:0};groups[k].last=e.ms;groups[k].count++;}
 console.log(JSON.stringify(groups));
} finally {await browser?.close();await new Promise(r=>server.close(r));db.close();}
