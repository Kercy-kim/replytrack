import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { presentationData } from '../src/presentation.mjs';
const source = process.argv[2] || JSON.parse(readFileSync('public/presentation-data.json', 'utf8')).provenance.source;
const raw = readFileSync(source);
const data = presentationData(JSON.parse(raw), { source, sha256: createHash('sha256').update(raw).digest('hex') });
writeFileSync('public/presentation-data.json', JSON.stringify(data, null, 2) + '\n');
console.log('Built verified synthetic API replay; original AI text preserved.');
