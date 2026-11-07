import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { openDatabase, initializeDatabase, listEntries, getEntry, createEntry, updateEntry, deleteEntry, getProfile, updateProfile, getStats, getGoals, toggleGoal, getUserByEmail, createSession, userForSession, deleteSession } from './db.js';
import { validateEntry, validateLogin, validateProfile, ENTRY_TYPES } from './validation.js';
import { verifyPassword, randomToken } from './security.js';
import { fetchPreview } from './metadata.js';
import { rateLimit } from './rate-limit.js';
import { json, noContent, readBody, readBuffer, cookies, setCookie, serveFile, parseMultipart } from './http.js';

const imageTypes = {
  'image/png': { ext: '.png', test: b => b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  'image/jpeg': { ext: '.jpg', test: b => b[0]===0xff && b[1]===0xd8 && b[2]===0xff },
  'image/webp': { ext: '.webp', test: b => b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WEBP' },
  'image/gif': { ext: '.gif', test: b => ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()) },
  'application/pdf': { ext: '.pdf', test: b => b.subarray(0,4).toString()==='%PDF' }
};

function securityHeaders(req, res) {
  const nonce = crypto.randomBytes(12).toString('base64');
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin'); res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (config.isProduction) res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  return nonce;
}
function requestId(req,res){const id=String(req.headers['x-request-id']||crypto.randomUUID()).slice(0,80);res.setHeader('X-Request-Id',id);return id;}
async function currentUser(req, db) { return userForSession(db, cookies(req).lj_session); }
async function requireOwner(req, db) { const user=await currentUser(req,db); if(!user) throw Object.assign(new Error('Sign in as the journal owner to continue.'),{status:401}); return user; }
function assertOrigin(req) {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return;
  const origin=req.headers.origin; if(!origin) return;
  const expected=config.appOrigin || `${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`;
  if(origin!==expected) throw Object.assign(new Error('Invalid request origin.'),{status:403});
}
function parseId(pathname, pattern){const match=pathname.match(pattern);return match?Number(match[1]):null;}

async function api(req,res,url,db) {
  const pathname=url.pathname; assertOrigin(req);
  if(req.method==='GET'&&pathname==='/api/health') return json(res,200,{status:'ok',database:'connected',time:new Date().toISOString()});
  if(req.method==='GET'&&pathname==='/api/bootstrap') {
    const user=await currentUser(req,db); const type=url.searchParams.get('type')||'all'; const search=(url.searchParams.get('search')||'').slice(0,100);
    return json(res,200,{profile:await getProfile(db),stats:await getStats(db),goals:await getGoals(db),entries:await listEntries(db,{type:ENTRY_TYPES.includes(type)?type:'all',search,admin:Boolean(user)}),authenticated:Boolean(user),user:user?{email:user.email}:null,types:ENTRY_TYPES});
  }
  if(req.method==='GET'&&pathname==='/api/entries') {
    const type=url.searchParams.get('type')||'all'; const search=(url.searchParams.get('search')||'').slice(0,100);
    return json(res,200,{entries:await listEntries(db,{type:ENTRY_TYPES.includes(type)?type:'all',search,limit:Number(url.searchParams.get('limit')||100),admin:Boolean(await currentUser(req,db))})});
  }
  const entryId=parseId(pathname,/^\/api\/entries\/(\d+)$/);
  if(req.method==='GET'&&entryId) { const entry=await getEntry(db,entryId,Boolean(await currentUser(req,db))); return entry?json(res,200,{entry}):json(res,404,{error:'Entry not found.'}); }
  if(req.method==='POST'&&pathname==='/api/auth/login') {
    const ip=req.socket.remoteAddress||'unknown'; const rate=rateLimit(`login:${ip}`,8,15*60*1000);
    if(!rate.allowed) return json(res,429,{error:'Too many sign-in attempts. Try again later.'},{'Retry-After':rate.retryAfter});
    const {email,password}=validateLogin(await readBody(req,config.maxJsonBytes)); const user=await getUserByEmail(db,email);
    if(!user||!(await verifyPassword(password,user.password_salt,user.password_hash))) return json(res,401,{error:'Email or password is incorrect.'});
    const token=randomToken(); const expires=new Date(Date.now()+config.sessionDays*86400000); await createSession(db,user.id,token,expires.toISOString());
    return json(res,200,{authenticated:true,user:{email:user.email}},{'Set-Cookie':setCookie('lj_session',token,{maxAge:config.sessionDays*86400,secure:config.isProduction})});
  }
  if(req.method==='POST'&&pathname==='/api/auth/logout') { const token=cookies(req).lj_session; await deleteSession(db,token); return noContent(res,{'Set-Cookie':setCookie('lj_session','',{maxAge:0,secure:config.isProduction})}); }
  if(req.method==='GET'&&pathname==='/api/auth/session') { const user=await currentUser(req,db); return json(res,200,{authenticated:Boolean(user),user:user?{email:user.email}:null}); }
  if(req.method==='POST'&&pathname==='/api/entries') { await requireOwner(req,db); const input=validateEntry(await readBody(req,config.maxJsonBytes)); return json(res,201,{entry:await createEntry(db,input)}); }
  if(req.method==='PATCH'&&entryId) { await requireOwner(req,db); const entry=await updateEntry(db,entryId,validateEntry(await readBody(req,config.maxJsonBytes),true)); return entry?json(res,200,{entry}):json(res,404,{error:'Entry not found.'}); }
  if(req.method==='DELETE'&&entryId) { await requireOwner(req,db); return await deleteEntry(db,entryId)?noContent(res):json(res,404,{error:'Entry not found.'}); }
  if(req.method==='PATCH'&&pathname==='/api/profile') { await requireOwner(req,db); return json(res,200,{profile:await updateProfile(db,validateProfile(await readBody(req,config.maxJsonBytes)))}); }
  if(req.method==='POST'&&pathname==='/api/meta/preview') {
    await requireOwner(req,db); const rate=rateLimit(`preview:${req.socket.remoteAddress||'unknown'}`,30,60*60*1000);
    if(!rate.allowed) return json(res,429,{error:'Preview limit reached. Try again later.'},{'Retry-After':rate.retryAfter});
    const body=await readBody(req,config.maxJsonBytes); if(typeof body.url!=='string') throw Object.assign(new Error('A URL is required.'),{status:400});
    return json(res,200,{preview:await fetchPreview(body.url)});
  }
  if(req.method==='POST'&&pathname==='/api/uploads') {
    await requireOwner(req,db); const contentType=String(req.headers['content-type']||'');
    if(!contentType.startsWith('multipart/form-data')) throw Object.assign(new Error('Use multipart/form-data for uploads.'),{status:415});
    const buffer=await readBuffer(req,config.maxUploadBytes+64*1024); const {files}=parseMultipart(buffer,contentType); const file=files.find(f=>f.name==='image')||files[0];
    if(!file||!file.data.length) throw Object.assign(new Error('Choose an image to upload.'),{status:400});
    const detected=Object.entries(imageTypes).find(([,value])=>value.test(file.data));
    if(!detected) throw Object.assign(new Error('Upload a PNG, JPEG, WebP, GIF, or PDF file.'),{status:415});
    fs.mkdirSync(config.uploadDir,{recursive:true}); const filename=`${Date.now()}-${crypto.randomBytes(10).toString('hex')}${detected[1].ext}`;
    fs.writeFileSync(path.join(config.uploadDir,filename),file.data,{flag:'wx',mode:0o640}); return json(res,201,{url:`/uploads/${filename}`});
  }
  const goalId=parseId(pathname,/^\/api\/goals\/(\d+)\/toggle$/);
  if(req.method==='POST'&&goalId){await requireOwner(req,db);const goal=await toggleGoal(db,goalId);return goal?json(res,200,{goal}):json(res,404,{error:'Goal not found.'});}
  return json(res,404,{error:'API route not found.'});
}

export async function createApp(options={}) {
  const db=options.db||await openDatabase(options.databasePath); await initializeDatabase(db);
  const handler=async(req,res)=>{
    const id=requestId(req,res); securityHeaders(req,res); const started=Date.now();
    try {
      const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
      if(url.pathname.startsWith('/api/')) await api(req,res,url,db);
      else if(url.pathname.startsWith('/uploads/')) {
        const name=path.basename(url.pathname); const file=path.join(config.uploadDir,name); if(!serveFile(res,file,true)) json(res,404,{error:'Image not found.'});
      } else {
        const relative=url.pathname==='/'||url.pathname==='/admin'?'index.html':url.pathname.replace(/^\//,'');
        const file=path.resolve(config.publicDir,relative);
        if(!file.startsWith(path.resolve(config.publicDir))||!serveFile(res,file,/\.[a-f0-9]{8}\./.test(file))) {
          if(!path.extname(url.pathname)) serveFile(res,path.join(config.publicDir,'index.html'));
          else json(res,404,{error:'File not found.'});
        }
      }
    } catch(error) {
      const status=Number(error.status)||500; if(status>=500) console.error(`[${id}]`,error);
      if(!res.headersSent) json(res,status,{error:status>=500?'Something went wrong. Please try again.':error.message,field:error.field,requestId:id}); else res.end();
    } finally { if(!config.isTest) console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now()-started}ms`); }
  };
  return { server:http.createServer(handler), db, handler };
}
