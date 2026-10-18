import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, chat } from './maas.js';
import { pathToFileURL } from 'node:url';

import { validatePricing, estimateCost } from './pricing.js';
import { rooms, publicRoom } from './rooms.js';
export const puzzle = publicRoom(rooms[0]);
const fail = (status, message) => Object.assign(new Error(message), { status });
export function createApp(options = {}) {
  const config = options.config ?? loadConfig();
  const demo = options.demo ?? process.env.DEMO_MODE === 'true';
  const models = config.models;
  const game = { context_cost_per_record: 1, hint_cost: 1, hint_model: 'fast', ...config.game };
  if (!models[game.hint_model] || !Number.isSafeInteger(game.hint_cost) || game.hint_cost < 1) throw new Error('Invalid hint configuration');
  for (const key of ['context_cost_per_record','initial_budget','completion_points','coin_penalty','wrong_attempt_penalty']) {
    if (!Number.isSafeInteger(game[key]) || game[key] < 0) throw new Error(`Invalid game setting: ${key}`);
  }
  for (const alias of ['fast', 'balanced', 'premium']) {
    const m = models[alias];
    if (!m || !Number.isSafeInteger(m.game_cost) || m.game_cost < 1) throw new Error(`Invalid model: ${alias}`);
    validatePricing(m.pricing);
    m.alias = alias;
    m.endpoint_model_name = process.env[`MAAS_MODEL_${alias.toUpperCase()}`] || m.endpoint_model_name;
  }
  const dbPath = options.database ?? process.env.DATABASE_PATH ?? 'data/game.sqlite';
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, nickname TEXT, budget INTEGER, spent INTEGER DEFAULT 0, wrong INTEGER DEFAULT 0, score INTEGER DEFAULT 0, completed INTEGER DEFAULT 0, started INTEGER);
    CREATE TABLE IF NOT EXISTS actions (session TEXT, key TEXT, kind TEXT, payload TEXT, response TEXT, PRIMARY KEY(session,key));
    CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY, session TEXT, model TEXT, backing_model TEXT, mode TEXT, status TEXT, cost INTEGER, input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER, created INTEGER);
  `);
  // Additive migration preserves existing one-room sessions and their budgets.
  const columns = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
  if (!columns.includes('current_room')) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE sessions ADD COLUMN current_room INTEGER DEFAULT 1;
      ALTER TABLE sessions ADD COLUMN room_spent INTEGER DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN room_wrong INTEGER DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN room_score INTEGER DEFAULT 0;
      UPDATE sessions SET room_spent=spent,room_wrong=wrong,room_score=score;
      COMMIT;`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS completions (session TEXT,room INTEGER,score INTEGER,PRIMARY KEY(session,room));
    INSERT OR IGNORE INTO completions(session,room,score) SELECT id,current_room,room_score FROM sessions WHERE completed=1;`);
  if (!db.prepare('PRAGMA table_info(requests)').all().some(c => c.name === 'room')) {
    db.exec("ALTER TABLE requests ADD COLUMN room INTEGER DEFAULT 1; ALTER TABLE requests ADD COLUMN assistance_type TEXT DEFAULT 'model';");
  }
  if (!db.prepare('PRAGMA table_info(requests)').all().some(c => c.name === 'context_ids')) {
    db.exec("ALTER TABLE requests ADD COLUMN context_ids TEXT DEFAULT '[]'; ALTER TABLE requests ADD COLUMN context_cost INTEGER DEFAULT 0;");
  }
  if (!db.prepare('PRAGMA table_info(requests)').all().some(c => c.name === 'estimated_cost_usd')) {
    db.exec("ALTER TABLE requests ADD COLUMN estimated_cost_usd REAL; ALTER TABLE requests ADD COLUMN pricing_snapshot TEXT;");
  }
  if (!db.prepare('PRAGMA table_info(requests)').all().some(c => c.name === 'reasoning_tokens')) {
    db.exec("ALTER TABLE requests ADD COLUMN reasoning_tokens INTEGER;");
  }
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'finished')) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE sessions ADD COLUMN finished INTEGER;
      ALTER TABLE sessions ADD COLUMN room_started INTEGER;
      UPDATE sessions SET room_started=started WHERE current_room=1 AND completed=0;
      ALTER TABLE completions ADD COLUMN elapsed_ms INTEGER;
      ALTER TABLE completions ADD COLUMN room_elapsed_ms INTEGER;
      COMMIT;`);
  }
  const leaderboard = () => db.prepare(`
    SELECT s.nickname,s.score,s.current_room,s.completed,COUNT(c.room) AS rooms_completed,
      MAX(c.elapsed_ms) AS solve_time_ms
    FROM sessions s JOIN completions c ON c.session=s.id
    GROUP BY s.id
    ORDER BY rooms_completed DESC,s.score DESC,solve_time_ms IS NULL,solve_time_ms ASC,s.started ASC,s.id ASC
    LIMIT 10`).all().map((row,index)=>({...row,rank:index+1,finished:row.completed===1 && row.current_room===rooms.length}));
  const active = new Set();
  const state = id => {
    if (!id) throw fail(401, 'Join the game to continue.');
    const row = db.prepare('SELECT nickname,budget,spent,wrong,score,completed,started,current_room,room_spent,room_wrong,room_score,finished,room_started FROM sessions WHERE id=?').get(id);
    if (!row) throw fail(401, 'Join the game to continue.');
    const timing = db.prepare('SELECT elapsed_ms,room_elapsed_ms FROM completions WHERE session=? AND room=?').get(id,row.current_room);
    return { ...row, room_elapsed_ms: timing?.room_elapsed_ms ?? null, solve_time_ms: timing?.elapsed_ms ?? null, game_completed: Boolean(row.completed && row.current_room === rooms.length), rooms_completed: db.prepare('SELECT COUNT(*) AS n FROM completions WHERE session=?').get(id).n, ...(row.completed ? { explanation: rooms[row.current_room-1].explanation } : {}) };
  };
  const infer = options.infer ?? (async (model, room, assistanceType, selectedDocuments = [], onEvent) => {
    if (demo && room.documents && selectedDocuments.length === 0) return { text: 'I only see “5 → ?”. Please include the examples so I can work out the pattern.', input: null, output: null };
    if (demo) return { text: assistanceType === 'hint' ? room.hint : room.demo, input: null, output: null };
    return chat(model, [
      { role: 'system', content: assistanceType === 'hint' ? 'Give exactly one short hint for this puzzle. Do not reveal the answer, spell out the hidden word, or solve it. Suggest only where to look.' : 'Help a player solve this escape-room puzzle. Give the answer and one short sentence explaining it. Only use the provided clues and selected records. If information is missing, say what is needed; do not invent facts.' },
      { role: 'user', content: `${room.story}\n${room.clues.join('\n')}\n${room.question}\n${selectedDocuments.map(doc => `${doc.title}: ${doc.text}`).join('\n')}` },
    ], onEvent);
  });
  const server = http.createServer(async (req, res) => {
    const event = body => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(body)}\n\n`); };
    const send = (status, body, headers = {}) => { if(res.headersSent){event({type:status>=400?'error':'result',...body});res.end();return;} res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Server-Time': String(Date.now()), ...headers }); res.end(JSON.stringify(body)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && ['/','/dashboard','/app.js','/cost.js','/stream.js','/style.css'].includes(path)) {
        const file = path === '/' || path === '/dashboard' ? 'index.html' : path.slice(1);
        res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
        return res.end(readFileSync(new URL(`./public/${file}`, import.meta.url)));
      }
      if (req.method === 'GET' && path === '/api/config') return send(200, { demo, puzzle, rooms: rooms.map(publicRoom), initial_budget: game.initial_budget, scoring: game, models: Object.entries(models).map(([alias, m]) => ({ alias, display_name: m.display_name, description: m.description, game_cost: m.game_cost, pricing_basis: m.pricing?.basis ?? 'configured' })) });
      if (req.method === 'GET' && path === '/api/dashboard/leaderboard') return send(200,leaderboard());
      if (req.method === 'GET' && path === '/api/dashboard') return send(200, {
        leaderboard: leaderboard(),
        players: db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,
        escaped: db.prepare('SELECT COUNT(*) AS count FROM completions').get().count,
        rooms: db.prepare('SELECT room,COUNT(*) AS completed FROM completions GROUP BY room').all(),
        assistance: db.prepare('SELECT assistance_type,COUNT(*) AS requests FROM requests GROUP BY assistance_type').all(),
        consumption: db.prepare(`SELECT SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)) AS tokens,
          SUM(estimated_cost_usd) AS estimated_cost_usd,
          SUM(CASE WHEN estimated_cost_usd IS NOT NULL THEN 1 ELSE 0 END) AS priced_requests,
          SUM(CASE WHEN estimated_cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_requests,
          SUM(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END) AS missing_usage_requests
          FROM requests WHERE mode='live'`).get(),
        models: db.prepare(`SELECT model,mode,COUNT(*) AS requests,SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successful,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,SUM(reasoning_tokens) AS reasoning_tokens,SUM(CASE WHEN reasoning_tokens IS NULL THEN 1 ELSE 0 END) AS missing_reasoning,AVG(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL THEN input_tokens+output_tokens END) AS avg_tokens,SUM(CASE WHEN status='success' AND (input_tokens IS NULL OR output_tokens IS NULL) THEN 1 ELSE 0 END) AS unknown_usage,SUM(estimated_cost_usd) AS estimated_cost_usd,SUM(CASE WHEN mode='live' AND estimated_cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_requests,AVG(latency_ms) AS latency_ms FROM requests GROUP BY model,mode`).all(),
      });
      const id = /(?:^|;\s*)escape_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (req.method === 'GET' && path === '/api/session') return send(200, state(id));
      if (req.method !== 'POST') throw fail(404, 'Not found.');
      if (req.headers.origin && req.headers.origin !== `${process.env.COOKIE_SECURE === 'true' ? 'https' : 'http'}://${req.headers.host}`) throw fail(403, 'Request origin rejected.');
      if (!(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'Send JSON.');
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) throw fail(413, 'Request too large.'); }
      let body;
      try { body = JSON.parse(raw); } catch { throw fail(400, 'Invalid JSON.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Invalid request.');
      if (path === '/api/session') {
        if (id && db.prepare('SELECT id FROM sessions WHERE id=?').get(id)) return send(200, state(id));
        const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
        if (!/^[\p{L}\p{N} _-]{1,24}$/u.test(nickname)) throw fail(400, 'Use 1–24 letters, numbers, spaces, hyphens or underscores.');
        const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions(id,nickname,budget,started,room_started) VALUES(?,?,?,?,?)').run(token,nickname,game.initial_budget,Date.now(),Date.now());
        return send(201,state(token), { 'Set-Cookie': `escape_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}` });
      }
      const player = state(id);
      const route = /^\/api\/rooms\/(\d+)\/(assist|answer|next)$/.exec(path);
      const room = route && rooms.find(r => r.id === Number(route[1]));
      if (!room) throw fail(404, 'Not found.');
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) throw fail(400, 'A valid idempotency key is required.');
      const payload = JSON.stringify(body);
      const old = db.prepare('SELECT * FROM actions WHERE session=? AND key=?').get(id,key);
      if (old) {
        if (old.kind !== path || old.payload !== payload) throw fail(409, 'This request key was already used for another action.');
        return send(200, JSON.parse(old.response));
      }
      if (active.has(id)) throw fail(409, 'Please wait for your current request to finish.');
      if (room.id !== player.current_room) throw fail(409, 'This room is not your current room.');
      const save = result => db.prepare('INSERT INTO actions VALUES(?,?,?,?,?)').run(id,key,path,payload,JSON.stringify(result));
      if (path.endsWith('/next')) {
        if (!player.completed || player.game_completed) throw fail(409, 'Complete this room before continuing.');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE sessions SET current_room=current_room+1,completed=0,room_spent=0,room_wrong=0,room_score=0,room_started=?,finished=NULL WHERE id=?').run(Date.now(),id);
          const result = state(id); save(result); db.exec('COMMIT'); return send(200,result);
        } catch(e) { db.exec('ROLLBACK'); throw e; }
      }
      if (player.completed) throw fail(409, 'You already escaped this room.');
      if (path.endsWith('/answer')) {
        if (typeof body.answer !== 'string' || (room.choices ? !room.choices.includes(body.answer.trim().toUpperCase()) : !/^\d{3}$/.test(body.answer.trim()))) throw fail(400, room.choices ? 'Choose one of the available answers.' : 'Enter a three-digit code.');
        const correct = body.answer.trim().toUpperCase() === room.answer;
        const score = correct ? Math.max(0,game.completion_points-game.coin_penalty*player.room_spent-game.wrong_attempt_penalty*player.room_wrong) : 0;
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE sessions SET completed=?,score=score+?,room_score=?,wrong=wrong+?,room_wrong=room_wrong+? WHERE id=?').run(Number(correct),score,score,Number(!correct),Number(!correct),id);
          if (correct) {
            const finished = Date.now();
            db.prepare('INSERT INTO completions(session,room,score,elapsed_ms,room_elapsed_ms) VALUES(?,?,?,?,?)').run(id,room.id,score,Math.max(0,finished-player.started),player.room_started == null ? null : Math.max(0,finished-player.room_started));
            if (room.id === rooms.length) db.prepare('UPDATE sessions SET finished=? WHERE id=?').run(finished,id);
          }
          const result = { correct, ...state(id) }; save(result); db.exec('COMMIT'); return send(200,result);
        } catch(e) { db.exec('ROLLBACK'); throw e; }
      }
      const assistanceType = body.assistance_type ?? 'model';
      if (!['model','hint'].includes(assistanceType) || (assistanceType === 'hint' && !room.hint)) throw fail(400,'This assistance is not available.');
      const alias = assistanceType === 'hint' ? game.hint_model : body.model_alias;
      const model = Object.hasOwn(models, alias) ? models[alias] : null;
      if (!model) throw fail(400,'Choose an available model.');
      const contextIds = body.selected_context_ids ?? [];
      if (!Array.isArray(contextIds) || contextIds.some(id => typeof id !== 'string') || new Set(contextIds).size !== contextIds.length || contextIds.some(id => !room.documents?.some(doc => doc.id === id))) throw fail(400,'Choose valid, unique records from this room.');
      const selectedDocuments = (room.documents || []).filter(doc => contextIds.includes(doc.id));
      const contextCost = selectedDocuments.length * game.context_cost_per_record;
      const cost = (assistanceType === 'hint' ? game.hint_cost : model.game_cost) + contextCost;
      if (player.budget < cost) throw fail(402,'Not enough coins. You can still solve the puzzle yourself.');
      const last = db.prepare('SELECT created FROM requests WHERE session=? ORDER BY id DESC LIMIT 1').get(id);
      if (last && Date.now()-last.created < 1500) throw fail(429,'Wait a moment before asking again.');
      active.add(id);
      const started = Date.now();
      const streaming = body.stream === true && !demo;
      if (streaming) {
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','X-Server-Time':String(Date.now())});
        res.flushHeaders();event({type:'status',phase:'waiting'});
      }
      try {
        let answer;
        try { answer = await infer(model, room, assistanceType, selectedDocuments, streaming ? event : undefined); } catch (e) {
          const used=e.usage ?? {input:null,output:null,reasoning:null};
          const estimate=estimateCost(model.pricing,used.input,used.output,demo);
          db.prepare('INSERT INTO requests(session,model,backing_model,mode,status,cost,input_tokens,output_tokens,reasoning_tokens,latency_ms,created,room,assistance_type,context_ids,context_cost,estimated_cost_usd,pricing_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,alias,model.endpoint_model_name,demo?'demo':'live','error',0,used.input,used.output,used.reasoning,Date.now()-started,started,room.id,assistanceType,JSON.stringify(contextIds),0,estimate.estimated_cost_usd,model.pricing == null || demo ? null : JSON.stringify(model.pricing));
          throw fail(e.status || 502,e.status ? e.message : 'Model request failed or timed out. No coins were charged.');
        }
        const latency = Date.now()-started;
        const estimate = estimateCost(model.pricing,answer.input,answer.output,demo);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE sessions SET budget=budget-?,spent=spent+?,room_spent=room_spent+? WHERE id=?').run(cost,cost,cost,id);
          db.prepare('INSERT INTO requests(session,model,backing_model,mode,status,cost,input_tokens,output_tokens,latency_ms,created,room,assistance_type,context_ids,context_cost,estimated_cost_usd,pricing_snapshot,reasoning_tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,alias,model.endpoint_model_name,demo?'demo':'live','success',cost,answer.input,answer.output,latency,started,room.id,assistanceType,JSON.stringify(contextIds),contextCost,estimate.estimated_cost_usd,model.pricing == null || demo ? null : JSON.stringify(model.pricing),answer.reasoning ?? null);
          const result = { ...estimate, response: answer.text, assistance_type:assistanceType, game_cost:cost, context_cost:contextCost, selected_context_ids:contextIds, usage:{input_tokens:answer.input,output_tokens:answer.output,reasoning_tokens:answer.reasoning ?? null}, latency_ms:latency, demo,...state(id) };
          save(result); db.exec('COMMIT'); return send(200,result);
        } catch(e) { db.exec('ROLLBACK'); throw e; }
      } finally { active.delete(id); }
    } catch (e) { if (!e.status) console.error('Request failed:',e.name); send(e.status || 500,{error:e.status ? e.message : 'Something went wrong. Please try again.'}); }
  });
  return { server, db };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const {server} = createApp();
  server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log(`Escape room: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`));
}
