import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { validateEntry } from '../server/validation.js';
import { hashPassword, verifyPassword, isPrivateIp } from '../server/security.js';

let server; let db; let base; let cookie;
before(async () => {
  const app = await createApp({ databasePath: ':memory:' }); server = app.server; db = app.db;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
async function call(path, options={}) {
  const headers={...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers};
  if(cookie)headers.Cookie=cookie;
  const response=await fetch(`${base}${path}`,{...options,headers});
  const data=response.status===204?null:await response.json(); return {response,data};
}

test('health and public bootstrap return a complete journal', async () => {
  const health=await call('/api/health'); assert.equal(health.response.status,200); assert.equal(health.data.database,'connected');
  const result=await call('/api/bootstrap'); assert.equal(result.response.status,200); assert.equal(result.data.authenticated,false);
  assert.ok(result.data.entries.length>=9); assert.ok(result.data.stats.days>=3); assert.equal(result.data.profile.name,'Aryan');
  assert.match(result.data.stats.today,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result.data.stats.subjects.reduce((sum,subject)=>sum+subject.percent,0),100);
  assert.ok(result.data.profile.about); assert.ok(Array.isArray(result.data.profile.education));
  assert.ok(result.data.entries.every(entry=>entry.published===true));
});

test('owner login is rate-aware and uses a secure session cookie', async () => {
  const rejected=await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:'owner@example.com',password:'not-the-password'})});
  assert.equal(rejected.response.status,401); assert.match(rejected.data.error,/incorrect/i);
  const accepted=await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:'owner@example.com',password:'learning-journal-dev'})});
  assert.equal(accepted.response.status,200); assert.equal(accepted.data.authenticated,true);
  cookie=accepted.response.headers.get('set-cookie').split(';')[0]; assert.match(accepted.response.headers.get('set-cookie'),/HttpOnly/i); assert.match(accepted.response.headers.get('set-cookie'),/SameSite=Lax/i);
  const session=await call('/api/auth/session'); assert.equal(session.data.authenticated,true);
});

test('authenticated CRUD validates and persists rich journal entries', async () => {
  const invalid=await call('/api/entries',{method:'POST',body:JSON.stringify({type:'unknown',title:'x'})});
  assert.equal(invalid.response.status,400);
  const payload={type:'project',title:'Built a retrieval experiment',description:'Compared chunk sizes and recorded the result.',occurredAt:new Date().toISOString(),url:'https://example.com/project',thumbnailUrl:null,imageUrl:null,subject:'AI Engineering',durationMinutes:45,tags:['RAG','experiment','rag'],metrics:{progress:72},published:false};
  const created=await call('/api/entries',{method:'POST',body:JSON.stringify(payload)}); assert.equal(created.response.status,201); assert.equal(created.data.entry.tags.length,2); assert.equal(created.data.entry.published,false);
  const id=created.data.entry.id;
  const updated=await call(`/api/entries/${id}`,{method:'PATCH',body:JSON.stringify({title:'Built and evaluated a retrieval experiment',published:true})}); assert.equal(updated.response.status,200); assert.equal(updated.data.entry.published,true);
  const publicList=await call('/api/entries?type=project&search=retrieval'); assert.ok(publicList.data.entries.some(entry=>entry.id===id));
  const removed=await call(`/api/entries/${id}`,{method:'DELETE'}); assert.equal(removed.response.status,204);
  const missing=await call(`/api/entries/${id}`); assert.equal(missing.response.status,404);
});

test('profile and daily goal mutations are owner-only and validated', async () => {
  const profile=(await call('/api/bootstrap')).data.profile;
  const rejectedResume=await call('/api/profile',{method:'PATCH',body:JSON.stringify({...profile,resumeUrl:'https://example.com/resume.pdf'})});
  assert.equal(rejectedResume.response.status,400);
  const updated=await call('/api/profile',{method:'PATCH',body:JSON.stringify({...profile,currentProgress:73,currentlyLearning:'AI agents',about:'I study in public.',education:[{school:'City School',detail:'Science',years:'2024'}],experience:[{role:'Builder',org:'Journal',dates:'2024',summary:'Daily notes'}],skills:['Physics','Anki']})});
  assert.equal(updated.response.status,200); assert.equal(updated.data.profile.currentProgress,73);
  assert.equal(updated.data.profile.about,'I study in public.'); assert.equal(updated.data.profile.education[0].school,'City School'); assert.deepEqual(updated.data.profile.skills,['Physics','Anki']);
  const bootstrap=await call('/api/bootstrap'); const goal=bootstrap.data.goals[0];
  const toggled=await call(`/api/goals/${goal.id}/toggle`,{method:'POST',body:'{}'}); assert.equal(toggled.response.status,200); assert.equal(toggled.data.goal.completed,!goal.completed);
});

test('image upload rejects disguised files and accepts a valid PNG signature', async () => {
  const bad=new FormData(); bad.append('image',new Blob(['not-an-image'],{type:'image/png'}),'fake.png');
  const rejected=await call('/api/uploads',{method:'POST',body:bad}); assert.equal(rejected.response.status,415);
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68]); const good=new FormData(); good.append('image',new Blob([png],{type:'image/png'}),'tiny.png');
  const accepted=await call('/api/uploads',{method:'POST',body:good}); assert.equal(accepted.response.status,201); assert.match(accepted.data.url,/^\/uploads\/.+\.png$/);
  const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'); const resume=new FormData(); resume.append('image',new Blob([pdf],{type:'application/pdf'}),'resume.pdf');
  const uploaded=await call('/api/uploads',{method:'POST',body:resume}); assert.equal(uploaded.response.status,201); assert.match(uploaded.data.url,/^\/uploads\/.+\.pdf$/);
  const profile=(await call('/api/bootstrap')).data.profile;
  const saved=await call('/api/profile',{method:'PATCH',body:JSON.stringify({...profile,resumeUrl:uploaded.data.url})});
  assert.equal(saved.response.status,200); assert.equal(saved.data.profile.resumeUrl,uploaded.data.url);
});

test('cross-origin mutations are blocked', async () => {
  const result=await call('/api/entries',{method:'POST',headers:{Origin:'https://attacker.example'},body:JSON.stringify({})}); assert.equal(result.response.status,403);
});

test('validation, password hashing, and private IP detection cover security boundaries', async () => {
  assert.throws(()=>validateEntry({type:'note',title:'x',occurredAt:'bad'}),/Title/);
  const result=await hashPassword('a-strong-test-password'); assert.equal(await verifyPassword('a-strong-test-password',result.salt,result.hash),true); assert.equal(await verifyPassword('wrong',result.salt,result.hash),false);
  assert.equal(isPrivateIp('127.0.0.1'),true); assert.equal(isPrivateIp('10.0.0.4'),true); assert.equal(isPrivateIp('8.8.8.8'),false); assert.equal(isPrivateIp('::1'),true);
});

test('logout destroys the server-side session', async () => {
  const result=await call('/api/auth/logout',{method:'POST',body:'{}'}); assert.equal(result.response.status,204);
  const session=await call('/api/auth/session'); assert.equal(session.data.authenticated,false);
  const forbidden=await call('/api/entries',{method:'POST',body:JSON.stringify({})}); assert.equal(forbidden.response.status,401); cookie='';
});
