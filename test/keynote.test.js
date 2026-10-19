import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKeynote} from '../keynote/server.js';
import {challenges,correct} from '../keynote/challenges.js';
async function fixture(t,options={}) {
 const app=createKeynote({database:':memory:',demo:true,...options});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(()=>{app.server.closeAllConnections();app.server.close();app.db.close();});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 async function call(path,body,cookie){const res=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
 return {...app,call,base};
}
test('keynote accepts useful short answers and rejects missing essentials',()=>{
 assert.equal(correct(challenges[1],'Maya, Nora'),true);
 assert.equal(correct(challenges[1],'Maya, Leo, Nora'),false);
 assert.equal(correct(challenges[4],'Workshop: 15:00, Hall B.'),true);
 assert.equal(correct(challenges[4],'Meet in Hall B at 15:00.'),true);
 assert.equal(correct(challenges[4],'Workshop in Hall B.'),false);
 assert.equal(correct(challenges[4],'The workshop starts at 15:00 in Hall B.'),false);
});
test('demo board requires AI, simulates usage, retains retries, and isolates sessions',async t=>{
 const {call,db}=await fixture(t);
 const config=await call('config');assert.equal(config.body.challenges.length,6);assert.equal(config.body.challenges[0].expected,undefined);assert.equal(config.body.challenges[0].lesson,undefined);
 assert.equal((await call('attempt',{challenge:1,model:'fast'})).status,401);
 const a=await call('join',{nickname:'Ada'}),b=await call('join',{nickname:'Lin'});
 assert.equal((await call('attempt',{challenge:1,model:'manual',answer:'POSITIVE'},a.cookie)).status,400);
 const win=await call('attempt',{challenge:1,model:'balanced'},a.cookie);
 assert.equal(win.body.correct,true);assert.ok(win.body.cost>0);assert.ok(win.body.input>0);assert.ok(win.body.output>0);assert.equal(win.body.demo,true);
 assert.equal((await call('attempt',{challenge:1,model:'fast'},a.cookie)).status,409);
 assert.equal((await call('me',null,b.cookie)).body.attempts.length,0);
 const context=await call('attempt',{challenge:6,model:'premium',context:['menu']},a.cookie);
 assert.equal(context.body.correct,false);assert.ok(context.body.input>0);assert.ok(context.body.cost>0);assert.equal(context.body.model,'fast');
 assert.equal((await call('attempt',{challenge:6,context:['diet','menu']},a.cookie)).body.correct,true);
 const dashboard=(await call('dashboard')).body;assert.equal(dashboard.requests,3);assert.equal(dashboard.solved,2);assert.ok(dashboard.tokens>0);assert.ok(dashboard.cost>0);assert.equal(dashboard.unknown,0);
 const token=a.cookie.split('=')[1];assert.ok(!JSON.stringify(dashboard).includes(token));
 db.prepare('UPDATE players SET started=? WHERE nickname=?').run(Date.now()-241000,'Ada');
 assert.equal((await call('attempt',{challenge:4,model:'fast'},a.cookie)).status,409);
});
test('live requests enforce fixed controls, forward only chosen context, and retain failure usage',async t=>{
 let messages;
 const infer=async(model,m)=>{messages=m;assert.equal(model.alias,'fast');return {text:'2',input:40,output:2};};
 const {call}=await fixture(t,{demo:false,infer});const {cookie}=await call('join',{nickname:'Live'});
 assert.equal((await call('attempt',{challenge:3,context:['bogus']},cookie)).status,400);
 const result=await call('attempt',{challenge:3,model:'premium',context:['today']},cookie);
 assert.equal(result.body.correct,true);assert.equal(result.body.input,40);assert.ok(result.body.cost>0);
 assert.match(messages[1].content,/Lunch is on floor 2/);assert.doesNotMatch(messages[1].content,/floor 1|ConferenceGuest/);
 const errorApp=await fixture(t,{demo:false,infer:async()=>{throw Object.assign(new Error('private provider info'),{usage:{input:10,output:3}});}});
 const errorPlayer=await errorApp.call('join',{nickname:'Error'});
 const failed=await errorApp.call('attempt',{challenge:4,model:'fast'},errorPlayer.cookie);
 assert.equal(failed.body.correct,false);assert.equal(failed.body.input,10);assert.ok(failed.body.cost>0);assert.ok(!JSON.stringify(failed).includes('private provider info'));
 const dashboard=(await errorApp.call('dashboard')).body;assert.equal(dashboard.requests,1);assert.equal(dashboard.tokens,13);
});
