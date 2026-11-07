import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'); const dirs=['server','src','scripts','tests']; const files=[];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())walk(p);else if(item.name.endsWith('.js'))files.push(p);}}
for(const dir of dirs){const p=path.join(root,dir);if(fs.existsSync(p))walk(p);} let failed=false;
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){failed=true;console.error(result.stderr||result.stdout);}}
if(failed)process.exit(1); console.log(`${files.length} JavaScript files passed syntax checks.`);
