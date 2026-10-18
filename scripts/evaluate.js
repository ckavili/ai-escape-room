import {mkdirSync,writeFileSync} from 'node:fs';
import {loadConfig,chat,connection} from '../maas.js';
import {cases,grade} from './evaluation-cases.js';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
if(args.includes('--list')) {
  console.table(cases.map(c=>({id:c.id,prompt:c.prompt})));
} else {
  try {
    const repeats=Number(option('--repeats','3'));
    if(!Number.isSafeInteger(repeats)||repeats<1||repeats>20)throw new Error('--repeats must be between 1 and 20.');
    const config=loadConfig();
    const aliases=option('--models','fast,balanced,premium').split(',');
    if(aliases.some(a=>!Object.hasOwn(config.models,a)))throw new Error('Unknown model alias.');
    const selected=args.includes('--smoke')?[{id:'connection',prompt:'Reply with the answer OK.',expected:'OK'}]:cases.filter(c=>!args.includes('--case')||c.id===option('--case'));
    if(!selected.length)throw new Error('Unknown case. Use --list to see candidates.');
    aliases.forEach(a=>connection(config.models[a]));
    const count=args.includes('--smoke')?1:repeats;
    console.log(`LIVE MaaS evaluation: ${aliases.length*selected.length*count} requests. No player budgets or game statistics are changed.`);
    const output=`data/evaluations/${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    mkdirSync('data/evaluations',{recursive:true});
    const results=[];
    const report={started_at:new Date().toISOString(),grading:'Exact normalized JSON answer; format errors and transport errors are separate. Eval prompts differ from player prompts.',models:Object.fromEntries(aliases.map(a=>[a,{model:config.models[a].endpoint_model_name,game_cost:config.models[a].game_cost,chat_template_kwargs:config.models[a].chat_template_kwargs ?? null}])),results};
    for(const alias of aliases)for(const candidate of selected)for(let iteration=1;iteration<=count;iteration++) {
      const start=performance.now();
      let row={alias,case:candidate.id,iteration,prompt:candidate.prompt,expected:candidate.expected};
      try {
        const answer=await chat(config.models[alias],[{role:'system',content:'Solve the task. Return only a JSON object with one field: "answer". Use a short answer, number, or UNKNOWN when information is insufficient.'},{role:'user',content:candidate.prompt}]);
        row={...row,...grade(answer.text,candidate.expected),response:answer.text,input_tokens:answer.input,output_tokens:answer.output,reasoning_tokens:answer.reasoning,finish_reason:answer.finish_reason};
      } catch(error) {row={...row,status:'request_error',correct:false,error:error.message};}
      row.latency_ms=Math.round(performance.now()-start);results.push(row);
      writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
      console.log(`${alias} / ${candidate.id} #${iteration}: ${row.status}${row.status==='answered'?(row.correct?' correct':' incorrect'):''} (${row.latency_ms} ms)`);
    }
    console.table(aliases.map(alias=>{const rows=results.filter(r=>r.alias===alias);const measured=rows.filter(r=>r.status!=='request_error');return {model:alias,correct:rows.filter(r=>r.correct).length,attempts:rows.length,format_errors:rows.filter(r=>r.status==='format_error').length,request_errors:rows.length-measured.length,avg_response_ms:measured.length?Math.round(measured.reduce((s,r)=>s+r.latency_ms,0)/measured.length):null};}));
    console.log(`Results saved to ${output}. Small samples indicate candidates, not reliable model rankings.`);
    if(results.some(r=>r.status==='request_error'))process.exitCode=1;
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
