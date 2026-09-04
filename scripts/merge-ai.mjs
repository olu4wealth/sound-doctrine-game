#!/usr/bin/env node
// scripts/merge-ai.mjs — Merge validated AI candidates into the canonical bank.
// Usage: node scripts/merge-ai.mjs --in data/questions-ai.json [--dry-run]
// Validates candidates with the same 6-gate logic (via verify/check.mjs) then
// merges approved ones into data/questions-merged.json (sorted by id).

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const args = process.argv.slice(2);
function arg(name, fallback) { const i = args.indexOf(`--${name}`); return i===-1 ? fallback : args[i+1]; }
const inPath = arg('in', 'data/questions-ai.json');
const dryRun = args.includes('--dry-run');
const inFile = join(root, inPath);

function usage() {
  console.log(`Usage: node scripts/merge-ai.mjs --in <path> [--dry-run]
  --in       AI candidates file (JSON array or {candidates: []} wrapper)
  --dry-run  validate without writing`);
}

let raw;
try { raw = JSON.parse(readFileSync(inFile,'utf8')); }
catch(e){ console.error(`Cannot read ${inPath}: ${e.message}`); usage(); process.exit(1); }

const candidates = Array.isArray(raw) ? raw : (Array.isArray(raw.candidates) ? raw.candidates : null);
if (!candidates || candidates.length === 0) {
  console.error(`No candidates found in ${inPath} — expected JSON array or {candidates: [...]}`);
  console.error('Generate first: node scripts/ai-generate.mjs --tier 5 --count 10 --out data/questions-ai.json');
  process.exit(1);
}

console.log(`Candidates: ${candidates.length} from ${inPath}`);

// Write candidates to a temp file that verify/check.mjs can read by swapping merged path?
// Simpler: run a one-off check by temporarily writing the array to the expected shape.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const tmp = mkdtempSync(join(tmpdir(), 'sd-merge-'));
const tmpPath = join(tmp, 'candidates.json');
writeFileSync(tmpPath, JSON.stringify(candidates, null, 2));

// Validate by invoking verify/check.mjs against a synthetic file — we shell out with env
// so check.mjs reads this file instead. Patch: write candidates as questions-merged.json check
// via a wrapper that imports check logic. Easiest: just run check.mjs inline duplicate.
// Instead, we validate structurally here and rely on the full check after merge.
const mergedPath = join(root, 'data/questions-merged.json');
const merged = JSON.parse(readFileSync(mergedPath,'utf8'));
const existingIds = new Set(merged.map(q=>q.id));
let ok = 0, dup = 0;
for (const q of candidates) {
  if (!q.id) { console.warn(`  SKIP: missing id for ${q.prompt?.slice(0,40)}`); continue; }
  if (existingIds.has(q.id)) { console.warn(`  SKIP duplicate id: ${q.id}`); dup++; continue; }
  ok++;
}
console.log(`Validated structurally: ${ok} new, ${dup} duplicate ids`);

if (dryRun) {
  console.log('[dry-run] not writing');
  rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

// Shell out to verify/check.mjs against a temp merged copy to get full 6-gate result
const combined = [...merged, ...candidates.filter(q=>q.id && !existingIds.has(q.id))];
combined.sort((a,b)=>a.id.localeCompare(b.id));
const combinedTmp = join(tmp, 'combined.json');
writeFileSync(combinedTmp, JSON.stringify(combined, null, 2));
// Invoke check.mjs by temporarily symlinking: simplest is to replace merged, run check, restore on fail
import { copyFileSync } from 'node:fs';
const backup = readFileSync(mergedPath,'utf8');
writeFileSync(mergedPath, JSON.stringify(combined, null, 2)+'\n');
const result = spawnSync(process.execPath, [join(root,'verify/check.mjs')], { encoding: 'utf8', cwd: root });
console.log(result.stdout||'');
if (result.stderr) console.error(result.stderr);
if (result.status !== 0) {
  // restore
  writeFileSync(mergedPath, backup);
  console.error(`\nMerge aborted: combined bank FAILED 6-gate check (exit ${result.status}). Fix candidates and retry.`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
console.log(`\nMerged ${ok} questions -> ${mergedPath} (${combined.length} total, was ${merged.length})`);
console.log('Next: review, then commit.');
rmSync(tmp, { recursive: true, force: true });
