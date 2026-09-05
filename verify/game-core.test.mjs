#!/usr/bin/env node
// verify/game-core.test.mjs — headless tests for the pure engine.
// Run: node verify/game-core.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mulberry32, hashCode, dailySeed, dailyCharge, resolveAnswer, nearMiss,
  pickNextLadder, applyDailyVisit, buildChargeReport, leaderboardScore,
  runBankedPoints, rankOf, rankProgress, retestRun, masterySummary,
  chapterMastery, msUntilDailyReset, formatCountdown, timeForQuestion,
  readingSeconds, STREAK_MILESTONE, LADDER_LENGTH, RANK_MIN_ANSWERED,
  sortLeaderboard, shareGrid, tierOf, MAX_STREAK, DAILY_LENGTH,
  timeForTier, bonusTime, MAX_HEARTS, candleMeltFraction, CANDLE_MORNING_HOUR,
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
check('streak respects the sanity bound', v4.streak === MAX_STREAK);
const v4b = applyDailyVisit({ ...start, streak: STREAK_MILESTONE }, '2026-01-11');
check('streak grows PAST the old 7-day ceiling', v4b.streak === STREAK_MILESTONE + 1);
const v4c = applyDailyVisit({ ...start, streak: 3, lastChargeDay: '2026-01-11' }, '2026-01-11');
check('same-day visit flags alreadyDone for the caller', v4c.alreadyDone === true);
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

// 6. Leaderboard score — must never punish playing more
const a = { totalCorrect: 80, totalAnswered: 100, streak: 2, lifetimePot: 24000, fails: 20 };
const b = { totalCorrect: 90, totalAnswered: 100, streak: 1, lifetimePot: 31000, fails: 10 };
check('leaderboard score computed for both', leaderboardScore(a).score > 0 && leaderboardScore(b).score > 0);
const sorted = sortLeaderboard([a, b]);
check('leaderboard sorts by banked pot desc', leaderboardScore(sorted[0]).score >= leaderboardScore(sorted[1]).score);

// The old model subtracted lifetime `fails`, so a steady player's score fell every
// session. Banked points can only ever go up.
let grinding = { totalCorrect: 0, totalAnswered: 0, lifetimePot: 0, streak: 3 };
let prevScore = -1, everFell = false;
for (let run = 0; run < 40; run++) {
  grinding.totalAnswered += 10;
  grinding.totalCorrect += 7;                       // a steady, unspectacular 70%
  grinding.lifetimePot += runBankedPoints({ pot: 900 }, grinding.streak);
  const sc = leaderboardScore(grinding).score;
  if (sc < prevScore) everFell = true;
  prevScore = sc;
}
check('playing more NEVER lowers your score', !everFell);
check('a bad run banks zero, not a negative', runBankedPoints({ pot: -800 }, 3) === 0);

// The old composite rewarded a low best-time, so 2 questions then quit beat 200 at 90%.
const quitter = { totalCorrect: 2, totalAnswered: 2, lifetimePot: 600, streak: 1 };
const scholar = { totalCorrect: 180, totalAnswered: 200, lifetimePot: 48000, streak: 7 };
check('a 2-question quitter cannot outrank a real player',
  sortLeaderboard([quitter, scholar])[0] === scholar);
check('low-volume players are flagged provisional',
  leaderboardScore(quitter).provisional === true && leaderboardScore(scholar).provisional === false);

// 6b. Rank ladder is paced off the banked pot, not `totalCorrect × 100`
check('rank starts at Recruit', rankOf(0) === 'Recruit');
check('rank is NOT maxed by 60 correct answers', rankOf(60 * 100) !== rankOf(600000));
check('rank ladder has a long tail', rankOf(600000) === 'Teacher of Sound Doctrine');
const rp = rankProgress(3000);
check('rank progress reports the next title', rp.next && rp.pct > 0 && rp.pct < 1);
check('rank progress saturates at the top', rankProgress(9e9).pct === 1 && rankProgress(9e9).next === null);

