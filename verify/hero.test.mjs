#!/usr/bin/env node
// verify/hero.test.mjs — headless tests for the Choose Your Hero engine + data.
// Run: node verify/hero.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mulberry32, hashCode, heroRun, tierOf, HEROES, HERO_LENGTH,
} from '../game-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const bank = JSON.parse(readFileSync(join(root, 'data', 'questions-merged.json'), 'utf8'));
const heroBank = JSON.parse(readFileSync(join(root, 'data', 'heroes.json'), 'utf8'));

const lockbox = {};
for (const [book, file] of Object.entries({
  '1 Timothy': 'kjv-1timothy.json',
  '2 Timothy': 'kjv-2timothy.json',
  Titus: 'kjv-titus.json',
})) {
  const raw = JSON.parse(readFileSync(join(root, 'data', file), 'utf8'));
  lockbox[book] = {};
  for (const ch of raw.chapters) {
    lockbox[book][ch.chapter] = {};
    for (const v of ch.verses) lockbox[book][ch.chapter][v.verse] = v.text;
  }
}
const verseOf = (book, chapter, verse) => lockbox[book]?.[chapter]?.[verse];
const corpus = Object.values({
  '1 Timothy': 'kjv-1timothy.json', '2 Timothy': 'kjv-2timothy.json', Titus: 'kjv-titus.json',
}).map((f) => readFileSync(join(root, 'data', f), 'utf8')).join('\n');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('\n— hero mode tests —\n');

// 1. Data shape
check('heroes.json non-empty', heroBank.length > 0);
const ids = heroBank.map((q) => q.id);
check('hero ids unique', new Set(ids).size === ids.length);
check('both heroes covered', ['timothy', 'titus'].every((h) => heroBank.some((q) => q.hero === h)));
check('all three types covered', ['truefalse', 'wordorder', 'whodid'].every((t) => heroBank.some((q) => q.type === t)));

// 2. Scripture verbatim: verseText must match the KJV lockbox exactly
const refOk = heroBank.every((q) => {
  const m = /^(1 Timothy|2 Timothy|Titus) (\d+):(\d+)$/.exec(q.passage || '');
  if (!m) return false;
  return verseOf(m[1], Number(m[2]), Number(m[3])) === q.verseText;
});
check('every hero verseText matches the KJV lockbox verbatim', refOk);
check('every hero question carries book + chapter (mastery map)', heroBank.every((q) => q.book && Number.isInteger(q.chapter)));
check('tier within 1..7', heroBank.every((q) => tierOf(q) >= 1 && tierOf(q) <= 7));

// 3. Typed-question invariants
check('true/false: exactly 2 options', heroBank.filter((q) => q.type === 'truefalse').every((q) => q.options.length === 2 && (q.correctIndex === 0 || q.correctIndex === 1)));
check('who-did-this: exactly 4 distinct options', heroBank.filter((q) => q.type === 'whodid').every((q) => new Set(q.options).size === 4 && q.correctIndex >= 0 && q.correctIndex < 4));
check('word-order: 6-18 words', heroBank.filter((q) => q.type === 'wordorder').every((q) => q.words.length >= 6 && q.words.length <= 18));

// 4. Scripture accuracy by type
check('word-order words join to a verbatim substring of the verse',
  heroBank.filter((q) => q.type === 'wordorder').every((q) => q.verseText.includes(q.words.join(' '))));
check('TRUE statements are verbatim in their verse',
  heroBank.filter((q) => q.type === 'truefalse' && q.correctIndex === 0).every((q) => q.verseText.includes(/\u201C(.+)\u201D/.exec(q.prompt)[1])));
check('FALSE statements appear nowhere in the three books',
  heroBank.filter((q) => q.type === 'truefalse' && q.correctIndex === 1).every((q) => !corpus.includes(/\u201C(.+)\u201D/.exec(q.prompt)[1])));

// 5. heroRun: determinism, shape, book purity, mixture
for (const heroId of Object.keys(HEROES)) {
  const day = '2026-01-15';
  const a = heroRun(bank, heroBank, heroId, day, mulberry32(hashCode(`hero:${day}:${heroId}`)));
  const b = heroRun(bank, heroBank, heroId, day, mulberry32(hashCode(`hero:${day}:${heroId}`)));
  check(`${heroId}: run deterministic (same day → same list)`, JSON.stringify(a.map((q) => q.id)) === JSON.stringify(b.map((q) => q.id)));
  check(`${heroId}: run length ${HERO_LENGTH}`, a.length === HERO_LENGTH);
  const hero = HEROES[heroId];
  check(`${heroId}: every question stays inside his book(s)`, a.every((q) => hero.books.includes(q.book)));
  check(`${heroId}: typed questions tagged with the right hero`, a.filter((q) => q.hero).every((q) => q.hero === heroId));
  const byType = (t) => a.filter((q) => q.type === t).length;
  check(`${heroId}: 3 true/false + 3 word-order + 2 who-did-this + 2 book MCQs`,
    byType('truefalse') === 3 && byType('wordorder') === 3 && byType('whodid') === 2 && a.filter((q) => !q.hero).length === 2);
  check(`${heroId}: no repeated question in a run`, new Set(a.map((q) => q.id)).size === HERO_LENGTH);
  check(`${heroId}: MCQ fill is T5 or below`, a.filter((q) => !q.hero).every((q) => tierOf(q) <= 5));
  check(`${heroId}: every question teaches the verse (passage + verseText)`, a.every((q) => q.passage && q.verseText));
  const c = heroRun(bank, heroBank, heroId, '2026-01-16', mulberry32(hashCode(`hero:2026-01-16:${heroId}`)));
  check(`${heroId}: a new day brings a different run`, JSON.stringify(a.map((q) => q.id)) !== JSON.stringify(c.map((q) => q.id)));
}
check('unknown hero id yields an empty run', heroRun(bank, heroBank, 'solomon', '2026-01-15').length === 0);

console.log(`\n— ${passed} passed, ${failed} failed —\n`);
if (failed > 0) process.exit(1);
