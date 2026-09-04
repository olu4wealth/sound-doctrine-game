#!/usr/bin/env node
// scripts/backfill-metadata.mjs — Phase 1a: audit + backfill category/skill/difficulty/nearIndexes
// Reads data/questions-merged.json, applies scripts/category-map.json, tier->skill, fills missing fields.
// Usage: node scripts/backfill-metadata.mjs [--write]  (dry-run by default)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const mergedPath = join(root, 'data', 'questions-merged.json');
const mapPath = join(root, 'scripts', 'category-map.json');
const write = process.argv.includes('--write');

const data = JSON.parse(readFileSync(mergedPath, 'utf8'));
const catMapFile = JSON.parse(readFileSync(mapPath, 'utf8'));
const subjectToCat = catMapFile.map;
const fallback = catMapFile.fallback;

const tierToSkill = {
  1: 'recall',
  2: 'precision',
  3: 'connection',
  4: 'reasoning',
  5: 'reasoning',
  6: 'reasoning',
  7: 'synthesis',
};

let patched = 0;
let missingCat = [];
let tierDist = {};
let bookTier = {};
let chapterDist = {};
let skillDist = {};
let nearCount = 0;
let difficultyFixed = 0;

for (const q of data) {
  // tier dist
  tierDist[q.tier] = (tierDist[q.tier] || 0) + 1;
  const bt = `${q.book} T${q.tier}`;
  bookTier[bt] = (bookTier[bt] || 0) + 1;
  chapterDist[q.chapter] = (chapterDist[q.chapter] || 0) + 1;
  if (Array.isArray(q.nearIndexes) && q.nearIndexes.length) nearCount++;

  // category
  if (!q.category) {
    const key = (q.subject || '').toLowerCase().trim();
    const cat = subjectToCat[key] || subjectToCat[key.toLowerCase()] || fallback;
    if (!subjectToCat[key]) missingCat.push({ id: q.id, subject: q.subject, assigned: cat });
    q.category = cat;
    patched++;
  }

  // skill
  if (!q.skill) {
    q.skill = tierToSkill[q.tier] || 'recall';
    patched++;
  }
  skillDist[q.skill] = (skillDist[q.skill] || 0) + 1;

  // difficulty: REFOCUS says 1-7, should equal tier unless explicitly authored
  if (q.difficulty === undefined || q.difficulty === null) {
    q.difficulty = q.tier;
    difficultyFixed++;
    patched++;
  } else if (q.difficulty < 1 || q.difficulty > 7) {
    // legacy 1-3 values: keep but warn; normalize only if out of 1-7
    // leave as-is, but count
  } else if (q.difficulty !== q.tier) {
    // Keep author's difficulty if 1-7, but note drift
  }

  // ensure type is present (default to recall)
  if (!q.type) q.type = 'recall';

  // normalize nearIndexes to array if missing
  if (q.nearIndexes === undefined) q.nearIndexes = [];
}

console.log(`Total questions: ${data.length}`);
console.log(`Tier distribution:`, tierDist);
console.log(`Book×Tier:`, bookTier);
console.log(`Chapter distribution:`, chapterDist);
console.log(`Skill distribution:`, skillDist);
console.log(`With nearIndexes: ${nearCount}/${data.length}`);
console.log(`Patched fields: ${patched} (category/skill/difficulty fills)`);
console.log(`Difficulty filled: ${difficultyFixed}`);
if (missingCat.length) {
  console.log(`\nSubjects with no explicit mapping (used fallback "${fallback}"): ${missingCat.length}`);
  for (const m of missingCat) console.log(`  ${m.id}: subject="${m.subject}" -> ${m.assigned}`);
  // deduplicate subjects
  const uniq = [...new Set(missingCat.map(m => m.subject))];
  console.log(`\nDistinct unmapped subjects (${uniq.length}):`, uniq.join(', '));
}

const target = { 1: 20, 2: 20, 3: 30, 4: 30, 5: 20, 6: 20, 7: 10 };
console.log(`\nCoverage vs target (150):`);
for (let t = 1; t <= 7; t++) {
  const have = tierDist[t] || 0;
  const need = target[t];
  const diff = have - need;
  const flag = diff < 0 ? `need ${-diff}` : diff > 0 ? `surplus +${diff}` : 'ok';
  console.log(`  T${t}: have ${have} / target ${need} -> ${flag}`);
}
console.log(`  Total: have ${data.length} / target 150 -> need ${150 - data.length}`);

if (write) {
  // sort by id for stable diff
  data.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(mergedPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`\nWrote backfilled ${mergedPath}`);
} else {
  console.log(`\nDry run — use --write to persist`);
}
