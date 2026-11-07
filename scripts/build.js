import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..'); const source=path.join(root,'src'); const output=path.join(root,'dist','public');
fs.rmSync(path.join(root,'dist'),{recursive:true,force:true}); fs.mkdirSync(output,{recursive:true}); fs.cpSync(source,output,{recursive:true});
const required=['index.html','app.js','styles.css']; for(const file of required){if(!fs.existsSync(path.join(output,file))) throw new Error(`Build missing ${file}`);}
const html=fs.readFileSync(path.join(output,'index.html'),'utf8'); if(!html.includes('app.js')||!html.includes('styles.css')) throw new Error('index.html is missing application assets.');
console.log(`Production assets built in ${path.relative(root,output)} (${required.length} critical files verified).`);
