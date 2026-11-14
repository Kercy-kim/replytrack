import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { compareRuns } from '../evals/performance.mjs';
const [before, after, output] = process.argv.slice(2);
if (!before || !after) throw new Error('Usage: node scripts/compare-evaluations.mjs before.json after.json [comparison.json]');
const comparison = { sourceReports: { before, after }, ...compareRuns(JSON.parse(readFileSync(before, 'utf8')), JSON.parse(readFileSync(after, 'utf8'))) };
if (output) { if (existsSync(output)) throw new Error('Refusing to overwrite a comparison'); writeFileSync(output, JSON.stringify(comparison, null, 2) + '\n'); }
console.log(JSON.stringify(comparison, null, 2));
if (comparison.regressions.length) process.exitCode = 1;
