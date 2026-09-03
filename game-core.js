// game-core.js — pure engine for Sound Doctrine.
// Deterministic at play time: questions come from the pre-verified bank; no model is
// called while playing. Exported functions are pure (no DOM, no storage) so they can
// be unit-tested headlessly (verify/game-core.test.mjs).

// ---------- Constants ----------
export const TIER_NAMES = [
  null,               // tier 0 unused
  'Recall',           // T1
  'Recall · Multi',   // T2
  'Reference',        // T3
  'Discern',          // T4
  'Sequence',         // T5
  'Cross-reference',  // T6
  'Synthesis',        // T7 — extremely hard
];
export const TIER_EMOJI = [null, '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

export const BIDS = [
  { id: 'safe',      label: 'Safe',       mult: 1 },
  { id: 'cautious',  label: 'Cautious',   mult: 2 },
  { id: 'confident', label: 'Confident',  mult: 3 },
  { id: 'certain',   label: 'Certain',    mult: 4 },
  { id: 'preach',    label: 'Preach It',  mult: 5 },
];

export const BASE_POINTS = 100; // per correct question at 1× bid
export const MAX_STREAK = 7;    // candle cap
export const DAILY_LENGTH = 10; // Daily Office questions per day
export const MAX_HEARTS = 5;    // lives (kind hearts) — refilled gently, never a paywall

// Per-question countdown (seconds) — tighter on harder rungs (Duolingo-style pressure).
export const TIER_TIME = [null, 30, 26, 22, 20, 18, 16, 15];
export const TIME_BONUS = { correct: 5, 'near-miss': 2, wrong: 0, timeout: 0 };

export function timeForTier(tier) {
  return TIER_TIME[Math.min(7, Math.max(1, tier))] ?? TIER_TIME[1];
}
export function bonusTime(outcome) {
  return TIME_BONUS[outcome] ?? 0;
}

export const GRADE_TABLE = [
  { min: 0.90, label: 'S+', title: 'Teacher of Sound Doctrine' },
  { min: 0.80, label: 'A',  title: 'Workman Unashamed' },
  { min: 0.65, label: 'B',  title: 'Rightly Dividing' },
  { min: 0.50, label: 'C',  title: 'A Good Soldier' },
  { min: 0.00, label: 'D',  title: 'Child in the Faith' },
];

// ---------- Utility ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const STOP = new Set(['the','a','an','of','to','in','for','and','or','but','that','this',
  'with','by','as','be','is','are','was','were','thou','thee','thy','thine','ye','you',
  'it','he','she','they','them','his','her','their','from','at','on','not','no','shall',
  'will','may','might','i','we','us','our','who','whom','which','what','unto','upon',
  'hath','have','had','do','did','doth','there','here','all','also','even','them','its',
  'if','then','so','when','where','why','how','man','men','god','christ','jesus','lord']);

