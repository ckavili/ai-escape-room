import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createKeynote} from '../keynote/server.js';
const {server,db}=createKeynote({database:':memory:',demo:true});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.getByLabel('Your name on the board').fill('Stage Ada');
 await page.getByRole('button',{name:'Enter the challenge'}).click();
 await page.getByRole('heading',{name:'Every choice counts.'}).waitFor();
 await page.screenshot({path:'/private/tmp/keynote-board-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const open=async n=>{await page.getByRole('button',{name:new RegExp(`^Challenge ${n}:`)}).click();};
 const finish=async()=>{await page.getByRole('heading',{name:'Challenge solved ✓',exact:true}).waitFor();await page.getByRole('button',{name:'Choose another box'}).click();};
 await open(1);assert.equal(await page.getByRole('radio',{name:/Solve it myself/}).count(),0);await page.getByRole('radio',{name:/Balanced/}).check();await page.getByRole('button',{name:'Ask this model'}).click();await finish();
 await open(2);await page.getByLabel('Your instruction').fill('List the people');await page.getByRole('button',{name:'Run my attempt'}).click();await page.getByRole('heading',{name:'Not quite. Try another approach.'}).waitFor();
 await page.getByLabel('Your instruction').fill('Return only speaker names, comma separated.');await page.getByRole('button',{name:'Try again'}).click();await finish();
 await open(3);await page.getByRole('checkbox',{name:/Today’s schedule/}).check();await page.getByRole('button',{name:'Run my attempt'}).click();await finish();
 await open(4);await page.getByRole('radio',{name:/Fast Local/}).check();await page.getByRole('button',{name:'Ask this model'}).click();await finish();
 await open(5);await page.getByLabel('Your instruction').fill('Shorten to six words. Keep time and hall.');await page.getByRole('button',{name:'Run my attempt'}).click();await finish();
 await open(6);await page.getByRole('checkbox',{name:/Sam’s dietary needs/}).check();await page.getByRole('checkbox',{name:/Snack ingredients/}).check();await page.getByRole('button',{name:'Run my attempt'}).click();await finish();
 assert.ok(await page.locator('.stats').first().innerText().then(t=>/[1-9]/.test(t)));
 await page.reload();await page.getByRole('heading',{name:'Every choice counts.'}).waitFor();
 assert.equal(await page.locator('.tile.solved').count(),6);
 const other=await browser.newContext({viewport:{width:390,height:844}});const player2=await other.newPage();
 await player2.goto(url);await player2.getByLabel('Your name on the board').fill('Stage Lin');await player2.getByRole('button',{name:'Enter the challenge'}).click();await player2.getByRole('heading',{name:'Every choice counts.'}).waitFor();
 assert.equal(await player2.locator('.tile.solved').count(),0);
 // Phone-specific checks at small and large widths, including a reduced
 // viewport that approximates the space left above a software keyboard.
 for(const width of [320,360,430]) {
  const phoneContext=await browser.newContext({viewport:{width,height:740},isMobile:true,hasTouch:true});
  const phone=await phoneContext.newPage();phone.on('pageerror',e=>errors.push(e.message));
  const fits=async()=>assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No horizontal overflow at ${width}px`);
  await phone.goto(url);await phone.getByLabel('Your name on the board').fill(`Phone ${width}`);
  await phone.getByRole('button',{name:'Enter the challenge'}).tap();await phone.getByRole('heading',{name:'Every choice counts.'}).waitFor();await fits();
  const tile=await phone.getByRole('button',{name:/^Challenge 2:/}).boundingBox();assert.ok(tile.width>=44&&tile.height>=44);
  await phone.getByRole('button',{name:/^Challenge 2:/}).tap();await fits();
  await phone.setViewportSize({width,height:360});
  const prompt=phone.getByLabel('Your instruction');await prompt.fill('Return only the speaker names, comma separated.');
  assert.ok(await prompt.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),'Avoid small input text that triggers iOS zoom');
  await phone.getByRole('button',{name:'Run my attempt'}).tap();
  await phone.getByRole('heading',{name:'Challenge solved ✓',exact:true}).waitFor();await fits();
  const resultHeading=await phone.getByRole('heading',{name:'Challenge solved ✓',exact:true}).boundingBox();
  assert.ok(resultHeading.y>=0&&resultHeading.y<360,'Result brought into the reduced viewport');
  const timer=await phone.locator('.challenge-toolbar').boundingBox();assert.ok(timer.y>=0&&timer.y<40,'Timer stays visible while scrolling');
  await phone.setViewportSize({width,height:740});
  await phone.getByRole('button',{name:'Choose another box'}).tap();
  assert.equal(await phone.evaluate(()=>scrollY),0,'Returning to board resets scroll');
  await phone.getByRole('button',{name:/^Challenge 3:/}).tap();
  const option=await phone.getByRole('checkbox',{name:/Today’s schedule/}).locator('..').boundingBox();assert.ok(option.height>=44);
  await phone.getByRole('checkbox',{name:/Today’s schedule/}).check();await phone.getByRole('button',{name:'Run my attempt'}).tap();
  await phone.getByRole('heading',{name:'Challenge solved ✓',exact:true}).waitFor();await fits();
  if(width===360)await phone.screenshot({path:'/private/tmp/keynote-result-phone.png',fullPage:true});
  await phoneContext.close();
 }
 const stage=await browser.newPage({viewport:{width:1440,height:1080}});stage.on('pageerror',e=>errors.push(e.message));await stage.goto(url+'/stage');await stage.getByRole('heading',{name:'Two players. Their choices.'}).waitFor();await stage.getByText('Demo tokens',{exact:true}).waitFor();
 await stage.getByLabel('Choose stage participant').first().selectOption({label:'Stage Ada'});
 await stage.getByLabel('Choose stage participant').nth(1).selectOption({label:'Stage Lin'});
 await stage.getByRole('button',{name:'Reveal the platform'}).click();await stage.getByRole('heading',{name:/Flexibility to experiment/}).waitFor();
 await stage.screenshot({path:'/private/tmp/keynote-stage-desktop.png',fullPage:true});
 assert.equal(await stage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log('Keynote UI passed: six challenges, retry, persistence, independent players, stage comparison and reveal. Phone checks passed at 320, 360, 390, and 430px, with touch targets, sticky timer, result visibility, and reduced keyboard viewport. No page errors or horizontal overflow.');
} finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
