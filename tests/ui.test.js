import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const html=fs.readFileSync(path.join(root,'src','index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'src','styles.css'),'utf8');
const js=fs.readFileSync(path.join(root,'src','app.js'),'utf8');

test('document includes accessibility and responsive foundations',()=>{
  assert.match(html,/lang="en"/); assert.match(html,/name="viewport"/); assert.match(html,/class="skip-link"/); assert.match(html,/aria-label="Primary navigation"/); assert.match(html,/aria-live="polite"/);
  assert.match(css,/@media\(max-width:820px\)/); assert.match(css,/@media\(max-width:580px\)/); assert.match(css,/@media\(prefers-reduced-motion:reduce\)/); assert.match(css,/:focus-visible/);
});

test('client implements every journal activity and owner workflow',()=>{
  for(const type of ['lecture','note','anki','project','article','questions','image']) assert.match(js,new RegExp(`${type}:\\{`));
  for(const action of ['/api/auth/login','/api/entries','/api/meta/preview','/api/uploads','/api/profile']) assert.ok(js.includes(action));
  for(const view of ['home','about','stats','now']) assert.match(html,new RegExp(`data-nav="${view}"`));
  assert.match(js,/data-nav="stats"/); assert.match(js,/Download resume/); assert.match(js,/Activity calendar/);
  assert.match(js,/rel="noopener noreferrer"/); assert.match(js,/function esc\(/); assert.match(js,/aria-modal="true"/);
});
