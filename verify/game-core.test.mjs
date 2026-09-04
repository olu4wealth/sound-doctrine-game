#!/usr/bin/env node
// verify/game-core.test.mjs — headless tests for the pure engine.
// Run: node verify/game-core.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mulberry32, hashCode, dailySeed, dailyCharge, resolveAnswer, nearMiss,
  pickNextLadder, applyDailyVisit, buildChargeReport, compositeScore,
  sortLeaderboard, shareGrid, tierOf, MAX_STREAK, DAILY_LENGTH,
  timeForTier, bonusTime, MAX_HEARTS,
} from '../game-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadBank() {
  // D2: the game loads the canonical merged bank — tests must verify the same data.
  // (The legacy questions.json + questions-t47.json pair contains 26 duplicate ids,
  // which made the 'no immediate repeat' check flaky.)
  return JSON.parse(readFileSync(join(root, 'data', 'questions-merged.json'), 'utf8'));
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('\n— game-core tests —\n');

// 1. Determinism
const bank = loadBank();
const d1 = dailyCharge(bank, new Date('2026-01-15'), mulberry32(hashCode('2026-01-15')));
const d2 = dailyCharge(bank, new Date('2026-01-15'), mulberry32(hashCode('2026-01-15')));
check('daily seed deterministic (same day → same list)', JSON.stringify(d1.map((q) => q.id)) === JSON.stringify(d2.map((q) => q.id)));
check(`daily list length ${DAILY_LENGTH}`, d1.length === DAILY_LENGTH);
const d3 = dailyCharge(bank, new Date('2026-01-16'), mulberry32(hashCode('2026-01-16')));
check('daily seed differs across days', JSON.stringify(d1.map((q) => q.id)) !== JSON.stringify(d3.map((q) => q.id)));
const books = new Set(d1.map((q) => q.book));
check('daily covers all 3 books', books.size === 3);
check('daily excludes T7', d1.every((q) => tierOf(q) <= 6));

// 2. resolveAnswer (D3 five-tier stake: ± stake×100, Grace = half)
const q = bank.find((x) => x.id === '1ti-1-15');
check('resolve: correct 1× = base points', resolveAnswer(q, q.correctIndex, { id: 'safe', mult: 1 }).points === 100);
check('resolve: correct 5× Preach scales', resolveAnswer(q, q.correctIndex, { id: 'preach', mult: 5 }).points === 500);
const wrongIdx = [0,1,2,3].find((i) => i !== q.correctIndex);
check('resolve: clean wrong 1× = −100', resolveAnswer(q, wrongIdx, { id: 'safe', mult: 1 }).points === -100);
check('resolve: clean wrong 3× = −300', resolveAnswer(q, wrongIdx, { id: 'confident', mult: 3 }).points === -300);
check('resolve: wrong outcome labeled', resolveAnswer(q, wrongIdx, { id: 'safe', mult: 1 }).outcome === 'wrong');

// near-miss detection: explicitly authored close distractor
const q2 = bank.find((x) => x.id === '1ti-3-6');
const optIdx = [0,1,2,3].find((i) => i !== q2.correctIndex && nearMiss(q2, i));
check('near-miss found for 1ti-3-6 (close distractor)', optIdx !== undefined);
if (optIdx !== undefined) {
  const r = resolveAnswer(q2, optIdx, { id: 'certain', mult: 4 });
  check('near-miss 4× = grace +200 (half)', r.outcome === 'near-miss' && r.points === 200);
}

// 3. pickNextLadder
const model = { entryTier: 2, weakSubjects: new Set(['money']), seen: new Set() };
bank.forEach((q) => { q._usedThisRun = false; });
const p1 = pickNextLadder(bank, model);
const p2 = pickNextLadder(bank, model);
check('adaptive picker returns questions', !!p1 && !!p2);
check('no immediate repeat', p1.id !== p2.id);
check('picker respects entry tier band', tierOf(p1) >= 1 && tierOf(p1) <= 3);

// weak-subject preference: reset and check a weak subject surfaces early
bank.forEach((q) => { q._usedThisRun = false; });
const weakModel = { entryTier: 1, weakSubjects: new Set(['money']), seen: new Set() };
let foundWeak = false;
for (let i = 0; i < 5; i++) {
  const qq = pickNextLadder(bank, weakModel);
  if (qq.subject === 'money') { foundWeak = true; break; }
}
check('weak subject surfaces early', foundWeak);