// 6c. Retest — replays what the player actually missed
const fakeReport = {
  missedVerses: [{ id: 'tit-1-5' }, { id: 'tit-1-9' }],
  weaknesses: [{ name: 'elders' }],
  chapters: [{ name: 'Titus 1' }],
};
const rt = retestRun(bank, fakeReport, LADDER_LENGTH);
check('retest is a full-length run', rt.length === LADDER_LENGTH);
check('retest leads with the missed questions',
  rt.slice(0, 2).every((q) => ['tit-1-5', 'tit-1-9'].includes(q.id)));
check('retest never repeats a question', new Set(rt.map((q) => q.id)).size === rt.length);
check('retest still fills when nothing was missed',
  retestRun(bank, { missedVerses: [], weaknesses: [], chapters: [] }, LADDER_LENGTH).length === LADDER_LENGTH);

// 6d. Lifetime mastery — reads data storage.js already kept but nothing displayed
const ms = masterySummary({ '1 Timothy 1': { asked: 5, correct: 5 }, 'Titus 2': { asked: 4, correct: 1 } });
check('mastery covers all 13 canonical chapters', ms.total === 13);
check('mastery counts a strong chapter as mastered', ms.mastered === 1);
check('mastery counts started chapters', ms.started === 2);
check('mastery ignores a thin sample',
  masterySummary({ '1 Timothy 1': { asked: 1, correct: 1 } }).mastered === 0);
check('mastery lists untouched chapters as not started',
  chapterMastery({}).every((r) => !r.started && !r.mastered));

// 6e. Daily reset countdown
const beforeMidnightUTC = new Date(Date.UTC(2026, 0, 10, 23, 0, 0));
check('daily reset is under an hour at 23:00 UTC',
  msUntilDailyReset(beforeMidnightUTC) === 60 * 60 * 1000);
check('daily reset is a full day just after rollover',
  msUntilDailyReset(new Date(Date.UTC(2026, 0, 10, 0, 0, 0))) === 24 * 60 * 60 * 1000);
check('countdown formats hours', formatCountdown(2 * 3600 * 1000 + 5 * 60000) === '2h 05m');
check('countdown formats minutes near the end', formatCountdown(90 * 1000) === '1m 30s');

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

// 9b. Per-question clock — the hardest content used to be an automatic timeout
const longT7 = bank.filter((q) => tierOf(q) === 7)
  .sort((x, y) => readingSeconds(y) - readingSeconds(x))[0];
check('a long T7 question gets more time than its bare reading time',
  timeForQuestion(longT7, 1) > readingSeconds(longT7));
check('the old 10s floor no longer applies to long questions',
  timeForQuestion(longT7, 1) > 10);
const shortQ = bank.filter((q) => tierOf(q) === 1)
  .sort((x, y) => readingSeconds(x) - readingSeconds(y))[0];
check('a short question gets less time than a long one',
  timeForQuestion(shortQ, 0) < timeForQuestion(longT7, 0));
check('ramping a run compresses thinking time but never below the floor',
  timeForQuestion(longT7, 1) <= timeForQuestion(longT7, 0) && timeForQuestion(shortQ, 1) >= 14);
check('MAX_HEARTS defined (kind hearts)', Number.isInteger(MAX_HEARTS) && MAX_HEARTS >= 3);

// 10. Candle melt — driven by the browser clock, fresh at dawn, spent by next dawn.
const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
check('CANDLE_MORNING_HOUR is 6 (fresh candle at dawn)', CANDLE_MORNING_HOUR === 6);
check('melt is 0 exactly at dawn (new candle)', candleMeltFraction(at(6)) === 0);
check('melt is nearly spent right before the next dawn', candleMeltFraction(at(5, 59)) > 0.99);
check('melt is monotonic from dawn to next dawn',
  candleMeltFraction(at(7)) <= candleMeltFraction(at(12)) &&
  candleMeltFraction(at(12)) <= candleMeltFraction(at(18)) &&
  candleMeltFraction(at(18)) <= candleMeltFraction(at(23)));
check('melt burns much faster into the night than at midday',
  candleMeltFraction(at(23)) > candleMeltFraction(at(12)) * 3);
check('melt stays in [0,1] across the whole day',
  Array.from({ length: 24 }, (_, h) => candleMeltFraction(at(h))).every((v) => v >= 0 && v <= 1));

console.log(`\n— ${passed} passed, ${failed} failed —\n`);
process.exit(failed ? 1 : 0);