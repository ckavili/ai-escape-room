import { readEvents } from './stream.js';
import { formatCost, costLabel } from './cost.js';
const app = document.querySelector('#app');
let config, player, busy = false, result = null, message = '', selectedContext = new Set();
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let serverOffset = 0, activity = null, reasoningText = '', answerText = '';
function updateActivity() {
  const node=document.querySelector('[data-activity]');
  if(node&&activity)node.textContent=`${activity.label} ${activity.phase}… · ${Math.floor((performance.now()-activity.started)/1000)}s`;
}
const reasoningDetails = () => `<details class="reasoning-panel" ${busy ? 'open' : ''} aria-live="off"><summary>View model reasoning</summary><pre data-reasoning>${esc(reasoningText)}</pre></details>`;
const reasoningPanel = () => `<div data-reasoning-host>${reasoningText ? reasoningDetails() : ''}</div>`;

const api = async (path,body,key) => {
  const response = await fetch(path,body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
  const serverTime=Number(response.headers.get('X-Server-Time'));
  if (serverTime) serverOffset=serverTime-Date.now();
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    let final;
    for await (const event of readEvents(response.body)) {
      const chunk=JSON.parse(event.data);
      if(chunk.type==='error')throw new Error(chunk.error);
      if(chunk.type==='result')final=chunk;
      if(chunk.type==='status'&&activity){
        const phases={waiting:'is waiting for model output',connected:'is waiting for its first output',responding:'is responding',nonstreaming:'is preparing a response'};
        activity.phase=phases[chunk.phase]||activity.phase;
      }
      if(chunk.type==='reasoning') {
        reasoningText=(reasoningText+chunk.text).slice(0,64000);
        if(activity)activity.phase='is reasoning';
        let node=document.querySelector('[data-reasoning]');
        if(!node){const host=document.querySelector('[data-reasoning-host]');if(host)host.innerHTML=reasoningDetails();node=document.querySelector('[data-reasoning]');}
        if(node)node.textContent=reasoningText;
      }
      if(chunk.type==='answering') {
        if(activity)activity.phase='is writing the answer';
        if(typeof chunk.text==='string')answerText=(answerText+chunk.text).slice(0,256000);
        const host=document.querySelector('[data-answer-host]');
        if(host && answerText){
          if(!host.querySelector('[data-answer-text]'))host.innerHTML='<div class="result"><div class="eyebrow">Answer arriving…</div><p data-answer-text></p></div>';
          host.querySelector('[data-answer-text]').textContent=answerText;
        }
      }
      updateActivity();
    }
    if(!final)throw new TypeError('Connection interrupted. Checking your request…');
    return final;
  }
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
};
const banner = () => config.demo ? '<div class="demo">DEMO MODE · Simulated AI answers. No MaaS calls or real token usage.</div>' : '';
const currentRoom = () => config.rooms.find(room => room.id === player.current_room);
const duration = ms => {
  if (ms == null) return '—';
  const seconds=Math.floor(Math.max(0,ms)/1000);
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
};
const elapsed = () => !player ? null : player.game_completed ? player.solve_time_ms : Date.now()+serverOffset-player.started;
const clock = () => `<div class="stat elapsed-stat"><strong data-clock role="timer" aria-label="Elapsed game time">${duration(elapsed())}</strong><span>${player.game_completed?'final time':'elapsed time'}</span></div>`;
setInterval(()=>{document.querySelectorAll('[data-clock]').forEach(node=>node.textContent=duration(elapsed()));updateActivity();},250);
const stats = () => `<div class="stats"><div class="eyebrow">Room ${player.current_room} / ${config.rooms.length} · ${esc(currentRoom().title)}</div><div class="stat"><strong>${player.budget}</strong><span>game coins left</span></div><div class="stat"><strong>${player.score}</strong><span>points</span></div>${clock()}</div>`;
const number = value => value == null ? '—' : value.toLocaleString();
function tokenCard(usage) {
  const total = usage.input_tokens == null || usage.output_tokens == null ? null : usage.input_tokens + usage.output_tokens;
  return `<div class="token-card"><div class="token-total"><strong>${number(total)}</strong><span>tokens used</span></div><div class="token-breakdown"><div><b>${number(usage.input_tokens)}</b><span>input</span></div><div><b>${number(usage.output_tokens)}</b><span>output</span></div></div></div>`;
}
function render() {
  if (!player) {
    app.innerHTML = `${banner()}<div class="hero"><section><div class="eyebrow">An experiment in choosing wisely</div><h1>A locked room.<br>A little AI.<br>Your way out.</h1><p class="intro">You have ${config.initial_budget} coins and ${config.rooms.length} rooms to escape. Use your own instinct, or spend a little on artificial intelligence.</p><div><span class="tag">${config.rooms.length} rooms</span><span class="tag">3 model choices</span><span class="tag">Your decision</span></div><p class="fine">The strongest model isn’t always the smartest choice.</p></section><section class="panel"><div class="vault" aria-hidden="true"><div class="dial"><span>???</span></div></div><form id="join"><label for="nickname">What should we call you?</label><input id="nickname" name="nickname" placeholder="e.g. PixelFox" maxlength="24" autocomplete="nickname" required><button class="wide">Enter the escape room ↗</button></form><p class="error" role="status">${esc(message)}</p><p class="fine">The clock starts when you enter and keeps running while AI responds.</p></section></div>`;
    document.querySelector('#join').onsubmit = async e => {e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{player=await api('/api/session',{nickname:e.target.nickname.value});message='';render();}catch(err){document.querySelector('.error').textContent=err.message;button.disabled=false;}};
    return;
  }
  if (player.completed) {
    app.innerHTML = `${banner()}<section class="success"><div class="eyebrow">Room ${player.current_room} complete</div><h1>${player.game_completed ? 'You found<br>your way out.' : ({1:'Vault unlocked.',2:'Signal decoded.',3:'Door opened.'}[player.current_room] || 'Room complete.')}</h1><p class="intro">${esc(player.explanation)}</p><div class="panel"><div class="stats"><div class="stat"><strong>+${player.room_score}</strong><span>room points</span></div><div class="stat"><strong>${player.score}</strong><span>total points</span></div><div class="stat"><strong>${player.budget}</strong><span>game coins left</span></div>${clock()}</div><p class="fine">Room solved in ${duration(player.room_elapsed_ms)}.</p><p class="fine">Each room: ${config.scoring.completion_points} base − ${config.scoring.coin_penalty} per coin spent − ${config.scoring.wrong_attempt_penalty} per wrong answer. Minimum: 0.</p>${player.game_completed ? '<p>Use the right intelligence, in the right way, at the right time.</p><p class="fine">You made the choices this round. A future round will explore automated model selection at scale.</p><a class="text-link" href="/dashboard">See everyone’s choices ↗</a>' : `<button id="next" class="wide" ${busy?'disabled':''}>Next room →</button>`}<p class="error" role="status">${esc(message)}</p></div></section>`;
    document.querySelector('#next')?.addEventListener('click',()=>action(`/api/rooms/${player.current_room}/next`,{}));
    return;
  }
  const room = currentRoom();
  const contextCost = selectedContext.size * config.scoring.context_cost_per_record;
  app.innerHTML = `${banner()}${stats()}<div class="game-grid"><section><div class="eyebrow">${room.id} / ${esc(room.lesson)}</div><h1 class="room-title">${esc(room.title)}.</h1><p class="intro">${esc(room.story)}</p>${room.clues.length ? `<div class="note"><div class="eyebrow">A note from the previous operator</div><ol>${room.clues.map(c=>`<li>${esc(c)}</li>`).join('')}</ol></div>` : ''}${room.documents ? `<div class="note pattern"><div class="eyebrow">Keypad display</div><pre>${esc(room.documents[0].text)}
5 → ?</pre></div>` : ''}${room.choices ? `<fieldset class="directions"><legend>${esc(room.question)}</legend>${room.choices.map(choice=>`<button data-answer="${choice}" ${busy?'disabled':''}>${choice}</button>`).join('')}</fieldset>` : `<form id="answer"><label for="code">${esc(room.question)}</label><input class="code" id="code" name="code" placeholder="···" inputmode="numeric" pattern="[0-9]{3}" maxlength="3" required ${busy?'disabled':''}><button class="wide" ${busy?'disabled':''}>Unlock the vault →</button></form>`}<p class="fine">Solving it yourself is free. Each wrong answer costs ${config.scoring.wrong_attempt_penalty} points.</p></section><aside class="panel"><div class="eyebrow">Your intelligence, amplified</div><h2>Want a second opinion?</h2><p class="muted">You don’t have to use AI. If you do, choose how much help this puzzle deserves.</p>${room.documents ? `<fieldset class="records"><legend>What should AI see?</legend><label class="record"><input type="radio" name="context" value="question" ${selectedContext.size?'':'checked'} ${busy?'disabled':''}><span><b>Only the question</b><small>“5 → ?” · no extra coins</small></span></label><label class="record"><input type="radio" name="context" value="examples" ${selectedContext.size?'checked':''} ${busy?'disabled':''}><span><b>Include the examples</b><small>The full keypad display · +${config.scoring.context_cost_per_record} coin</small></span></label><p class="fine" role="status">AI will see: ${selectedContext.size?'the examples and “5 → ?”':'only “5 → ?”'}</p></fieldset>` : ''}${room.has_hint ? `<button id="hint" class="model" ${busy||player.budget<config.scoring.hint_cost?'disabled':''}><b>Get a hint</b><span>${config.scoring.hint_cost} coin</span><small>A nudge, without the full solution.</small></button><p class="fine">Or ask a model for the full answer:</p>` : ''}${config.models.map(m=>`<button class="model" data-model="${esc(m.alias)}" ${busy||player.budget<m.game_cost+contextCost?'disabled':''}><b>${esc(m.display_name)}</b><span>${m.game_cost+contextCost} coins${contextCost?` (includes ${contextCost} for examples)`:``}</span><small>${esc(m.description)}</small></button>`).join('')}<p class="fine">Coins are charged only when an answer arrives. AI can be wrong. You choose the final answer.</p><div role="status" aria-live="polite"><p class="error">${esc(message)}</p>${busy?(activity?`<p class="loading" data-activity>${esc(activity.label)} is waiting for model output… · 0s</p><p class="fine">Your clock is still running.</p>`:'<p class="loading">AI is working… Your clock is still running.</p>'):''}${reasoningPanel()}<div data-answer-host></div>${result?`<div class="result"><div class="eyebrow">${result.assistance_type==='hint' ? (result.demo?'Simulated hint':'AI hint') : (result.demo?'Simulated answer':'AI result')}</div><p>${esc(result.response)}</p>${tokenCard(result.usage)}<div class="result-meta"><span>${result.game_cost} coins</span><span>${(result.latency_ms/1000).toFixed(2)}s</span><span>${esc(costLabel(result))}</span></div></div>`:''}</div></aside></div>`;
  document.querySelectorAll('[data-model]').forEach(button=>button.onclick=()=>action(`/api/rooms/${room.id}/assist`,{model_alias:button.dataset.model,selected_context_ids:[...selectedContext]}));
  document.querySelectorAll('.record input').forEach(input=>input.onchange=()=>{selectedContext.clear();if(input.value==='examples')selectedContext.add('examples');render();document.querySelector(`.record input[value="${input.value}"]`)?.focus();});
  document.querySelector('#hint')?.addEventListener('click',()=>action(`/api/rooms/${room.id}/assist`,{assistance_type:'hint'}));
  document.querySelectorAll('[data-answer]').forEach(button=>button.onclick=()=>action(`/api/rooms/${room.id}/answer`,{answer:button.dataset.answer}));
  document.querySelector('#answer')?.addEventListener('submit',e=>{e.preventDefault();action(`/api/rooms/${room.id}/answer`,{answer:e.target.code.value});});
}
async function action(path,body) {
  if(path.endsWith('assist')){reasoningText='';answerText='';result=null;}
  const modelAlias=body.assistance_type==='hint' ? config.scoring.hint_model : body.model_alias;
  activity=path.endsWith('assist') && !config.demo ? {label:config.models.find(model=>model.alias===modelAlias)?.display_name || 'AI',phase:'is waiting for model output',started:performance.now()} : null;
  if(activity)body={...body,stream:true};
  busy=true;message='';render();
  // Keep the same key when retrying a transport failure: never charge twice.
  const key=crypto.randomUUID();
  try {
    let data;
    try {data=await api(path,body,key);}catch(error){if(error instanceof TypeError){answerText='';reasoningText='';render();data=await api(path,body,key);}else throw error;}
    player=data;if(path.endsWith('assist'))result=data;else if(path.endsWith('next')){result=null;reasoningText='';selectedContext.clear();}else if(!data.correct)message='Not quite. Take another look at the clues.';
  }catch(error){message=error.message;try{player=await api('/api/session');}catch{}}
  finally{busy=false;activity=null;render();}
}
async function dashboard() {
  try {
    const data=await api('/api/dashboard');
    const consumption=data.consumption;
    const requests=data.models.reduce((sum,m)=>sum+m.requests,0);
    app.innerHTML=`${banner()}<div class="eyebrow">Live room activity · Updates every 3 seconds</div><h1>Small choices.<br>A bigger picture.</h1><p class="intro">Watch how players put their intelligence budget to work.</p><div class="metric-grid"><div class="panel"><strong>${data.players}</strong><span class="muted">Players joined</span></div><div class="panel"><strong>${data.escaped}</strong><span class="muted">Rooms escaped</span></div><div class="panel"><strong>${requests}</strong><span class="muted">AI requests</span></div></div><div class="metric-grid consumption"><div class="panel"><strong>${consumption.tokens == null ? '—' : consumption.tokens.toLocaleString()}</strong><span class="muted">Reported live tokens</span></div><div class="panel"><strong>${formatCost(consumption.estimated_cost_usd,true)}</strong><span class="muted">${config.models.some(m=>m.pricing_basis==='demo')?'Demo estimate · USD':'Estimated USD'}${consumption.unpriced_requests?' · partial':''}</span></div></div><p class="fine">${consumption.priced_requests||0} priced requests · ${consumption.unpriced_requests||0} unpriced · ${consumption.missing_usage_requests||0} missing token usage. Dollar estimates use configured rates; demo rates are illustrative.</p><section class="panel leaderboard"><h2>Leaderboard</h2><p class="muted">Rooms escaped → score → fastest solve time</p>${data.leaderboard.length ? `<div class="leaderboard-scroll"><table><thead><tr><th>Rank</th><th>Player</th><th>Rooms</th><th>Score</th><th>Solve time</th></tr></thead><tbody>${data.leaderboard.map(row=>`<tr><td>${row.rank}</td><td>${esc(row.nickname)}<small>${row.finished?'Escaped':'In progress'}</small></td><td>${row.rooms_completed}/${config.rooms.length}</td><td>${row.score}</td><td>${duration(row.solve_time_ms)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">The first escape will take the lead.</p>'}<p class="fine">Solve time runs from joining to the latest room solved, including AI wait time. Earlier saves without timing show —.</p></section><section class="panel room-summary"><h2>Room by room</h2>${config.rooms.map(room=>`<p>${esc(room.title)} <strong>${data.rooms.find(r=>r.room===room.id)?.completed||0} escaped</strong></p>`).join('')}<p class="fine">Hint requests: ${data.assistance.find(a=>a.assistance_type==='hint')?.requests||0} · Full-answer requests: ${data.assistance.find(a=>a.assistance_type==='model')?.requests||0}</p></section><section class="panel token-comparison"><h2>Tokens per model</h2><p class="muted">Average tokens per live request · compare measured usage</p>${config.models.map(model=>{const m=data.models.find(row=>row.model===model.alias&&row.mode==='live');const maximum=Math.max(1,...data.models.filter(row=>row.mode==='live').map(row=>row.avg_tokens||0));return `<div class="token-model"><div><b>${esc(model.display_name)}</b><strong>${m?.avg_tokens == null ? '—' : Math.round(m.avg_tokens).toLocaleString()} <small>avg tokens</small></strong></div><progress max="${maximum}" value="${m?.avg_tokens||0}" aria-label="${esc(model.display_name)} average tokens"></progress><p class="fine">${number(m?.input_tokens)} input · ${number(m?.output_tokens)} output total</p></div>`;}).join('')}</section><section class="panel"><h2>Where the intelligence goes</h2><div class="model-row muted"><span>Model / mode</span><span>Requests</span><span>Real tokens</span></div>${config.models.map(model=>{const rows=data.models.filter(row=>row.model===model.alias);return(rows.length?rows:[{model:model.alias,mode:config.demo?'demo':'live',requests:0,successful:0,input_tokens:null,output_tokens:null,unknown_usage:0}]).map(m=>`<div class="model-row"><div>${esc(model.display_name)}<br><small class="muted">${esc(m.mode)}</small><progress class="bar" max="${requests||1}" value="${m.requests}" aria-label="Share of requests"></progress></div><div>${m.requests}<br><small class="muted">${m.successful} successful</small></div><div>${m.mode==='demo'?'—':m.input_tokens===null&&m.output_tokens===null?'—':((m.input_tokens||0)+(m.output_tokens||0)).toLocaleString()}<br><small class="muted">${m.mode==='demo'?'Simulated':m.unknown_usage?`${m.unknown_usage} missing usage`:'Reported by MaaS'}</small>${m.mode==='live'?`<br><small class="muted">${m.estimated_cost_usd == null ? 'Cost unavailable' : `Est. ${formatCost(m.estimated_cost_usd)}`}${m.unpriced_requests?' · incomplete':''}</small>`:''}</div></div>`).join('');}).join('')}<p class="fine">Request counts include failures. Tokens reflect reported usage only; missing usage is never estimated. Demo and live requests are shown separately.</p></section>`;
  }catch(error){app.innerHTML=`<p class="error">${esc(error.message)} Reconnecting…</p>`;}
}
(async()=>{try{config=await api('/api/config');if(location.pathname==='/dashboard'){await dashboard();setInterval(dashboard,3000);}else{try{player=await api('/api/session');}catch{}render();}}catch(error){app.textContent=error.message;}})();