// 4. Streak / candle
const start = { streak: 3, lastChargeDay: '2026-01-10', oilVials: 0, totalDays: 10 };
const v1 = applyDailyVisit(start, '2026-01-11');
check('streak +1 on consecutive day', v1.streak === 4);
const v2 = applyDailyVisit({ ...start, streak: 3 }, '2026-01-20');
check('streak ramps DOWN on long gap (never cliff: -1)', v2.streak === 2);
const v3 = applyDailyVisit({ ...start, streak: 3, oilVials: 1 }, '2026-01-20');
check('oil vial spent preserves streak', v3.streak === 3 && v3.oilVials === 0);
const v4 = applyDailyVisit({ ...start, streak: MAX_STREAK }, '2026-01-11');
check('streak capped at 7', v4.streak === MAX_STREAK);
const v5 = applyDailyVisit({ streak: 0, lastChargeDay: '2026-01-10', oilVials: 0, totalDays: 0 }, '2026-01-15');
check('streak never below 0', v5.streak === 0);

// 5. Charge report — use real bank questions so refs populate.
const bankById = (id) => bank.find((q) => q.id === id);
const fakeSession = {
  questions: [
    bankById('1ti-6-10'),  // money — correct
    bankById('1ti-6-6'),   // money — correct
    bankById('tit-1-5'),   // elders — wrong
    bankById('tit-1-9'),   // elders — wrong
  ].map((q) => ({ ...q, _correct: q.id.startsWith('1ti-6') })),
  pot: 200,
};
const rep = buildChargeReport(fakeSession, bank);
check('report computes accuracy', rep.acc === 0.5);
check('report finds strengths (Riches & contentment high)', rep.strengths.some((s) => s.name === 'Riches & contentment'));
check('report finds weaknesses (Elders & widows low)', rep.weaknesses.some((w) => w.name === 'Elders & widows'));
check('report writes prescriptions with refs', rep.prescriptions.some((p) => p.refs.length > 0));
// Chapters to revisit should NOT include chapters the player got 100% on.
check('report omits perfected chapters from revisit', !rep.chapters.some((c) => c.acc === 1));

// 6. Composite + leaderboard sort
const a = { totalCorrect: 8, totalAnswered: 10, streak: 2, bestTimeMs: 120000, fails: 2 };
const b = { totalCorrect: 9, totalAnswered: 10, streak: 1, bestTimeMs: 300000, fails: 1 };
const ca = compositeScore(a), cb = compositeScore(b);
check('composite score computed for both', ca.score > 0 && cb.score > 0);
const sorted = sortLeaderboard([b, a]);
check('leaderboard sorts by composite score desc', compositeScore(sorted[0]).score >= compositeScore(sorted[1]).score);

// 7. Share grid
const grid = shareGrid(['correct','correct','near-miss','wrong','correct','correct','correct','correct','correct','correct']);
check('share grid 10 cells', grid.split('\n').length === 2);
check('share grid uses ⩝⩞⩟', grid.includes('⩝') && grid.includes('⩟'));

// 8. Tier metadata
check('row of tiers present', [1,2,3,4,5,6,7].every((t) => bank.some((q) => tierOf(q) === t)));

// 9. Countdown timer model (tier-scaled time + bonus time)
check('timeForTier is tier-scaled (harder = less time)', timeForTier(1) > timeForTier(7));
check('timeForTier clamps to valid range', timeForTier(99) === timeForTier(7));
check('bonusTime: correct > grace > wrong', bonusTime('correct') > bonusTime('near-miss') && bonusTime('near-miss') > bonusTime('wrong'));
check('bonusTime: timeout = 0', bonusTime('timeout') === 0);
check('bonusTime: wrong = 0', bonusTime('wrong') === 0);
check('MAX_HEARTS defined (kind hearts)', Number.isInteger(MAX_HEARTS) && MAX_HEARTS >= 3);
console.log(`\n— ${passed} passed, ${failed} failed —\n`);
process.exit(failed ? 1 : 0);