export function significantWords(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

// Near-miss heuristic: chosen option shares ≥2 significant words with the correct option.
// Near-miss: explicitly authored "close distractor" option indices. When present,
// picking one of these on a wrong answer counts as a Grace (half the pot survives).
// This is deliberate design data, not a word-overlap guess.
export function nearMiss(q, chosenOrigIdx) {
  return Array.isArray(q.nearIndexes) && q.nearIndexes.includes(chosenOrigIdx);
}

// Resolve an answer. chosenOrigIdx is the *original* option index the player picked
// (i.e., after un-shuffling display order). Returns outcome, pot delta, points.
// Scoring is flat (no confidence bid): correct = BASE_POINTS, grace = half.
// The `bid` arg is accepted for backward-compat but ignored.
export function resolveAnswer(q, chosenOrigIdx, bid) {
  const correct = chosenOrigIdx === q.correctIndex;
  const grace = !correct && nearMiss(q, chosenOrigIdx);
  const mult = 1; // flat scoring — confidence bids removed

  let pot = 0;
  let points = 0;
  if (correct) {
    points = BASE_POINTS * mult;
    pot = points;
  } else if (grace) {
    points = Math.round(BASE_POINTS * mult * 0.5);
    pot = points;
  }
  return { outcome: correct ? 'correct' : grace ? 'near-miss' : 'wrong', points, pot, mult };
}

// ---------- Tier helpers ----------
export function tierOf(q) {
  return q.tier || (q.type === 'completion' ? 1 : q.type === 'number' ? 2 : 1 + (q.difficulty || 1));
}

// ---------- Deterministic daily seed ----------
export function dailySeed(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Daily Office: 10 deterministic questions, balanced across books and tiers.
// Guarantees ≥2 per book (leaves 1 wildcard) and excludes T7 from the shared daily
// (T7 stays a personal Ladder extreme), but includes one T6 stretch.
export function dailyCharge(bank, date, rng = mulberry32(hashCode(dailySeed(date)))) {
  const byTier = (t) => bank.filter((q) => tierOf(q) === t);
  const pick = (pool) => shuffle(rng, pool);
  const chosen = [];

  // 3 books × 2 easy/medium (T1-T3) = 6
  const books = ['1 Timothy', '2 Timothy', 'Titus'];
  for (const b of books) {
    const pool = bank.filter((q) => q.book === b && tierOf(q) >= 1 && tierOf(q) <= 3);
    chosen.push(...pick(pool).slice(0, 2));
  }
  // 2 medium/hard (T3-T4)
  const mh = bank.filter((q) => tierOf(q) >= 3 && tierOf(q) <= 4);
  chosen.push(...pick(mh).slice(0, 2));
  // 1 T5 sequence
  const t5 = byTier(5);
  chosen.push(...(pick(t5).length ? pick(t5).slice(0, 1) : []));
  // 1 T6 crossref
  const t6 = byTier(6);
  chosen.push(...(pick(t6).length ? pick(t6).slice(0, 1) : []));
  // Fill remainder to DAILY_LENGTH with any (excluding T7)
  const fillers = bank.filter((q) => !chosen.some((c) => c.id === q.id) && tierOf(q) <= 6);
  chosen.push(...pick(fillers).slice(0, Math.max(0, DAILY_LENGTH - chosen.length)));

  // Shuffle final order deterministically
  const ordered = pick(chosen).slice(0, DAILY_LENGTH);
  return ordered;
}

// ---------- Adaptive Ladder picker ----------
// model: { entryTier, weakSubjects:Set, seen:Set (ids used), climbCount }
export function pickNextLadder(bank, model) {
  const tier = Math.min(7, Math.max(1, model.entryTier || 1));
  const candidates = bank.filter((q) => {
    const t = tierOf(q);
    if (q._usedThisRun) return false;
    // in-flow band: current tier ±1 (never out of 1..7)
    if (t < Math.max(1, tier - 1) || t > Math.min(7, tier + 1)) return false;
    if (model.seen && model.seen.has(q.id)) return false;
    return true;
  });

  let pool = candidates;
  if (!pool.length) {
    // relax: allow anything unseen; if the whole bank is exhausted, allow reuse after reset
    pool = bank.filter((q) => !q._usedThisRun) || bank;
    if (!pool.length) {
      bank.forEach((q) => { q._usedThisRun = false; });
      pool = bank;
    }
  }

  // Prefer weak subjects (expose gaps): shuffle each group separately, weak first,
  // so the priority ordering survives the shuffle.
  const weak = pool.filter((q) => model.weakSubjects?.has(q.subject));
  const rest = pool.filter((q) => !weak.includes(q));
  const sorted = [...shuffle(Math.random, weak), ...shuffle(Math.random, rest)];
  const q = sorted[0];
  if (q) q._usedThisRun = true;
  return q || null;
}

// ---------- Streak / Candle ----------
// model: { streak (consecutive days, capped), lastChargeDay ("YYYY-MM-DD"),
//         oilVials, totalDays }
export function applyDailyVisit(model, todayStr) {
  const next = { ...model };
  const today = todayStr || dailySeed(new Date());
  if (next.lastChargeDay === today) {
    return { ...next, alreadyDone: true }; // don't double-count
  }

  if (!next.lastChargeDay) {
    next.streak = 1;
  } else {
    const last = new Date(next.lastChargeDay + 'T00:00:00Z');
    const now = new Date(today + 'T00:00:00Z');
    const days = Math.round((now - last) / 86400000);
    if (days === 1) {
      next.streak = Math.min(MAX_STREAK, (next.streak || 0) + 1);
    } else if (days > 1) {
      // Gutter (gentle ramp-down), never a cliff:
      // lose one day per missed day, min 0; if oil vial available, spend it to keep the flame.
      if ((next.oilVials || 0) > 0) {
        next.oilVials -= 1;
        // streak unchanged (shield consumed)
      } else {
        next.streak = Math.max(0, (next.streak || 0) - 1);
      }
    }
  }
  next.lastChargeDay = today;
  next.totalDays = (next.totalDays || 0) + 1;
  delete next.alreadyDone;
  return next;
}

// ---------- Charge Report ----------
export function gradeFor(acc) {
  for (const g of GRADE_TABLE) if (acc >= g.min) return g;
  return GRADE_TABLE[GRADE_TABLE.length - 1];
}

// session: { questions: [...answered], correct: n, answered: n, pot, bestTimeMs }
// ---------- Thematic categories ----------
// The raw subject tags are uneven ("spirit", "holy ghost", "avoid"). For the Charge
// Report we group them into clean, meaningful doctrinal categories so strengths
// and weaknesses read naturally (e.g. "Paul's perseverance", "Christian living").
const CATEGORY_MAP = {
  // Doctrine & faith
  'sound doctrine': 'Sound doctrine', 'doctrine': 'Sound doctrine', 'faithful sayings': 'Faithful sayings',
  'faith': 'Faith & grace', 'grace': 'Faith & grace', 'grace teaching': 'Faith & grace', 'justification': 'Faith & grace',
  'salvation': 'Salvation', 'mystery of godliness': 'The mystery of godliness', 'blessed hope': 'The blessed hope',
  'mediator': 'Christ the mediator', 'the mediator': 'Christ the mediator', 'deity': 'Christ the mediator',
  'resurrection': 'The resurrection', 'the gift of God': 'The gift of God', 'the gift': 'The gift of God',
  // Christian living
  'godliness': 'Godliness', 'contentment': 'Contentment', 'good works': 'Good works', 'purity': 'Purity',
  'modesty': 'Modesty & conduct', 'youthful lusts': 'Fleeing youthful lusts', 'good fight': 'The good fight',
  'faith and conscience': 'Faith & a good conscience', 'sound in faith': 'Sound in the faith', 'great gain': 'True contentment',
  'brotherly conduct': 'Christian conduct', 'mercy on Onesiphorus': 'Faithful companions', 'household': 'Christian conduct',
  'older women\'s charge': 'Christian conduct', 'redeemed people': 'Redeemed people', 'empty profession': 'Sincere faith',
  'form of godliness': 'Sincere faith', 'avoid': 'Avoiding error', 'hereticks': 'Avoiding error', 'vessels': 'Vessels of honour',
  'the great house': 'Vessels of honour', 'purged vessel': 'Vessels of honour', 'faithfulness of God': 'Faithfulness of God',
  'keeping the faith': 'Perseverance', 'perseverance': 'Perseverance', 'guarding the trust': 'The deposit',
  'the deposit': 'The deposit', 'sound words': 'Sound words',
  // Church order & ministry
  'bishop qualifications': 'Bishops & deacons', 'deacon qualifications': 'Bishops & deacons',
  'church order': 'Church order', 'elders': 'Elders & widows', 'ruling elders': 'Elders & widows',
  'widows': 'Elders & widows', 'the office of bishop': 'Bishops & deacons', 'qualities of a bishop': 'Bishops & deacons',
  'the church': 'Church order', 'authority': 'Church order', 'worship': 'Worship & prayer', 'prayer': 'Worship & prayer',
  // Paul's life & ministry
  'paul\'s testimony': 'Paul\'s testimony', 'Paul\'s past': 'Paul\'s testimony', 'Paul\'s calling': 'Paul\'s calling',
  'pauls calling': 'Paul\'s calling', 'Paul\'s offices': 'Paul\'s apostleship', 'paul\'s perseverance': 'Paul\'s perseverance',
  'persecution': 'Paul\'s perseverance', 'soldier metaphors': 'Paul\'s perseverance', 'the gift': 'Paul\'s perseverance',
  'paul\'s longing': 'Paul\'s perseverance', 'pattern': 'Paul\'s perseverance', 'example': 'Paul\'s perseverance',
  'man of god': 'Man of God', 'preaching': 'Paul\'s preaching', 'opposition': 'Paul\'s perseverance',
  'shipwreck': 'Paul\'s perseverance', 'personal requests': 'Paul\'s final words', 'personal notes': 'Paul\'s final words',
  'closings': 'Paul\'s final words', 'doxology': 'Paul\'s final words', 'greetings': 'Paul\'s final words',
  'travel plans': 'Paul\'s final words', 'Tychicus': 'Paul\'s final words',
  // Scripture & study
  'scripture': 'The Scriptures', 'old testament': 'The Scriptures', 'study': 'Studying Scripture', 'reading': 'Studying Scripture',
  // People & false teaching
  'false teachers': 'False teaching', 'false teaching': 'False teaching', 'treacherous': 'False teaching',
  'comprehension': 'Weakness', 'delivered to Satan': 'Judgment on error', 'confidence': 'Confidence in Christ',
  'cretian proverb': 'The Cretan proverb', 'the rich': 'Riches & contentment', 'money': 'Riches & contentment',
  'laying up treasure': 'Riches & contentment', 'the poor': 'Riches & contentment', 'family duty': 'Family & the home',
  'spirit': 'The Holy Spirit', 'holy ghost': 'The Holy Spirit', 'holy spirit': 'The Holy Spirit', 'pneuma': 'The Holy Spirit',
  'faithfulness': 'Faithfulness', 'timothy\'s family': 'Timothy\'s family', 'calling': 'Calling', 'charge': 'The charge',
  'duty': 'Christian duty',
};

function subjectCategory(subject) {
  return CATEGORY_MAP[subject] || subject;
}

// bank: full bank (used to resolve subjects to passages for the Rx)
export function buildChargeReport(session, bank) {
  const answered = session.questions || [];
  const correct = answered.filter((q) => q._correct).length;
  const total = answered.length;
  const acc = total ? correct / total : 0;
  const grade = gradeFor(acc);
  const pot = session.pot || 0;

  // Category stats (group minor subject tags into clean doctrinal categories)
  const s = {};
  for (const q of answered) {
    const cat = subjectCategory(q.subject);
    s[cat] = s[cat] || { asked: 0, correct: 0, refs: new Set() };
    s[cat].asked++;
    if (q._correct) s[cat].correct++;
    for (const ref of referencesOf(q)) s[cat].refs.add(ref);
  }
  // Book & chapter stats
  const bk = {}, ch = {};
  for (const q of answered) {
    bk[q.book] = bk[q.book] || { asked: 0, correct: 0 };
    const ck = `${q.book} ${q.chapter}`;
    ch[ck] = ch[ck] || { asked: 0, correct: 0 };
    bk[q.book].asked++; ch[ck].asked++;
    if (q._correct) { bk[q.book].correct++; ch[ck].correct++; }
  }

  const toRows = (stats) => Object.entries(stats)
    .map(([k, v]) => ({ key: k, acc: v.asked ? v.correct / v.asked : null, asked: v.asked, refs: v.refs }))
    .filter((r) => r.acc !== null && r.asked >= 1)
    .sort((a, b) => b.acc - a.acc);

  const subjects = toRows(s);
  const books = toRows(bk);
  // Chapters you actually missed on (acc < 1); these are the ones worth revisiting.
  const allChapters = toRows(ch);
  const revisitChapters = allChapters.filter((r) => r.acc < 1);

  const strongest = subjects.filter((r) => r.acc >= 0.5).slice(0, 3);
  const weakest = subjects.filter((r) => r.acc < 0.5).slice(-3).reverse();

  // Study prescription ("how to do better") per weak subject
  const rx = weakest.map((w) => {
    const refs = [...(w.refs || [])].join(', ');
    let instruction;
    if (w.acc === 0) {
      instruction = `Your weakest area was <strong>${w.key}</strong> — start there. Read <em>${refs}</em> and pray through it; the next climb will test it again.`;
    } else if (w.acc < 0.5) {
      instruction = `<strong>${w.key}</strong> is where you stumbled. Re-read <em>${refs}</em> slowly; the doctrine is worth the hour.`;
    } else {
      instruction = `You were close on <strong>${w.key}</strong>. Read <em>${refs}</em> once more — a re-climb should lock it in.`;
    }
    return {
      subject: w.key,
      refs: [...(w.refs || [])],
      instruction,
    };
  });

  // Mastery Map extras (Phase 5): weakest chapter/book + missed verses + per-book mastery
  let weakestChapter = null;
  if (allChapters.length) {
    const sortedWorst = [...allChapters].sort((a, b) => a.acc - b.acc || b.asked - a.asked);
    const wc = sortedWorst[0];
    const missedForChapter = answered.filter((q) => !q._correct && `${q.book} ${q.chapter}` === wc.key);
    weakestChapter = {
      name: wc.key, acc: wc.acc, asked: wc.asked,
      refs: [...(wc.refs || [])],
      verses: missedForChapter.map((q) => ({ passage: referencesOf(q).join(' · '), text: (q.verseText || (Array.isArray(q.verses) ? q.verses.map((v) => v.verseText).join(' ') : '')) })),
    };
  }
  const missedVerses = answered.filter((q) => !q._correct).map((q) => ({
    id: q.id, book: q.book, chapter: q.chapter, subject: q.subject,
    passage: referencesOf(q).join(' · '),
    text: q.verseText || (Array.isArray(q.verses) ? q.verses.map((v) => v.verseText).join(' ') : ''),
  }));
  const mastery = books.map((b) => ({
    name: b.key, acc: b.acc, asked: b.asked,
    chapters: allChapters.filter((c) => c.key.startsWith(b.key + ' ')).map((c) => ({ name: c.key, acc: c.acc, asked: c.asked })),
  }));

  return {
    acc, grade, pot,
    answered: total, correct,
    strengths: strongest.map((r) => ({ name: r.key, acc: r.acc })),
    weaknesses: weakest.map((r) => ({ name: r.key, acc: r.acc })),
    prescriptions: rx,
    books: books.map((r) => ({ name: r.key, acc: r.acc })),
    chapters: revisitChapters.map((r) => ({ name: r.key, acc: r.acc })),
    weakestChapter,
    missedVerses,
    mastery,
  };
}

export function referencesOf(q) {
  const refs = [];
  if (q.passage) refs.push(q.passage);
  if (q.passageB) refs.push(q.passageB);
  if (Array.isArray(q.verses)) for (const v of q.verses) if (v.passage) refs.push(v.passage);
  return refs;
}

// ---------- Composite leaderboard score ----------
// Blend: accuracy × streak-weight × (1 − normalized best-time), fails as tiebreak.
export function compositeScore(p) {
  const acc = p.totalAnswered ? p.totalCorrect / p.totalAnswered : 0;
  const streakW = 1 + 0.1 * Math.min(MAX_STREAK, p.streak || 0);
  const bestMs = p.bestTimeMs || 0;
  const normTime = Math.min(1, bestMs / 600000); // 10 min = full
  const score = Math.round(1000 * acc * streakW * (1 - normTime) * 100) / 100;
  return { score, fails: p.fails || 0 };
}

// Sort leaderboard entries by score desc, fails asc.
export function sortLeaderboard(entries) {
  return [...entries].sort((a, b) => {
    const sa = compositeScore(a), sb = compositeScore(b);
    if (sb.score !== sa.score) return sb.score - sa.score;
    return sa.fails - sb.fails;
  });
}

// ---------- Share card (Daily Office) ----------
export function shareGrid(answers, size = 10) {
  // answers: array of 'correct' | 'near-miss' | 'wrong' (session outcomes)
  const cells = answers.slice(0, size).map((a) =>
    a === 'correct' ? '⩝' : a === 'near-miss' ? '⩞' : '⩟');
  while (cells.length < size) cells.push('⩟');
  const lines = [];
  for (let i = 0; i < cells.length; i += 5) lines.push(cells.slice(i, i + 5).join(''));
  return lines.join('\n');
}