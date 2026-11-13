import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const files=['server.mjs',...['src','public','tests','scripts'].flatMap(dir=>readdirSync(dir).filter(f=>/\.(mjs|js)$/.test(f)).map(f=>join(dir,f)))];
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
console.log(`Syntax checked ${files.length} JavaScript files.`);
