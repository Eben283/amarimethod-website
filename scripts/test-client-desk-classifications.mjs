// All requests are mocked; no provider or production data is read or written.
// PLAYWRIGHT_MODULE may point to an installed Playwright module for isolated runtimes.
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import {clientDeskHtml} from '../crm-mirror-worker/src/client-desk.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const proofDir = process.env.CLIENT_DESK_PROOF_DIR || await fs.mkdtemp(path.join(tmpdir(), 'amari-classification-proof-'));
await fs.mkdir(proofDir,{recursive:true});
const html=clientDeskHtml(), browser=await chromium.launch({headless:true}), context=await browser.newContext({viewport:{width:1280,height:800}});
try {
const states={'contact-a':{tags:[{value:'focus',source:'ghl'}],roles:[{value:'lead',source:'ghl'}]},'contact-b':{tags:[],roles:[]}};
let schemaReady=true,catalogAvailable=true,catalogTruncated=false,catalogHold=null,catalogRelease,catalogArrived;
const profile=id=>({contact:{id,display_name:id==='contact-a'?'Avery Example':'Blair Example',ghl_contact_id:'abc123'},tags:[...new Set(states[id].tags.map(x=>x.value))],roles:[...new Set(states[id].roles.map(x=>x.value))],ownedClassificationAuthority:{state:schemaReady?'ready':'unavailable',...states[id]},ownedTaskAuthority:{state:'ready'},ownedNoteAuthority:{state:'ready'},tasks:[],notes:[],appointments:[],activityTimeline:[]});
let mode='success',requests=[],unexpected=[],release;const applied=new Set();
const frameUrl=actor=>'https://crm.test/client-desk?contact=contact-a&parent_origin=https%3A%2F%2Famarimethod.com#dashboard_session=9999999999.'+Buffer.from(actor).toString('base64url')+'.fixture';
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());const json=x=>route.fulfill({contentType:'application/json',body:JSON.stringify(x)});
 if(url.hostname==='amarimethod.com')return route.fulfill({contentType:'text/html',body:'<iframe style="border:0;width:100%;height:100vh" src="'+frameUrl('Eben')+'"></iframe>'});
 if(url.pathname==='/client-desk')return route.fulfill({contentType:'text/html',body:html});
 if(url.pathname==='/client-desk/tag-catalog') {
  if(url.searchParams.get('query')===catalogHold) { catalogArrived?.(); await new Promise(resolve=>catalogRelease=resolve); }
  const terms=(url.searchParams.get('query')||'').toLowerCase().split(/[\s:_-]+/).filter(Boolean);
  const seen=new Set(),entries=[];
  for(const row of Object.values(states).flatMap(s=>s.tags)) {
   const key=row.value+'|'+row.source;if(seen.has(key)||!terms.every(t=>row.value.toLowerCase().includes(t)))continue;seen.add(key);
   const canonicalValue=row.value.toLowerCase().trim().replace(/\s+/g,'-');entries.push({...row,canonicalValue,reusable:/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(canonicalValue)});
  }
  return json({state:catalogAvailable?'ready':'unavailable',entries:catalogAvailable?entries:[],truncated:catalogTruncated});
 }
 if(url.pathname==='/contacts/classification-commands'){
  const body=route.request().postDataJSON();requests.push(body);
  if(mode==='wait')await new Promise(r=>release=r);
  if(mode==='expired')return route.fulfill({status:401,contentType:'application/json',body:'{"error":"staff_session_required"}'});
  if(mode==='failed')return route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'});
  const kind=body.action.endsWith('tag')?'tags':'roles', value=body.value.toLowerCase().replace(/\s+/g,'-');
  if(!applied.has(body.idempotencyKey)){
   const rows=states[body.contactId][kind];
   if(body.action.startsWith('add')||body.action.startsWith('grant')){if(!rows.some(x=>x.source==='owned:staff'&&x.value===value))rows.push({source:'owned:staff',value});}
   else states[body.contactId][kind]=rows.filter(x=>x.source!=='owned:staff'||x.value!==value);
   applied.add(body.idempotencyKey);
  }
  return json({classification:{contactId:body.contactId,action:body.action,value}});
 }
 if(url.pathname.startsWith('/client-desk/contacts/'))return json(profile(url.pathname.split('/')[3]));
 if(url.pathname.includes('/inbox'))return json({threads:Object.keys(states).map(id=>({contact_id:id,display_name:profile(id).contact.display_name})),freshness:{}});
 unexpected.push(url.href);return route.abort();
});
const parent=await context.newPage();await parent.goto('https://amarimethod.com/fixture');
let page;const getFrame=async()=>{await parent.waitForTimeout(80);page=parent.frames().find(f=>f.url().includes('/client-desk'));await page.locator('#classification-tag').waitFor();};await getFrame();
const saved=()=>page.locator('#owned-classifications .note-status').filter({hasText:'Saved to Amari CRM.'}).waitFor();
const choose=async value=>{await page.locator('#classification-tag').fill(value);const choice=page.locator('[data-tag-choice]:not([disabled]),[data-tag-create]').first();await choice.waitFor();await choice.click();};
const add=async value=>{await choose(value);await page.locator('#classification-tag-submit').click();await saved();};
await page.locator('#new-note').fill('Keep note draft');await page.locator('#sms-reply').fill('Keep SMS draft');await page.locator('#task-title').fill('Keep task draft');
await page.locator('#classification-tag').fill('Focus Tag');await page.locator('[data-tag-create]').waitFor();assert.equal(await page.locator('#classification-tag-submit').isDisabled(),true);await page.locator('[data-tag-create]').click();assert.equal(await page.locator('#classification-tag-preview').textContent(),'New Amari tag: focus-tag');await page.locator('#classification-tag-submit').click();await saved();assert.equal(requests.at(-1).value,'focus-tag');
await page.locator('[data-classification-value="focus-tag"]').click();await saved();
const beforeInvalid=requests.length;await page.locator('#classification-tag').fill('$invalid');assert.equal(await page.locator('#classification-tag-submit').isDisabled(),true);assert.equal(requests.length,beforeInvalid);
catalogHold='old search';const heldCatalog=new Promise(resolve=>catalogArrived=resolve);await page.locator('#classification-tag').fill(catalogHold);await heldCatalog;
await page.locator('#classification-tag').fill('Focus');await page.locator('[data-tag-choice]').first().waitFor();catalogHold=null;catalogRelease();await parent.waitForTimeout(100);assert.equal(await page.locator('#classification-tag').inputValue(),'Focus');assert.equal(await page.locator('[data-tag-create]').count(),0);assert.equal(await page.locator('[data-tag-choice] b').first().textContent(),'focus');
await page.locator('#classification-tag').focus();await parent.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-tag-choice')),true);await parent.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'classification-tag-submit');await parent.keyboard.press('Enter');await saved();assert.equal(requests.at(-1).value,'focus');
assert.equal(await page.locator('#new-note').inputValue(),'Keep note draft');assert.equal(await page.locator('#sms-reply').inputValue(),'Keep SMS draft');assert.equal(await page.locator('#task-title').inputValue(),'Keep task draft');
assert.equal(await page.locator('#owned-classifications .compact-card b').filter({hasText:/^focus$/}).count(),2);
await page.locator('[data-classification-action="remove_tag"]').click();await saved();
assert.equal(await page.locator('#owned-classifications .compact-card b').filter({hasText:/^focus$/}).count(),1);
assert.equal(await page.locator('[data-classification-action="remove_tag"]').count(),0);
await page.locator('#classification-role').selectOption('client');await page.locator('#classification-role-form button').click();await saved();
await page.locator('[data-classification-action="revoke_role"]').click();await saved();
assert.equal(await page.locator('[data-classification-action="revoke_role"]').count(),0);
await page.locator('#classification-role').selectOption('lead');await page.locator('#classification-role-form button').click();await saved();
assert.equal(await page.locator('#owned-classifications .compact-card b').filter({hasText:/^Lead$/}).count(),2);
await page.locator('[data-classification-action="revoke_role"]').click();await saved();
assert.equal(await page.locator('#owned-classifications .compact-card b').filter({hasText:/^Lead$/}).count(),1);
await add('renewal');mode='expired';await page.locator('[data-classification-action="remove_tag"]').click();await page.locator('#classification-retry').waitFor();const pending=requests.at(-1);
const replace=async actor=>{await parent.evaluate(url=>{document.querySelector('iframe').remove();const f=document.createElement('iframe');f.style='border:0;width:100%;height:100vh';f.src=url;document.body.append(f);},frameUrl(actor));await getFrame();};
await replace('Garrett');assert.equal(await page.locator('#classification-retry').count(),0);
await replace('Eben');mode='success';await page.locator('#classification-retry').click();await saved();assert.deepEqual(requests.at(-1),pending);
mode='wait';await choose('slow-a');await page.locator('#classification-tag-submit').click();await page.getByRole('button',{name:/Blair Example/}).click();await page.locator('.client-name').filter({hasText:'Blair Example'}).waitFor();mode='success';release();await parent.waitForTimeout(150);assert.equal(await page.locator('.client-name').textContent(),'Blair Example');assert.equal(await page.locator('#owned-classifications .compact-card b').filter({hasText:/^slow-a$/}).count(),0);
await page.getByRole('button',{name:/Avery Example/}).click();await page.locator('#classification-tag').waitFor();
mode='wait';await choose('return-a');await page.locator('#classification-tag-submit').click();await page.getByRole('button',{name:/Blair Example/}).click();await page.locator('.client-name').filter({hasText:'Blair Example'}).waitFor();await page.getByRole('button',{name:/Avery Example/}).click();await page.locator('#classification-tag').waitFor();mode='success';release();await page.locator('#owned-classifications .compact-card b').filter({hasText:/^return-a$/}).waitFor();assert.equal(await page.locator('.client-name').textContent(),'Avery Example');
const noOpCount=requests.length;await page.locator('#classification-tag').fill('return-a');await page.locator('[data-tag-choice]').first().waitFor();assert.equal(await page.locator('[data-tag-choice]').first().isDisabled(),true);assert.equal(await page.locator('#classification-tag-submit').isDisabled(),true);assert.equal(requests.length,noOpCount);
catalogAvailable=false;await page.locator('#classification-tag').fill('catalog missing');await page.locator('[data-tag-refresh]').waitFor();assert.equal(await page.locator('#classification-tag-submit').isDisabled(),true);assert.equal(await page.locator('[data-tag-create]').count(),0);
catalogAvailable=true;catalogTruncated=true;await page.locator('[data-tag-refresh]').click();await page.getByText('More tags match. Refine the search; creating a new tag is unavailable until the results are complete.',{exact:true}).waitFor();assert.equal(await page.locator('[data-tag-create]').count(),0);catalogTruncated=false;await page.locator('#classification-tag').fill('');
await page.locator('#classification-role').selectOption('referral_source');await page.locator('#classification-role-form button').click();await saved();
for(const [name,width,height]of[['desktop',1280,800],['mobile',390,844]]){await parent.setViewportSize({width,height});await page.locator('#classification-tag-form').scrollIntoViewIfNeeded();await parent.screenshot({path:proofDir+'/' +name+'.png'});await page.locator('#owned-classifications .compact-list').first().scrollIntoViewIfNeeded();await parent.screenshot({path:proofDir+'/' +name+'-labels.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
schemaReady=false;const unavailable=await context.newPage();await unavailable.goto(frameUrl('Eben'));await unavailable.locator('#owned-classifications .note-status').filter({hasText:'unavailable'}).waitFor();assert.equal(await unavailable.locator('#classification-tag-form').count(),0);assert.equal(await unavailable.locator('[data-classification-action]').count(),0);assert.equal(await unavailable.locator('#owned-classifications').getByText('focus',{exact:true}).count(),1);schemaReady=true;
const denied=await context.newPage();await denied.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw new Error('denied')}}));await denied.goto(frameUrl('Eben'));await denied.locator('#classification-tag-form').waitFor();assert.equal(await denied.locator('#classification-tag-submit').isDisabled(),true);
assert.deepEqual(unexpected,[]);
await fs.writeFile(proofDir+'/results.json',JSON.stringify({pass:true,commandCount:requests.length,checks:['out-of-order catalog response ignored','keyboard choose and submit focus retained','explicit new canonical tag','catalog unavailable and truncated fail closed','current owned duplicate disabled','four actions','duplicate GHL label preserved','note/SMS/task drafts retained','same-command iframe renewal','actor isolation','A to B','A to B to A authoritative readback','desktop/mobile no overflow','storage denied']},null,2));
console.log('PASS actual generated classification UI; artifacts: '+proofDir);
} finally { await browser.close(); }
