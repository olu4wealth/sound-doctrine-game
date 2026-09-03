#!/usr/bin/env node
// verify/check.mjs — 6-gate Scripture lockbox validator + coverage matrix
// Single canonical source: data/questions-merged.json (D2). Falls back to
// 3-file merge if merged is absent (migration compat).
// Gates:
//   A) every fact in the 3 books (KJV exact match)
//   B) exactly one defensible answer (4 distinct options, correctIndex in range)
//   C) verse reference present and resolvable
//   D) distractors plausible (non-empty, distinct, not invented book names)
//   E) tier/skill/difficulty/category consistency
//   F) no duplicates (id + prompt hash)
// Plus coverage report: byTier / byBook×Tier / byChapter
// Exits 0 when all gates pass (coverage warnings do not fail yet); 1 on errors.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ALLOWED_BOOKS = new Set(['1 Timothy', '2 Timothy', 'Titus']);
const ALLOWED_TYPES = new Set(['completion', 'recall', 'number', 'reference', 'discern', 'sequence', 'crossref', 'synthesis']);
const ALLOWED_SKILLS = new Set(['recall', 'precision', 'connection', 'reasoning', 'synthesis']);
const ALLOWED_CATEGORIES = new Set([
  'Sound Doctrine', 'Faith & Grace', 'Church Order', 'Christian Conduct',
  'Endurance & Faithfulness', 'False Teaching & Discernment', 'Last Days', 'Stewardship & Contentment',
]);

const TIER_TO_SKILL = { 1: 'recall', 2: 'precision', 3: 'connection', 4: 'reasoning', 5: 'reasoning', 6: 'reasoning', 7: 'synthesis' };

function loadLockbox() {
  const files = ['kjv-1timothy.json', 'kjv-2timothy.json', 'kjv-titus.json'];
  const lockbox = {};
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
    if (!ALLOWED_BOOKS.has(raw.book)) throw new Error(`Lockbox ${f} unexpected book "${raw.book}"`);
    lockbox[raw.book] = {};
    for (const ch of raw.chapters) {
      lockbox[raw.book][ch.chapter] = {};
      for (const v of ch.verses) lockbox[raw.book][ch.chapter][v.verse] = v.text;
    }
  }
  return lockbox;
}

function parsePassage(passage) {
  const m = /^(1 Timothy|2 Timothy|Titus)\s+(\d+):(\d+)(?:-(\d+))?$/.exec(passage.trim());
  if (!m) return null;
  return { book: m[1], chapter: parseInt(m[2], 10), verseStart: parseInt(m[3], 10), verseEnd: m[4] ? parseInt(m[4], 10) : parseInt(m[3], 10) };
}

function getPassageText(lockbox, ref) {
  const ch = lockbox[ref.book]?.[ref.chapter];
  if (!ch) return null;
  let text = '';
  for (let v = ref.verseStart; v <= ref.verseEnd; v++) {
    if (ch[v] === undefined) return null;
    text += (text ? ' ' : '') + ch[v];
  }
  return text;
}

