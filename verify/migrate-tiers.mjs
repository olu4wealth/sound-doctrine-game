#!/usr/bin/env node
// verify/migrate-tiers.mjs — one-time migration: add explicit `tier` (1-7) to the
// legacy questions.json entries based on type + difficulty, writing the file in place.
// Run: node verify/migrate-tiers.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const file = join(root, 'data', 'questions.json');

const bank = JSON.parse(readFileSync(file, 'utf8'));

function tierFor(q) {
  // completion = single-word recall → T1
  if (q.type === 'completion') return 1;
  // number = exact-number recall → T2 (two-or-three witnesses, threescore)
  if (q.type === 'number') return 2;
  // sequence (already in legacy: 1 Tim 3:16 clause order) → T5
  if (q.type === 'sequence') return 5;
  // recall: base T2, rose one tier per difficulty above 1 (medium→3, hard→4)
  if (q.type === 'recall') return 1 + (q.difficulty || 1);
  return 1 + (q.difficulty || 1);
}

let changed = 0;
for (const q of bank) {
  if (q.tier === undefined) {
    q.tier = tierFor(q);
    changed++;
  }
}

writeFileSync(file, JSON.stringify(bank, null, 2) + '\n', 'utf8');
console.log(`Updated ${changed} questions with explicit tiers.`);