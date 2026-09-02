#!/usr/bin/env node
// verify/check.mjs — machine verification of the question bank against the
// Scripture lockbox. Run:  node verify/check.mjs
// Exits 0 when every question is valid; 1 (with a report) otherwise.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ALLOWED_BOOKS = new Set(['1 Timothy', '2 Timothy', 'Titus']);

// Load the lockbox: book -> chapter -> verse -> text
function loadLockbox() {
  const files = ['kjv-1timothy.json', 'kjv-2timothy.json', 'kjv-titus.json'];
  const lockbox = {};
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
    if (!ALLOWED_BOOKS.has(raw.book)) {
      throw new Error(`Lockbox file ${f} declares unexpected book "${raw.book}"`);
    }
    lockbox[raw.book] = {};
    for (const ch of raw.chapters) {
      lockbox[raw.book][ch.chapter] = {};
      for (const v of ch.verses) {
        lockbox[raw.book][ch.chapter][v.verse] = v.text;
      }
    }
  }
  return lockbox;
}

// Parse "1 Timothy 1:15" or "1 Timothy 1:15-16" style references.
function parsePassage(passage) {
  const m = /^(1 Timothy|2 Timothy|Titus)\s+(\d+):(\d+)(?:-(\d+))?$/.exec(passage.trim());
  if (!m) return null;
  return {
    book: m[1],
    chapter: parseInt(m[2], 10),
    verseStart: parseInt(m[3], 10),
    verseEnd: m[4] ? parseInt(m[4], 10) : parseInt(m[3], 10),
  };
}

function getPassageText(lockbox, ref) {
  const ch = lockbox[ref.book]?.[ref.chapter];
  if (!ch) return null;
  let text = '';
  for (let v = ref.verseStart; v <= ref.verseEnd; v++) {
    const verse = ch[v];
    if (verse === undefined) return null;
    text += (text ? ' ' : '') + verse;
  }
  return text;
}

function main() {
  const lockbox = loadLockbox();
  const banks = ['questions.json', 'questions-t47.json'];
  const questions = [];
  for (const f of banks) {
    const raw = JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
    questions.push(...raw);
  }
  console.log(`Bank files: ${banks.join(', ')}`);

  const errors = [];
  const seenIds = new Set();
  let warnCount = 0;
  const ALLOWED_TYPES = new Set([
    'completion', 'recall', 'number', 'reference', 'discern', 'sequence', 'crossref', 'synthesis',
  ]);

  if (!Array.isArray(questions) || questions.length === 0) {
    console.error('question banks are empty or not arrays');
    process.exit(1);
  }

  questions.forEach((q, i) => {
    const label = q.id || `[index ${i}]`;

    if (!q.id || seenIds.has(q.id)) {
      errors.push(`${label}: missing or duplicate id`);
    } else {
      seenIds.add(q.id);
    }

    if (!ALLOWED_BOOKS.has(q.book)) {
      errors.push(`${label}: book "${q.book}" is outside the allowed books`);
    }

    if (q.tier === undefined) {
      warnCount++;
      console.warn(`WARN ${label}: no tier; defaults to legacy difficulty mapping`);
    } else if (!(q.tier >= 1 && q.tier <= 7)) {
      errors.push(`${label}: tier ${q.tier} must be 1-7`);
    }

    if (q.type && !ALLOWED_TYPES.has(q.type)) {
      errors.push(`${label}: unknown type "${q.type}"`);
    }

    if (!Array.isArray(q.options) || q.options.length !== 4) {
      errors.push(`${label}: must have exactly 4 options`);
    }

    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) {
      errors.push(`${label}: correctIndex must be an integer 0-3`);
    }

    // Verses to verify: single passage/verseText + optional passageB/verseTextB + verses[].
    const versesToCheck = [];
    if (q.passage && q.verseText) {
      versesToCheck.push({ passage: q.passage, verseText: q.verseText });
    }
    if (q.passageB && q.verseTextB) {
      versesToCheck.push({ passage: q.passageB, verseText: q.verseTextB });
    }
    if (Array.isArray(q.verses)) {
      for (const v of q.verses) {
        versesToCheck.push({ passage: v.passage, verseText: v.verseText });
      }
    }
    if (!versesToCheck.length) {
      errors.push(`${label}: no passage/verseText to verify`);
      return;
    }

    for (const item of versesToCheck) {
      const ref = parsePassage(item.passage);
      if (!ref) {
        errors.push(`${label}: passage "${item.passage}" could not be parsed`);
        continue;
      }
      if (!ALLOWED_BOOKS.has(ref.book)) {
        errors.push(`${label}: passage "${item.passage}" references a book outside scope`);
      }
      const expected = getPassageText(lockbox, ref);
      if (expected === null) {
        errors.push(`${label}: passage "${item.passage}" does not resolve to a known verse`);
        continue;
      }

      // Normalize both for comparison (strip trailing/leading whitespace only —
      // we do NOT normalize apostrophes/punctuation, so transcription is exact).
      const a = expected.trim();
      const b = item.verseText.trim();
      if (a !== b) {
        errors.push(`${label}: verseText does not match KJV for ${item.passage}`);
        errors.push(`    expected: ${a}`);
        errors.push(`    actual:   ${b}`);
      }
    }

    if (q.difficulty && !(q.difficulty >= 1 && q.difficulty <= 3)) {
      warnCount++;
      console.warn(`WARN ${label}: difficulty ${q.difficulty} outside 1-3`);
    }
  });

  // Coverage report: are all three books represented?
  const books = new Set(questions.map((q) => q.book));
  console.log(`Questions: ${questions.length}`);
  console.log(`Books covered: ${[...books].join(', ')}`);
  for (const b of ALLOWED_BOOKS) {
    if (!books.has(b)) {
      console.warn(`WARN: no questions for "${b}"`);
    }
  }

  if (errors.length) {
    console.error('\nFAILED — verification errors:');
    for (const e of errors) console.error('  ' + e);
    process.exit(1);
  }

  console.log('\nPASSED — all questions match the KJV lockbox.');
  process.exit(0);
}

main();