function hashPrompt(q) {
  const norm = (q.prompt || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const opts = (q.options || []).map(s => s.trim().toLowerCase()).join('|');
  return createHash('sha256').update(`${norm}::${opts}`).digest('hex').slice(0, 12);
}

function main() {
  const lockbox = loadLockbox();

  // Prefer canonical merged file
  let banks, questions;
  const mergedPath = join(root, 'data', 'questions-merged.json');
  if (existsSync(mergedPath)) {
    banks = ['questions-merged.json'];
    questions = JSON.parse(readFileSync(mergedPath, 'utf8'));
  } else {
    banks = ['questions.json', 'questions-t47.json', 'questions-new.json'];
    questions = [];
    for (const f of banks) questions.push(...JSON.parse(readFileSync(join(root, 'data', f), 'utf8')));
  }
  console.log(`Bank files: ${banks.join(', ')}`);

  const errors = [];
  const warnings = [];
  const seenIds = new Set();
  const seenHashes = new Map(); // hash -> id

  if (!Array.isArray(questions) || questions.length === 0) {
    console.error('question bank is empty or not an array');
    process.exit(1);
  }

  questions.forEach((q, i) => {
    const label = q.id || `[index ${i}]`;

    // --- Gate F (part 1): id uniqueness ---
    if (!q.id || typeof q.id !== 'string' || !q.id.trim()) {
      errors.push(`${label}: missing or empty id`);
    } else if (seenIds.has(q.id)) {
      errors.push(`${label}: duplicate id "${q.id}"`);
    } else {
      seenIds.add(q.id);
    }

    // Gate F (part 2): prompt+options hash duplicate
    if (q.prompt && Array.isArray(q.options)) {
      const h = hashPrompt(q);
      if (seenHashes.has(h)) {
        errors.push(`${label}: duplicate prompt+options hash with "${seenHashes.get(h)}" (hash ${h})`);
      } else {
        seenHashes.set(h, q.id || label);
      }
    }

    // Book
    if (!ALLOWED_BOOKS.has(q.book)) {
      errors.push(`${label}: book "${q.book}" outside allowed books`);
    }

    // Tier (Gate E)
    if (q.tier === undefined || q.tier === null) {
      errors.push(`${label}: missing tier (1-7 required)`);
    } else if (!Number.isInteger(q.tier) || q.tier < 1 || q.tier > 7) {
      errors.push(`${label}: tier ${q.tier} must be integer 1-7`);
    }

    // Difficulty (Gate E) — REFOCUS 1-7, should equal tier unless authored
    if (q.difficulty === undefined || q.difficulty === null) {
      errors.push(`${label}: missing difficulty (1-7, normally = tier)`);
    } else if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 7) {
      errors.push(`${label}: difficulty ${q.difficulty} must be integer 1-7`);
    }

    // Category (Gate E)
    if (!q.category || typeof q.category !== 'string') {
      errors.push(`${label}: missing category`);
    } else if (!ALLOWED_CATEGORIES.has(q.category)) {
      warnings.push(`${label}: category "${q.category}" not in canonical 8 (allowed extensible — warn only)`);
    }

    // Skill (Gate E)
    if (!q.skill || typeof q.skill !== 'string') {
      errors.push(`${label}: missing skill`);
    } else if (!ALLOWED_SKILLS.has(q.skill)) {
      errors.push(`${label}: skill "${q.skill}" must be one of ${[...ALLOWED_SKILLS].join(', ')}`);
    } else if (q.tier && TIER_TO_SKILL[q.tier] && q.skill !== TIER_TO_SKILL[q.tier]) {
      // Allow T4/T5/T6 all mapping to reasoning, but flag clear mismatches e.g. T1 synthesis
      const expected = TIER_TO_SKILL[q.tier];
      // T4-T6 all reason, so only warn if T1 recall vs synthesis etc.
      const isLooseReason = q.tier >= 4 && q.tier <= 6 && q.skill === 'reasoning';
      const isExpected = q.skill === expected || isLooseReason;
      if (!isExpected) warnings.push(`${label}: skill "${q.skill}" unusual for tier ${q.tier} (expected ${expected})`);
    }

    // Type
    if (q.type && !ALLOWED_TYPES.has(q.type)) {
      errors.push(`${label}: unknown type "${q.type}"`);
    }

    // Chapter
    if (q.chapter === undefined || !Number.isInteger(q.chapter) || q.chapter < 1) {
      errors.push(`${label}: missing or invalid chapter`);
    } else {
      const maxCh = q.book === '1 Timothy' ? 6 : q.book === '2 Timothy' ? 4 : 3;
      if (q.chapter > maxCh) errors.push(`${label}: chapter ${q.chapter} exceeds max for ${q.book} (${maxCh})`);
    }

    // Options + correctIndex (Gate B)
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      errors.push(`${label}: must have exactly 4 options`);
    } else {
      const trimmed = q.options.map(s => (typeof s === 'string' ? s.trim() : ''));
      if (trimmed.some(s => !s)) errors.push(`${label}: options must be non-empty strings`);
      if (new Set(trimmed.map(s => s.toLowerCase())).size !== 4) {
        errors.push(`${label}: options must be 4 distinct strings (case-insensitive)`);
      }
      // No option should be empty or whitespace
    }
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) {
      errors.push(`${label}: correctIndex must be integer 0-3`);
    }

    // nearIndexes (Gate D helper — Grace)
    if (q.nearIndexes !== undefined) {
      if (!Array.isArray(q.nearIndexes)) {
        errors.push(`${label}: nearIndexes must be array`);
      } else {
        for (const n of q.nearIndexes) {
          if (!Number.isInteger(n) || n < 0 || n > 3) errors.push(`${label}: nearIndexes entry ${n} must be 0-3`);
          if (n === q.correctIndex) errors.push(`${label}: nearIndexes must not include correctIndex`);
        }
        if (new Set(q.nearIndexes).size !== q.nearIndexes.length) errors.push(`${label}: nearIndexes must be unique`);
      }
    }

    // Verses to verify (Gates A + C)
    const versesToCheck = [];
    if (q.passage && q.verseText) versesToCheck.push({ passage: q.passage, verseText: q.verseText });
    if (q.passageB && q.verseTextB) versesToCheck.push({ passage: q.passageB, verseText: q.verseTextB });
    if (Array.isArray(q.verses)) {
      for (const v of q.verses) {
        if (v.passage && v.verseText) versesToCheck.push({ passage: v.passage, verseText: v.verseText });
        else errors.push(`${label}: verses[] entry missing passage/verseText`);
      }
    }
    if (!versesToCheck.length) {
      errors.push(`${label}: no passage/verseText to verify (Gate C)`);
      return;
    }

    for (const item of versesToCheck) {
      const ref = parsePassage(item.passage);
      if (!ref) {
        errors.push(`${label}: passage "${item.passage}" could not be parsed (Gate C)`);
        continue;
      }
      if (!ALLOWED_BOOKS.has(ref.book)) {
        errors.push(`${label}: passage "${item.passage}" references book outside scope (Gate A)`);
      }
      const expected = getPassageText(lockbox, ref);
      if (expected === null) {
        errors.push(`${label}: passage "${item.passage}" does not resolve to a known verse (Gate A)`);
        continue;
      }
      const a = expected.trim();
      const b = item.verseText.trim();
      if (a !== b) {
        errors.push(`${label}: verseText does not match KJV for ${item.passage} (Gate A)`);
        errors.push(`    expected: ${a}`);
        errors.push(`    actual:   ${b}`);
      }
    }

    // Gate D: distractors plausibility — heuristic checks
    if (Array.isArray(q.options)) {
      // Flag distractors that mention a Bible book outside scope (likely invented)
      const outsideBooks = ['Genesis', 'Exodus', 'Matthew', 'Revelation', 'Psalm', 'Acts'];
      for (let idx = 0; idx < q.options.length; idx++) {
        if (idx === q.correctIndex) continue;
        const opt = q.options[idx] || '';
        for (const bk of outsideBooks) {
          if (opt.includes(bk)) warnings.push(`${label}: distractor ${idx} mentions outside book "${bk}" — verify plausibility (Gate D)`);
        }
        if (opt.length < 3) warnings.push(`${label}: distractor ${idx} unusually short (Gate D)`);
      }
    }
  });

  // Coverage report (informational; warn if gaps starve ladder)
  const books = new Set(questions.map(q => q.book));
  console.log(`Questions: ${questions.length}`);
  console.log(`Books covered: ${[...books].join(', ')}`);
  for (const b of ALLOWED_BOOKS) if (!books.has(b)) warnings.push(`No questions for "${b}"`);

  // byTier
  const byTier = {};
  questions.forEach(q => { byTier[q.tier] = (byTier[q.tier] || 0) + 1; });
  console.log(`By tier: ${Object.entries(byTier).sort((a,b)=>a[0]-b[0]).map(([k,v])=>`T${k}:${v}`).join(' ')}`);
  const TARGET = { 1: 20, 2: 20, 3: 30, 4: 30, 5: 20, 6: 20, 7: 10 };
  for (let t = 1; t <= 7; t++) {
    const have = byTier[t] || 0;
    const need = TARGET[t];
    if (have < need * 0.6) warnings.push(`Tier T${t} low: have ${have} / target ${need} — ladder top may starve`);
    else if (have < need) warnings.push(`Tier T${t} below target: have ${have} / target ${need}`);
  }

  // byBook×Tier
  const byBookTier = {};
  questions.forEach(q => { const k = `${q.book} T${q.tier}`; byBookTier[k] = (byBookTier[k] || 0) + 1; });
  for (const book of ALLOWED_BOOKS) {
    for (let t = 1; t <= 7; t++) {
      const k = `${book} T${t}`;
      const n = byBookTier[k] || 0;
      if (n === 0) warnings.push(`Gap: no questions for ${k}`);
      else if (n < 2 && t >= 5) warnings.push(`Thin: only ${n} for high-tier ${k}`);
    }
  }

  // byChapter
  const byChapter = {};
  questions.forEach(q => { const k = `${q.book} Ch${q.chapter}`; byChapter[k] = (byChapter[k] || 0) + 1; });
  console.log(`By chapter: ${Object.entries(byChapter).sort().map(([k,v])=>`${k}:${v}`).join(' ')}`);
  for (const [k,v] of Object.entries(byChapter)) if (v < 2) warnings.push(`Thin chapter ${k}: only ${v} question(s)`);

  if (warnings.length) {
    console.warn(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) console.warn('  WARN: ' + w);
  }

  if (errors.length) {
    console.error(`\nFAILED — ${errors.length} verification error(s):`);
    for (const e of errors) console.error('  ' + e);
    process.exit(1);
  }

  if (warnings.length) console.log(`\nPASSED with ${warnings.length} warning(s) — all 6 gates satisfied (coverage warnings are non-blocking in Phase 1).`);
  else console.log('\nPASSED — all questions match the KJV lockbox and all 6 gates satisfied.');
  process.exit(0);
}

main();
