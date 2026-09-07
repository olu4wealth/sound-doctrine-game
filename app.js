// app.js — Sound Doctrine shell: wires game-core + storage to the DOM.
// Duolingo-style: countdown timer (bonus time on correct), kind hearts, color-coded
// options, juicy micro-interactions. Content stays scripturally verified.
import {
  TIER_NAMES, TIER_EMOJI, BIDS, BASE_POINTS, MAX_STREAK, MAX_HEARTS,
  bonusTime, QUESTION_TIME, fiftyFiftyHide, climbTierFor, LADDER_TIER_STEP,
  STREAK_MILESTONE, LADDER_LENGTH, DAILY_LENGTH, timeForQuestion,
  dailyCharge, dailySeed, resolveAnswer, tierOf,
  pickNextLadder, applyDailyVisit, buildChargeReport, leaderboardScore,
  sortLeaderboard, shareGrid, shareQuip, categoryLabel, shuffle, mulberry32, hashCode,
  heroRun, HEROES,
  rankOf, rankProgress, retestRun, masterySummary,
  msUntilDailyReset, formatCountdown,
} from './game-core.js';
import {
  loadPlayer, savePlayer, recordCharge, updateLeaderboard,
  loadLeaderboard, syncLeaderboardToSupabase, signOutPlayer, deletePlayer,
} from './storage.js';
import {
  countUp, seedCounter, staggerIn, growBar, answerFeedback, revealModal,
  pulseFlame, nudge, swapScreens, flipList, motionOK,
} from './motion.js';
import { sfx, music } from './sound.js';
import {
  getSupabaseClient, upsertDailyScore, subscribeDailyScore, loadDailyLeaderboard, SUPABASE_READY,
} from './supabase.js';

const el = (id) => document.getElementById(id);

// Escape anything player-controlled before it reaches innerHTML. Local-only today,
// but the leaderboard is Supabase-bound, where an unescaped name is stored XSS.
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- State ----------
let bank = [];
let player = loadPlayer();
let mode = 'ladder'; // 'ladder' | 'daily' | 'hero'
let session = null;
let timerInt = null;
let currentQ = null;
let dailyIdx = 0; // index into session._dailyList during a Daily Quest
let heroIdx = 0; // index into session._heroList during a Choose Your Hero run
let heroBank = []; // Choose Your Hero typed questions (data/heroes.json)
let lastReport = null; // most recent Charge Report — powers "Take the retest"
let lastRunMode = 'ladder'; // mode the last finished run was played in (for sharing)
// Daily-Quest (Supabase) leaderboard state. All no-op when offline (SUPABASE_READY false).
let dailyLbCache = [];       // last-loaded daily scores (sorted client-side)
let dailySub = null;         // Realtime unsubscribe handle
let dailyActiveRange = 'all'; // 'day' | 'week' | 'year' | 'all'

// Countdown state (per question)
let timeLeft = 0;
let timeTotal = 0;
let timeRunning = false;
let frozenUntil = 0; // timestamp (ms) until which the timer is frozen (power-up)
let tutorialPaused = false; // while true, the countdown doesn't tick (during tutorial)

// Points that drive rank: the banked lifetime pot, not `totalCorrect × 100`
// (which used to max the whole title ladder out at 60 correct answers).
function rankPoints() { return player.lifetimePot || 0; }

// ---------- Load ----------
async function loadBank() {
  // D2: single canonical file; fallback to legacy 3-file merge during migration
  try {
    const r = await fetch('data/questions-merged.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    bank = await r.json();
  } catch {
    const [a, b, c] = await Promise.all([
      fetch('data/questions.json').then((r) => r.json()),
      fetch('data/questions-t47.json').then((r) => r.json()),
      fetch('data/questions-new.json').then((r) => r.json()),
    ]);
    bank = [...a, ...b, ...c];
  }
  bank.forEach((q) => { q.tier = tierOf(q); });
  // Choose Your Hero typed questions — optional extra; hide the mode if absent.
  try {
    const r = await fetch('data/heroes.json');
    if (r.ok) heroBank = await r.json();
  } catch { heroBank = []; }
  el('hero-card')?.classList.toggle('hidden', !heroBank.length);
}

function showScreen(id) {
  const incoming = el(id);
  if (!incoming) return;
  // Find what's currently up so it can be animated OUT. Toggling `.hidden` alone
  // meant screens hard-cut away with no exit — the app read as a slideshow.
  const outgoing = [...document.querySelectorAll('.screen')]
    .find((sc) => sc !== incoming && !sc.classList.contains('hidden'));
  document.querySelectorAll('.screen').forEach((sc) => {
    if (sc !== incoming && sc !== outgoing) sc.classList.add('hidden');
  });
  swapScreens(outgoing, incoming);
  // Painted title scene (generated art) spans the viewport only while the title screen is up.
  document.body.classList.toggle('on-start', id === 'screen-start');
  // The climb pins itself to the viewport so nothing about a question sits below
  // the fold; every other screen scrolls normally.
  document.body.classList.toggle('in-game', id === 'screen-game');
  if (id === 'screen-game') scheduleFit();
  // Background music is for devotion, not for starting — pause on the title/HOW screens
  // and resume once the player is in the game/home.
  if (id === 'screen-start' || id === 'screen-how') music.stop();
  else if (sfx.isMusicEnabled() && musicPrimed) music.start();
  window.scrollTo(0, 0);
}

// ---------- Hearts (lives) ----------
function hearts() { return player.hearts ?? MAX_HEARTS; }
function setHearts(n) {
  player.hearts = Math.max(0, Math.min(MAX_HEARTS, n));
}
function renderHearts() {
  const n = hearts();
  el('hud-hearts').textContent = '❤️'.repeat(n) + '🤍'.repeat(MAX_HEARTS - n);
}

// ---------- Candle / home ----------
// The menu no longer shows a candle sprite; renderCandle fills the personal
// header (name, rank, streak) and the daily/ladder widgets.
function renderCandle() {
  el('home-name').textContent = player.name || '—';
  el('home-rank').textContent = rankOf(rankPoints());
  const streakEl = el('streak-num');
  if (streakEl) streakEl.textContent = player.streak || 0;
  renderRankProgress();
  renderDailyCountdown();

  // New-player gating: Daily Quest + Choose Your Hero unlock after a Ladder climb.
  const ladderDone = !!player.ladderPlayed;
  el('daily-card')?.classList.toggle('locked', !ladderDone);
    el('hero-card')?.classList.toggle('locked', !ladderDone);
}

// Rank progress: shows the banked lifetime pot and the distance to the next title.
function renderRankProgress() {
  const pts = rankPoints();
  const rp = rankProgress(pts);
  const ptsEl = el('rank-pts'), nextEl = el('rank-next'), fill = el('rank-bar-fill');
  if (ptsEl) ptsEl.textContent = `⚜ ${pts.toLocaleString()}`;
  if (nextEl) {
    nextEl.textContent = rp.next
      ? `Next: ${rp.next} (${Math.max(0, rp.span - rp.into).toLocaleString()} to go)`
      : 'Highest rank reached';
  }
  growBar(fill, rp.pct * 100, { delay: 0.1 });
}

// Daily Quest rolls over at 00:00 UTC (dailySeed keys off UTC). Showing the
// countdown gives the home screen a reason to be opened again tomorrow.
function renderDailyCountdown() {
  const node = el('daily-countdown');
  if (!node) return;
  const today = dailySeed(new Date());
  const doneToday = player.lastDailyDay === today;
  const left = formatCountdown(msUntilDailyReset(new Date()));
  node.textContent = doneToday ? `✓ Done today · new quest in ${left}` : `New quest in ${left}`;
  node.classList.toggle('done', doneToday);
}

// The candle no longer melts (master replaced it with a static candle.webp), so
// this only drives the daily reset countdown while the home screen is visible.
function setupCandleClock() {
  setInterval(() => {
    if (!el('screen-home')?.classList.contains('hidden')) renderDailyCountdown();
  }, 60 * 1000);
}
// ---------- Session setup ----------
function resetSession() {
  // A new game always starts afresh: full lives, empty session, cleared per-question state, timer reset to 30s.
  stopTimer();
  timeLeft = 0; timeTotal = 0; frozenUntil = 0;
  setHearts(MAX_HEARTS);
  session = { questions: [], pot: 0, elapsedMs: 0, daily: false, bestTimeMs: 0, runTiers: [], maxRunTier: 0, streak: 0, usedLifelines: {} };
  dailyIdx = 0;
  heroIdx = 0;
  const clearQ = (q) => {
    delete q._usedThisRun; delete q._outcome; delete q._correct; delete q._displayOrder;
  };
  bank.forEach(clearQ);
  heroBank.forEach(clearQ);
  savePlayer(player);
}

function startClimb() {
  mode = 'ladder';
  resetSession();
  renderHearts();
  nextQuestion();
  showScreen('screen-game');
  // Fire the interactive tutorial on the player's very first climb (only if not yet done).
  if (!localStorage.getItem('sd_tutorial_done')) {
    setTimeout(() => showTutorial(), 500);
  }
}

// ---------- Item 6: retest ----------
// The report already names every miss and the passages to read. This turns that
// into a playable run so study → test → restudy closes without leaving the app.
function startRetest() {
  if (!lastReport) { startClimb(); return; }
  const list = retestRun(bank, lastReport, LADDER_LENGTH);
  if (!list.length) { startClimb(); return; }
  mode = 'ladder';
  resetSession();
  session._retestList = list;
  list.forEach((q) => { q._usedThisRun = true; });
  renderHearts();
  showScreen('screen-game');
  nextQuestion();
}

function startDaily() {
  if (!player.ladderPlayed) return; // locked until the player finishes a Ladder climb
  mode = 'daily';
  const today = dailySeed(new Date());
  const list = dailyCharge(bank, today, mulberry32(hashCode(today)));
  resetSession();
  session.daily = true;
  session._dailyList = list;
    el('daily-charge-intro').textContent = `Today's Quest — Same for everyone, so the board is fair.`;
  el('btn-daily-start').classList.remove('hidden');
  el('btn-daily-share').classList.add('hidden');
  el('daily-answered').classList.add('hidden');
  showScreen('screen-daily');
}

function beginDailyList() {
  el('btn-daily-start').classList.add('hidden');
  mode = 'daily';
  dailyIdx = 0;
  session._dailyList.forEach((q) => { q._usedThisRun = true; });
  renderHearts();
  showScreen('screen-game');
  renderDailyQuestion();
}

// ---------- Choose Your Hero ----------
// Hero select -> deterministic 10-question run scoped to the hero's own book(s).
const HERO_TYPE_LABELS = {
  truefalse: '\u2696\uFE0F True or False',
  wordorder: '\u270B Word Order',
  whodid: '\uD83D\uDDE3\uFE0F Who Did This',
};

function heroTypeLabel(q) {
  return HERO_TYPE_LABELS[q.type] || `${TIER_EMOJI[q.tier]} T${q.tier} \u00B7 From ${q.book}`;
}

function openHeroSelect() {
  if (!heroBank.length) return;
  if (!player.ladderPlayed) return; // locked until the player finishes a Ladder climb
  hydrateLazyImages(el('screen-hero'));
  upgradeHeroSelectArt(el('screen-hero'));
  showScreen('screen-hero');
}

// Swap data-lazy -> src the first time a screen is shown. Images inside a
// display:none subtree are still fetched by the browser, so hidden screens were
// pulling ~1 MB of mascot GIFs on first paint.
function hydrateLazyImages(root) {
  root?.querySelectorAll('img[data-lazy]').forEach((img) => {
    img.src = img.dataset.lazy;
    delete img.dataset.lazy;
  });
}

function startHero(heroId) {
  if (!HEROES[heroId] || !heroBank.length) return;
  mode = 'hero';
  const today = dailySeed(new Date());
  const list = heroRun(bank, heroBank, heroId, today, mulberry32(hashCode(`hero:${today}:${heroId}`)));
  resetSession();
  session.hero = heroId;
  session._heroList = list;
  heroIdx = 0;
  list.forEach((q) => { q._usedThisRun = true; });
  renderHearts();
  showScreen('screen-game');
  renderHeroQuestion();
}

function renderHeroQuestion() {
  const list = session._heroList;
  if (heroIdx >= list.length) { finishHero(); return; }
  const q = list[heroIdx];
  q.tier = tierOf(q);
  currentQ = q;
  renderQuestion(q);
}

function finishHero() { finishCommon(); }

// ---------- Countdown timer ----------
// Constant 30s base (QUESTION_TIME), lifted only for questions whose reading time
// won't fit inside it — 138 of 175 still get exactly 30s. Word-order questions may
// still pass a larger floorSeconds.
function startCountdown(q, idxInRun = 0, floorSeconds = 0) {
  stopTimer();
  timeTotal = Math.max(floorSeconds || 0, timeForQuestion(q));
  timeLeft = timeTotal;
  runCountdown();
}
// Resume on whatever is left, rather than re-budgeting from the top: the stake
// popup pauses the clock, and backing out of it must not hand back free time.
function resumeCountdown() {
  if (timerInt || timeLeft <= 0) return;
  runCountdown();
}
function runCountdown() {
  timeRunning = true;
  renderTimerBar();
  timerInt = setInterval(() => {
    if (tutorialPaused) { renderTimerBar(); return; } // tutorial active — don't tick down
    if (Date.now() < frozenUntil) { renderTimerBar(); return; } // frozen — don't tick down
    timeLeft -= 0.1;
    if (timeLeft <= 0) {
      timeLeft = 0;
      stopTimer();
      onTimeout();
      return;
    }
    renderTimerBar();
  }, 100);
}
function stopTimer() {
  if (timerInt) { clearInterval(timerInt); timerInt = null; }
  timeRunning = false;
}
function renderTimerBar() {
  const frac = timeTotal ? timeLeft / timeTotal : 0;
  // Circular ring
  const ring = el('ring-fill');
  const C = 2 * Math.PI * 34; // r=34
  ring.style.strokeDasharray = String(C);
  ring.style.strokeDashoffset = String(C * (1 - Math.max(0, frac)));
  ring.dataset.state = frac > 0.5 ? 'ok' : frac > 0.25 ? 'warn' : 'danger';
  el('ring-label').textContent = String(Math.ceil(timeLeft));
  
  // Shake animation when time is critical (< 20% remaining)
  const ringEl = document.querySelector('.timer-ring');
  if (frac <= 0.2 && frac > 0) {
    ringEl.classList.add('timer-shaking');
  } else {
    ringEl.classList.remove('timer-shaking');
  }
  // Danger-phase tick sound (once per second when time is critically low).
  if (frac <= 0.2 && frac > 0 && Math.abs((timeLeft % 1)) < 0.1) {
    sfx.tick(); haptics('tick');
  }
  updateFlame(frac);
}

// Persistent experience factor: the flame rests low for new players and grows
// brighter the more they've played (tied to lifetime questions answered).
function flameExperience() {
  const n = player.totalAnswered || 0;
  return Math.round((0.4 + Math.min(0.6, n / 120)) * 100) / 100; // 0.40 (new) → 1.00 (veteran)
}

// Drive the live flame: full/steady at full time, dims toward zero, out when time's up.
// The persistent experience level is layered under the real-time timer signal.
function updateFlame(frac) {
  const meter = el('flame-meter');
  const flame = el('flame');
  if (!meter || !flame) return;
  const exp = flameExperience();
  const intensity = Math.max(0.18, exp * Math.max(0.25, Math.min(1, frac)));
  meter.style.setProperty('--flame-intensity', String(intensity));
  if (frac <= 0.2) flame.classList.add('dim');
  else flame.classList.remove('dim');
  // NOTE: 'bright' pulse is NOT cleared here — it times out in pulseFlameBright().
}

// ---------- Mascots (Timothy & Titus) ----------
// Only ONE mascot is visible while answering: the book-matched mascot sits
// idle beside the Freeze button. On feedback Continue, a large happy/sad
// reaction appears centred ON TOP of the feedback modal (not in the corner).
const MASCOTS = {
  '1 Timothy': { name: 'Timothy', base: 'assets/mascot-timothy' },
  '2 Timothy': { name: 'Timothy', base: 'assets/mascot-timothy' },
  'Titus':     { name: 'Titus',   base: 'assets/mascot-titus' },
};
let hostMascot = null;

function setMascot(book) {
  const m = MASCOTS[book] || MASCOTS['1 Timothy'];
  hostMascot = m;
  const box = el('mascot-idle');
  const img = el('mascot-idle-img');
  const label = el('mascot-idle-name');
  if (!box || !img) return;
  img.src = `${m.base}-idle.gif`;
  img.alt = m.name;
  if (label) label.textContent = m.name;
  box.style.display = 'flex';
  box.classList.remove('mascot-happy', 'mascot-sad');
}

function reactMascot(kind) {
  if (!hostMascot) return;
  const mood = (kind === 'correct' || kind === 'grace') ? 'happy' : 'sad';
  const src = `${hostMascot.base}-${mood}.gif`;
  // Large centred overlay — on top of the feedback modal, high z-index.
  const overlay = document.createElement('div');
  overlay.className = `mascot-reaction mascot-${mood}`;
  overlay.id = 'mascot-reaction';
  // Remove any stale reaction first
  document.getElementById('mascot-reaction')?.remove();
  overlay.innerHTML = `<img src="${src}" alt="${hostMascot.name} ${mood}" /><span>${hostMascot.name}</span>`;
  document.body.appendChild(overlay);
  // Auto-remove after the feedback transition; showFeedbackModal's Continue
  // handler also removes it when advancing (so it never lingers).
  setTimeout(() => overlay.remove(), 1800);
}

// Show/hide the streak-combo "🔥 ×N" badge based on the current consecutive-correct streak.
function updateStreakCombo() {
  const badge = el('streak-combo');
  if (!badge) return;
  const s = session.streak || 0;
  if (s >= 2) {
    badge.textContent = `🔥 ×${comboMultiplier(s).toFixed(1)}`;
    badge.classList.remove('hidden');
    badge.classList.toggle('hot', s >= 4);
  } else {
    badge.classList.add('hidden');
  }
}

// Sparkle burst: spawns a few CSS particles that fly outward and fade (dopamine on correct).
function burstSparkles(count = 8, originX = 0.5, originY = 0.5) {
  const host = document.createElement('div');
  host.className = 'sparkle-host';
  document.body.appendChild(host);
  const colors = ['#f3b431', '#58cc02', '#38b6ff', '#fb7185', '#fff3d6'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'sparkle-p';
    p.textContent = ['✦', '✧', '❋', '⋆'][i % 4];
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const dist = 50 + Math.random() * 70;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 20;
    p.style.setProperty('--tx', tx + 'px');
    p.style.setProperty('--ty', ty + 'px');
    p.style.setProperty('--c', colors[i % colors.length]);
    p.style.left = (originX * 100) + '%';
    p.style.top = (originY * 100) + '%';
    host.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
  setTimeout(() => host.remove(), 700);
}
function fmtTime(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ---------- Fitting a question to one screen ----------
// The climb screen is capped at the viewport height, so a long prompt with four
// verse-length options can still outgrow it. Step the type and spacing down —
// never past a readable floor — until the options list stops being clipped.
const FIT_STEPS = ['fit-1', 'fit-2', 'fit-3'];
function fitQuestion() {
  const screen = el('screen-game');
  const opts = el('q-options');
  if (!screen || !opts || screen.classList.contains('hidden')) return;
  // Measure at full size first; a short question must never keep a previous
  // question's shrink.
  screen.classList.remove(...FIT_STEPS);
  for (const step of FIT_STEPS) {
    if (opts.scrollHeight <= opts.clientHeight + 1) return; // nothing clipped
    screen.classList.remove(...FIT_STEPS);
    screen.classList.add(step);
  }
}
// Two frames: renderQuestion can run before showScreen reveals the screen, and
// the card has to be laid out before it can be measured.
function scheduleFit() {
  requestAnimationFrame(() => requestAnimationFrame(fitQuestion));
}
// Rotating or resizing changes the budget entirely.
let fitResizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(fitResizeTimer);
  fitResizeTimer = setTimeout(fitQuestion, 120);
});

// ---------- Question rendering ----------
function renderQuestion(q, opts = {}) {
  frozenUntil = 0; // reset any freeze power-up for the next question
  setMascot(q.book);
  renderBook(q);
  renderTier(q._runTier || q.tier);
  el('q-prompt').innerHTML = highlightQuotedSafe(q.prompt);

  const wrap = el('q-options');
  // Word-order questions (Choose Your Hero) replace the option grid entirely.
  if (q.type === 'wordorder') { renderWordOrder(q); return; }
  const order = shuffle(Math.random, q.options.map((_, i) => i));
  q._displayOrder = order;
  wrap.innerHTML = '';
  wrap.classList.toggle('count-2', q.options.length === 2); // True/False gets the wide look
  order.forEach((orig, displayIdx) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.textContent = q.options[orig];
    btn.dataset.display = String(displayIdx);
    btn.setAttribute('aria-label', q.options[orig]);
    btn.addEventListener('click', () => onAnswer(displayIdx));
    wrap.appendChild(btn);
  });

  el('q-options').classList.remove('hidden');
  el('feedback').classList.add('hidden');
  el('feedback').classList.remove('correct', 'wrong', 'grace');
  updateProgress();
  renderScore();
  renderTimerBar();

  // Budget follows this question's own reading load and effective tier.
  startCountdown({ ...q, tier: q._runTier || q.tier }, (session?.questions?.length || 0));
  renderPowerups();
  scheduleFit();
}

function updateProgress() {
    // Unlimited Ladder: no fixed end. Show streak | current tier instead of a /N counter.
  let idx, total;
  if (mode === 'daily' || mode === 'hero') {
    const list = mode === 'daily' ? session._dailyList : session._heroList;
    const i = mode === 'daily' ? dailyIdx : heroIdx;
    total = list?.length || 10;
    idx = i + 1; // 1-based current question number
    idx = Math.max(1, Math.min(idx, total));
    el('progress-bar').style.width = `${Math.round((idx / total) * 100)}%`;
    el('hud-progress').textContent = `${idx}/${total}`;
  } else if (session._retestList) {
    // Retest: fixed-length, honest 1-based counter.
    total = runLength();
    idx = Math.max(1, Math.min(session.questions.length + 1, total));
    el('hud-progress').textContent = `${idx}/${total}`;
    el('progress-bar').style.width = `${Math.round((idx / total) * 100)}%`;
  } else {
    // Free Ladder climb is uncapped — show the streak instead of a /10 counter.
    const qIndex = session.questions.length || 0;
    el('hud-progress').textContent = `🔥 ${session.streak || 0}`;
    el('progress-bar').style.width = `${Math.round(Math.min(100, ((session.streak || 0) / STREAK_MILESTONE) * 100))}%`;
  }
}

// Live score chip: the running pot is always visible in the HUD.
function renderScore() {
  const chip = el('hud-score');
  // Was `chip.textContent = ...` — a 900-point answer looked the same as a 100.
  if (chip) countUp(chip, session?.pot || 0, { format: (v) => `\u269C ${Math.round(v)}` });
}

// The book + chapter the question comes from, shown above the prompt.
function renderBook(q) {
  const node = el('q-book');
  if (!node) return;
  node.textContent = `${q.book}${q.chapter ? ` · Ch ${q.chapter}` : ''}`;
}

// The current tier/rung, shown above the question (kept out of the top HUD).
function renderTier(tier) {
  const node = el('q-tier');
  if (!node) return;
  node.textContent = `${TIER_EMOJI[tier]} T${tier} · ${TIER_NAMES[tier]}`;
}

function nextQuestion() {
  // Progressive difficulty: ramp the effective tier up as the climb progresses.
  // climbTierFor always starts at T1 and rises +1 tier every 4 questions (capped at 7), so the
  // further you climb the harder it gets — a real ladder.
  const qIndex = session.questions.length; // 0-based before this question
  if (qIndex >= runLength()) { finishClimb(); return; }
  // A queued retest run plays a fixed list instead of the adaptive picker.
  if (session._retestList) {
    const rq = session._retestList[qIndex];
    if (!rq) { finishClimb(); return; }
    rq.tier = tierOf(rq);
    currentQ = rq;
    recordRunTier(qIndex, rq.tier);
    renderQuestion(rq);
    return;
  }
    // LADDER_TIER_STEP (1.5) instead of the default 4: with the old fixed 10-question
  // climb the ramp would stop at T3 and leave T4–T7 unreachable. The Ladder is now
  // unbounded, so this step just sets how quickly you reach T7 (capped) while you keep climbing.
  const effectiveTier = climbTierFor(qIndex, LADDER_TIER_STEP);
  const q = pickNextLadder(bank, {
    entryTier: effectiveTier,
    weakSubjects: new Set(player.weakSubjects || []),
  });
  if (!q) { finishClimb(); return; }
  currentQ = q;
  recordRunTier(qIndex, effectiveTier); // track for reward + milestones
  renderQuestion(q);
}

// Track the effective tier per question so the timer scales and milestones can be rewarded.
function recordRunTier(qIndex, effectiveTier) {
  if (!session.runTiers) session.runTiers = [];
  session.runTiers[qIndex] = effectiveTier;
  if (currentQ) currentQ._runTier = effectiveTier;
  // Also expose the highest tier reached so far for reward display.
  session.maxRunTier = session.runTiers.reduce((m, t) => Math.max(m, t || 0), 0);
}

function renderDailyQuestion() {
  const list = session._dailyList;
  if (dailyIdx >= list.length) { finishDaily(); return; }
  const q = list[dailyIdx];
  q.tier = tierOf(q);
  currentQ = q; // onAnswer/onTimeout/isLastQuestion treat currentQ as the object
  renderQuestion(q);
}

function showFeedbackModal(head, verse, ref, kind, isLast, correctText) {
  // Remove old modal if any
  const old = document.getElementById('feedback-modal-backdrop');
  if (old) old.remove();
  
  // On a wrong/timeout answer, surface the correct option clearly inside the popup.
  const correctLine = (!correctText || kind === 'correct' || kind === 'grace')
    ? ''
    : `<div class="feedback-answer">The correct answer was: <strong>${correctText}</strong></div>`;
  
  const backdrop = document.createElement('div');
  backdrop.id = 'feedback-modal-backdrop';
  backdrop.className = 'feedback-modal-backdrop';
  backdrop.innerHTML = `
    <div class="feedback-modal-card ${kind}">
      <div class="mascot-reaction-host"></div>
      <div class="feedback-modal-head">${head}</div>
      ${correctLine}
      <blockquote class="feedback-modal-verse">${verse}</blockquote>
      <cite class="feedback-modal-ref">${ref}</cite>
      <button class="primary feedback-modal-btn" id="feedback-modal-continue">${isLast ? 'See the report' : 'Continue'}</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  
  // Show mascot reaction immediately when modal appears (not on Continue click)
  const mood = (kind === 'correct' || kind === 'grace') ? 'happy' : 'sad';
  const src = hostMascot ? `${hostMascot.base}-${mood}.gif` : '';
  const name = hostMascot ? hostMascot.name : '';
  const hostEl = backdrop.querySelector('.mascot-reaction-host');
  if (hostEl && hostMascot) {
    hostEl.innerHTML = `<div class="mascot-reaction mascot-${mood}" id="mascot-reaction"><img src="${src}" alt="${name} ${mood}" /><span>${name}</span></div>`;
  }
  // Card rises, mascot lands just after it — replaces the CSS `pop` hard-cut.
  revealModal(backdrop.querySelector('.feedback-modal-card'), hostEl?.firstElementChild);
  
  document.getElementById('feedback-modal-continue').onclick = () => {
    // Reaction is already visible; just dismiss together with the modal
    setTimeout(() => {
      backdrop.remove();
      btnNextGo();
    }, 200);
  };
}

// Reward for climbing far: a bonus each time you break into a new tier band,
// so the payout tracks the rung actually reached rather than raw question count.
function checkMilestoneReward() {
  const rung = session.maxRunTier || 1;
  let label = '', points = 0;
  if (rung >= 7) { label = 'The hardest rungs!'; points = 250; }
  else if (rung >= 6) { label = 'Deep waters!'; points = 150; }
  else if (rung >= 4) { label = 'The ascent!'; points = 100; }
  else if (rung >= 2) { label = 'Tier climbed!'; points = 50; }
  if (points) return { label, points };
  return null;
}

// Streak-fire combo multiplier: consecutive correct answers grow the flame's reward.
// 1 correct = ×1, 2 = ×1.2, 3 = ×1.4, 4+ = ×1.6 (capped).
function comboMultiplier(streak) {
  if (streak <= 1) return 1;
  if (streak === 2) return 1.2;
  if (streak === 3) return 1.4;
  return 1.6;
}

// Flame flares bright briefly on a correct answer; the flare grows with the streak combo.
function pulseFlameBright() {
  const flame = el('flame');
  if (!flame) return;
  const streak = session.streak || 1;
  // Bigger flare the longer the streak. GSAP's overwrite makes the newest pulse
  // win, so rapid answers can no longer strand the flame mid-flare.
  pulseFlame(flame, 1.15 + Math.min(0.5, (streak - 1) * 0.12));
}

// ---------- Lifelines (once per game, no oil) ----------
function renderPowerups() {
  const used = session?.usedLifelines || {};
  document.querySelectorAll('.powerup').forEach((b) => {
    const type = b.dataset.pu;
    const already = !!used[type];
    const wordBlock = b.id === 'pu-5050' && currentQ?.type === 'wordorder';
    b.disabled = already || !timeRunning || wordBlock;
    b.classList.toggle('used', already);
  });
}

function usePowerup(type) {
  if (!timeRunning || !currentQ) return;
  const used = session.usedLifelines || (session.usedLifelines = {});
  if (used[type]) { nudge(document.querySelectorAll('.powerup')); return; }
  used[type] = true;
  if (type === 'skip') {
    sfx.powerup(); burstSparkles(6, 0.5, 0.5);
    stopTimer();
    // Skip: mark skipped (no penalty), advance with a neutral outcome.
    currentQ._outcome = 'skipped'; currentQ._correct = false;
    session.questions.push(currentQ);
    if (mode === 'daily') { dailyIdx++; renderDailyQuestion(); }
    else if (mode === 'hero') { heroIdx++; renderHeroQuestion(); }
    else nextQuestion(); // endless climb — skip just advances
    renderPowerups();
    return;
  }
  if (type === '5050') {
    sfx.powerup(); burstSparkles(6, 0.5, 0.5);
    // Remove two incorrect options (never the correct one). The shuffle means
    // display slots ≠ original indices, so translate via q._displayOrder —
    // fiftyFiftyHide works in the original space where correctIndex lives.
    const wrap = el('q-options');
    const btns = [...wrap.querySelectorAll('.option:not(:disabled)')];
    const hide = new Set(fiftyFiftyHide(currentQ._displayOrder, currentQ.correctIndex));
    for (const b of btns) {
      if (hide.has(Number(b.dataset.display))) {
        b.style.visibility = 'hidden';
        b.disabled = true; // unreachable by keyboard / never "pending"
      }
    }
    renderPowerups();
    return;
  }
  if (type === 'freeze') {
    sfx.powerup();
    frozenUntil = Date.now() + 5000; // 5s freeze
    el('flame-meter')?.classList.add('frozen');
    setTimeout(() => el('flame-meter')?.classList.remove('frozen'), 5000);
    renderPowerups();
    return;
  }
}

// ---------- Word Order (Choose Your Hero) ----------
// The verse's words are shuffled into a pool; the player taps them in order.
// Tapping a placed word returns it to the pool. Completing the line commits.
function renderWordOrder(q) {
  const wrap = el('q-options');
  wrap.innerHTML = '';
  wrap.classList.remove('count-2');
  wrap.classList.remove('hidden');
  el('feedback').classList.add('hidden');
  el('feedback').classList.remove('correct', 'wrong', 'grace');

  let order = shuffle(Math.random, q.words.map((_, i) => i));
  if (order.every((v, i) => v === i)) order.reverse(); // never start already-solved
  q._displayOrder = order;

  const line = document.createElement('div');
  line.className = 'wordline';
  line.id = 'wordline';
  const pool = document.createElement('div');
  pool.className = 'wordpool';
  pool.id = 'wordpool';
  const tools = document.createElement('div');
  tools.className = 'word-tools';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'ghost small';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    if (!timeRunning) return;
    [...line.querySelectorAll('.word-chip')].forEach((c) => pool.appendChild(c));
  });
  tools.appendChild(clearBtn);

  order.forEach((origIdx) => {
    const chip = document.createElement('button');
    chip.className = 'word-chip';
    chip.textContent = q.words[origIdx];
    chip.dataset.orig = String(origIdx);
    chip.addEventListener('click', () => {
      if (!timeRunning) return;
      if (chip.parentElement === line) pool.appendChild(chip); // tap placed word = take back
      else line.appendChild(chip);
      if (line.querySelectorAll('.word-chip').length === q.words.length) {
        commitWordOrder(q, line, pool);
      }
    });
    pool.appendChild(chip);
  });

  wrap.append(line, pool, tools);
  updateProgress();
  renderScore();
  renderTimerBar();
  // Word order also needs handling time per chip on top of the reading budget.
  startCountdown(q, session?.questions?.length || 0, Math.max(24, Math.round(q.words.length * 2.2)));
  renderPowerups();
  scheduleFit();
}

function commitWordOrder(q, line, pool) {
  stopTimer();
  const guess = [...line.querySelectorAll('.word-chip')].map((c) => c.textContent).join(' ');
  const isCorrect = guess === q.words.join(' ');
  [...line.querySelectorAll('.word-chip'), ...pool.querySelectorAll('.word-chip')].forEach((c) => {
    c.disabled = true;
    if (line.contains(c)) c.classList.add(isCorrect ? 'correct' : 'wrong');
  });
  // chosenOrig 0 hits the correct answer (word-order items carry correctIndex 0);
  // -1 is never a valid index, so resolveAnswer records a clean wrong.
  commitAnswer(0, isCorrect ? 0 : -1, null);
}

// ---------- Answering (tap an option, then stake it in the popup) ----------
// The stake row used to sit inline above the options, which cost a tap before
// the player had even decided — and on a small screen it pushed the options
// below the fold. Confidence is asked once the answer is chosen, in a popup
// over the question, and picking a multiplier commits: still two taps, but the
// second one is the one that carries the meaning.
let _pending = null;   // re-entrancy guard so a double-tap can't answer twice
let selectedBid = BIDS[0]; // remembered across questions (default 1× Safe)

function onAnswer(displayIdx) {
  if (!timeRunning) return;
  if (_pending !== null) return; // stake popup is already open for this question
  const q = currentQ;
  // The clock stops the moment an option is chosen — deliberating over the
  // stake must not cost the time that was budgeted for reading the question.
  stopTimer();
  renderPowerups(); // power-ups grey out while the stake is being set
  openStakeModal(displayIdx, q);
}

// The confidence popup: opened by choosing an option, closed by staking it
// (which answers) or by backing out (which returns the clock and the question).
function openStakeModal(displayIdx, q) {
  _pending = displayIdx;
  document.getElementById('stake-modal-backdrop')?.remove();

  const chosenText = q.options[q._displayOrder[displayIdx]];
  const buttons = el('q-options').querySelectorAll('.option');
  buttons.forEach((b) => {
    b.classList.toggle('pending', Number(b.dataset.display) === displayIdx);
  });

  const backdrop = document.createElement('div');
  backdrop.id = 'stake-modal-backdrop';
  backdrop.className = 'feedback-modal-backdrop stake-modal-backdrop';
  backdrop.innerHTML = `
    <div class="stake-card" role="dialog" aria-modal="true" aria-labelledby="stake-head">
      <div class="stake-head" id="stake-head">How sure?</div>
      <div class="stake-chosen">“${escapeHtml(chosenText)}”</div>
      <div class="stake-options" id="stake-options"></div>
      <div class="stake-preview" id="stake-preview"></div>
      <div class="stake-actions">
        <button type="button" class="ghost" id="stake-back">‹ Change answer</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const opts = backdrop.querySelector('#stake-options');
  BIDS.forEach((bid) => {
    const p = BASE_POINTS * bid.mult;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stake-opt';
    btn.dataset.mult = String(bid.mult);
    btn.innerHTML = `<span class="stake-mult">${bid.mult}× ${bid.label}</span>` +
                    `<span class="stake-pts">+${p} · −${p}</span>`;
    btn.addEventListener('click', () => commitStake(bid, displayIdx));
    opts.appendChild(btn);
  });
  backdrop.querySelector('#stake-preview').textContent =
    'A near-miss keeps half (Grace).';

  backdrop.querySelector('#stake-back').addEventListener('click', closeStakeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeStakeModal(); });
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStakeModal(); });

  revealModal(backdrop.querySelector('.stake-card'));
  opts.firstElementChild?.focus();
}

function commitStake(bid, displayIdx) {
  if (_pending === null) return;
  selectedBid = bid;
  _pending = null;
  document.getElementById('stake-modal-backdrop')?.remove();
  const q = currentQ;
  el('q-options').querySelectorAll('.option').forEach((b) => b.classList.remove('pending'));
  commitAnswer(displayIdx, q._displayOrder[displayIdx], bid);
}

// Back out of the stake: the answer is un-chosen and the clock picks up exactly
// where it stopped, so backing out is free but not a way to farm extra time.
function closeStakeModal() {
  if (_pending === null) return;
  _pending = null;
  document.getElementById('stake-modal-backdrop')?.remove();
  el('q-options').querySelectorAll('.option').forEach((b) => b.classList.remove('pending'));
  if (currentQ && timeLeft > 0) resumeCountdown();
  renderPowerups();
}

function commitAnswer(displayIdx, chosenOrig, bid) {
  const q = currentQ;
  const qWrap = el('q-options');
  const buttons = qWrap.querySelectorAll('.option');

  const res = resolveAnswer(q, chosenOrig, bid);
  const isCorrect = res.outcome === 'correct';
  const isGrace = res.outcome === 'near-miss';

  q._correct = isCorrect;
  q._outcome = res.outcome;
  session.questions.push(q);
  session.elapsedMs = (session.elapsedMs || 0) + Math.round((timeTotal - timeLeft) * 1000);

  // Streak-fire combo: consecutive correct answers build a growing flame-multiplier.
  // Wrong/reset answers reset the streak (and the combo).
  let comboLine = '';
  if (isCorrect) {
    session.streak = (session.streak || 0) + 1;
    const mult = comboMultiplier(session.streak);
    if (mult > 1) {
      const bonus = Math.round(res.pot * (mult - 1));
      session.pot += res.pot + bonus;
      comboLine = ` · combo ×${mult}`;
    } else {
      session.pot += res.pot;
    }
  } else {
    session.streak = 0;
    if (isCorrect || isGrace) session.pot += res.pot; // grace keeps base but ends combo
    else session.pot += res.pot;
  }
  updateStreakCombo();

  // Flame flares brighter on a correct answer, then settles back.
  if (isCorrect) { pulseFlameBright(); sfx.correct(); burstSparkles(8); haptics('correct'); }
  else if (isGrace) { sfx.grace(); haptics('correct'); }
  else { sfx.wrong(); haptics('wrong'); }

  // Reward for getting far: milestone bonuses as the climb ramps up.
  const milestone = checkMilestoneReward();
  let bonusLine = '';
  if (milestone && isCorrect) {
    session.pot += milestone.points;
    bonusLine = ` · ${milestone.label} +${milestone.points} ⚜`;
    sfx.milestone();
    burstSparkles(16, 0.5, 0.4); // bigger burst on a milestone
  }
  renderScore();

  // Hearts: only lost on wrong/timeout. Correct and grace neither gain nor lose
  // a life — getting answers right should not reward extra lives (in climb or daily).
  if (isCorrect) {
    // no heart change
  } else if (isGrace) {
    // no heart change on grace
  } else {
    setHearts(hearts() - 1);
  }
  renderHearts();
  syncPlayerHearts();

  let correctBtn = null, chosenBtn = null;
  buttons.forEach((btn) => {
    btn.disabled = true;
    const oi = q._displayOrder[Number(btn.dataset.display)];
    if (oi === q.correctIndex) { btn.classList.add('correct'); correctBtn = btn; }
    if (Number(btn.dataset.display) === displayIdx) chosenBtn = btn;
    if (Number(btn.dataset.display) === displayIdx && !isCorrect && !isGrace) btn.classList.add('wrong');
    if (Number(btn.dataset.display) === displayIdx && isGrace) btn.classList.add('grace');
  });
  // Let the answer register on the options before the modal covers them. The
  // timeline is killable, so tapping Continue immediately can't desync it.
  answerFeedback({ correctBtn, chosenBtn, wrong: !isCorrect && !isGrace });

  const gained = bonusTime(res.outcome);
  let head = '';
  let kind = 'correct';
  const stakePts = BASE_POINTS * (bid?.mult ?? 1);
  if (isCorrect) {
    head = `Rightly divided! +${res.points} ⚜ · +${gained}s${comboLine}${bonusLine}`;
    kind = 'correct';
  } else if (isGrace) {
    // Grace transparency: show kept vs would-have-lost
    head = `Grace — near-miss kept. +${res.points} ⚜ (50% of ${stakePts} retained) · +${gained}s<br><span class="grace-detail">Normal loss would have been −${stakePts}</span>`;
    kind = 'grace';
  } else {
    head = `Not quite. −${stakePts} ⚜ — Scripture corrects us —`;
    kind = 'wrong';
  }
  const verse = quotesOf(q);
  const ref = refsOf(q) + ' (KJV)';
  const correctText = q.options[q.correctIndex];
  showFeedbackModal(head, verse, ref, kind, isLastQuestion(), correctText);

  if (mode === 'daily') {
    const g = el('daily-answered');
    g.classList.remove('hidden');
    const cell = document.createElement('span');
    cell.className = `cell ${isGrace ? 'grace' : isCorrect ? 'right' : 'wrong'}`;
    cell.textContent = isCorrect ? '⩝' : isGrace ? '⩞' : '⩟';
    g.appendChild(cell);
  }
}

// Timeout = wrong (records fail, shows the verse correction, no bonus time).
function onTimeout() {
  sfx.timeout();
  const q = currentQ;
  const qWrap = el('q-options');
  q._correct = false;
  q._outcome = 'timeout';
  session.questions.push(q);
  session.elapsedMs = (session.elapsedMs || 0) + timeTotal * 1000;
  setHearts(hearts() - 1);
  renderHearts();
  syncPlayerHearts();

  const buttons = qWrap.querySelectorAll('.option');
  buttons.forEach((btn) => {
    btn.disabled = true;
    const oi = q._displayOrder[Number(btn.dataset.display)];
    if (oi === q.correctIndex) btn.classList.add('correct');
  });
  el('feedback-head').textContent = 'The candle ran down. Scripture corrects us —';
  el('feedback').classList.add('wrong');
  el('feedback-verse').textContent = quotesOf(q);
  el('feedback-ref').textContent = refsOf(q) + ' (KJV)';
  el('feedback').classList.remove('hidden');
  el('btn-next').textContent = isLastQuestion() ? 'See the report' : 'Continue';

  // STOP GAME IF NO LIVES LEFT
  if (hearts() <= 0) {
    stopTimer();
    finishCommon();
    return;
  }

  // Show modal
  showFeedbackModal(
    'The candle ran down. Scripture corrects us —',
    quotesOf(q),
    refsOf(q) + ' (KJV)',
    'wrong',
    isLastQuestion(),
    q.options[q.correctIndex]
  );

  if (mode === 'daily') {
    const g = el('daily-answered');
    g.classList.remove('hidden');
    const cell = document.createElement('span');
    cell.className = 'cell wrong';
    cell.textContent = '⩟';
    g.appendChild(cell);
  }
}

function isLastQuestion() {
  if (mode === 'daily') return dailyIdx >= session._dailyList.length - 1;
  if (mode === 'hero') return heroIdx >= session._heroList.length - 1;
  // Unlimited Ladder: there is no "final" question — the run ends only when hearts
  // hit 0 or the player taps Stop. For a live climb runLength() is Infinity, so this
  // stays false (the "Continue" button never flips to "See the report"). Daily Quest,
  // Hero, and Retest remain fixed-length and still get the report-swap button.
  return session.questions.length >= runLength() - 1;
}

// How many questions this run holds.
function runLength() {
  if (mode === 'daily') return session._dailyList?.length || DAILY_LENGTH;
  if (mode === 'hero') return session._heroList?.length || DAILY_LENGTH;
  // The Ladder is no longer a fixed 10-question run: it climbs until you run out of
  // lives (or tap Stop). climbTierFor already caps at T7, so the difficulty ramps up
  // and then plateaus while the run itself is uncapped. Retest keeps its fixed list.
  if (session._retestList) return session._retestList.length;
  return Infinity; // free Ladder climb
}

function popFeedback(kind) {
  const fb = el('feedback');
  fb.classList.remove('pop');
  void fb.offsetWidth;
  fb.classList.add('pop');
}
function shakeFeedback() {
  const fb = el('feedback');
  fb.classList.remove('shake');
  void fb.offsetWidth;
  fb.classList.add('shake');
}

function syncPlayerHearts() { savePlayer(player); }

function quotesOf(q) {
  if (q.passage && q.verseText) {
    let s = `\u201C${q.verseText}\u201D`;
    if (q.passageB && q.verseTextB) s += ` \u201C${q.verseTextB}\u201D`;
    return s;
  }
  if (Array.isArray(q.verses)) return q.verses.map((v) => `\u201C${v.verseText}\u201D`).join(' ');
  return '';
}
function refsOf(q) {
  const r = [];
  if (q.passage) r.push(q.passage);
  if (q.passageB) r.push(q.passageB);
  if (Array.isArray(q.verses)) for (const v of q.verses) if (v.passage) r.push(v.passage);
  return r.join(' · ');
}
// Question option text is authored data, not markup — escape it before it is
// interpolated into a template (the stake popup quotes the chosen answer).
function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function highlightQuotedSafe(text) {
  let h = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Normalise straight quotes to curly FIRST, then wrap once. Wrapping in two
  // passes meant the straight-quote pass matched the quotes inside the
  // class="q-quote" attribute the curly pass had just inserted, printing the
  // span markup into the prompt — every curly-quoted question read as
  // `“q-quote”>All scripture is given by…`.
  h = h.replace(/"([^"]+?)"/g, '\u201C$1\u201D');
  h = h.replace(/\u201C([^\u201D]+?)\u201D/g, '\u201C<span class="q-quote">$1</span>\u201D');
  return h;
}

function btnNextGo() {
  // When lives are 0, the game should have already ended (see onTimeout guard).
  if (hearts() <= 0) {
    finishCommon();
    return;
  }
  if (mode === 'daily') {
    dailyIdx++;
    renderDailyQuestion();
    return;
  }
  if (mode === 'hero') {
    heroIdx++;
    renderHeroQuestion();
    return;
  }
  nextQuestion();
}

// ---------- Finishing ----------
function finishCommon() {
  stopTimer();
  session.bestTimeMs = session.elapsedMs || 0;
  const report = buildChargeReport(session, bank);

  if (mode === 'ladder') player.ladderPlayed = true; // a finished climb unlocks the other modes
  if (mode === 'daily') player.lastDailyDay = dailySeed(new Date()); // powers the "done today" state
  const streakBefore = player.streak || 0;
  // Apply the day's visit and KEEP its verdict. The previous `Math.max(next, earlier)`
  // meant a decayed streak was immediately restored to its old value, so the candle
  // could never gutter and the streak could never be lost — which is the entire
  // psychological engine of a streak.
  player = applyDailyVisit(player, dailySeed(new Date()));
  delete player.alreadyDone; // transient caller flag; never persist it
  player.bestStreak = Math.max(player.bestStreak || 0, player.streak || 0);
  session.streakBefore = streakBefore;
  session.streakAfter = player.streak || 0;
  session.hitMilestone = streakBefore < STREAK_MILESTONE && (player.streak || 0) >= STREAK_MILESTONE;
  player = recordCharge(player, session);
  setHearts(hearts()); // keep hearts as-is (persist below)
  savePlayer(player);

  const rows = updateLeaderboard(player, session);
  syncLeaderboardToSupabase(rows.find((r) => r.name === player.name) || {});

  lastReport = report;
  lastRunMode = mode;
  renderReport(report, session);
  showScreen('screen-report');
}

function finishClimb() { finishCommon(); }
function finishDaily() {
  finishCommon();
  // Best-effort Daily-Quest score push, fired AFTER the local report renders so an
  // absent/flaky Supabase never blocks the game (offline-safe by design).
  if (SUPABASE_READY && player.name) {
    const answered = (session.questions || []).length;
    const correct = answered ? (session.questions || []).filter((q) => q._correct).length : 0;
    void upsertDailyScore(player.name, {
      score: session.pot || 0,
      answered,
      streak: player.streak || 0,
      acc: answered ? correct / answered : 0,
    }).catch(() => {});
  }
}

// ---------- Report ----------
function renderReport(report, session) {
  el('report-grade').innerHTML =
    `<div class="grade-big">${report.grade.label}</div>
     <div class="grade-title">${report.grade.title}</div>`;
  el('report-summary').innerHTML = `
    <div class="stat"><span class="stat-num">${report.correct}/${report.answered}</span><span class="stat-label">correct</span></div>
    <div class="stat"><span class="stat-num">${Math.round(report.acc * 100)}%</span><span class="stat-label">accuracy</span></div>
    <div class="stat"><span class="stat-num">⚜ ${report.pot}</span><span class="stat-label">score</span></div>
    <div class="stat"><span class="stat-num">${fmtTime(Math.round((session.bestTimeMs || 0) / 1000))}</span><span class="stat-label">solve time</span></div>
  `;

  // Mastery map (per-book chapter breakdown)
  const masteryEl = el('report-mastery');
  if (masteryEl) {
    if (report.mastery && report.mastery.length) {
      const bookBlocks = report.mastery.map((b) => {
        const pct = Math.round((b.acc || 0) * 100);
        const barW = pct + '%';
        const chRows = (b.chapters || []).map((c) => {
          const cp = Math.round((c.acc || 0) * 100);
          const weakest = report.weakestChapter && report.weakestChapter.name === c.name;
          return `<li class="mastery-ch${weakest ? ' weakest' : ''}"><span class="r-label">${c.name}${weakest ? ' ← WEAKEST' : ''}</span><span class="r-bar"><span class="r-fill" style="width:${cp}%"></span></span><span class="r-pct">${cp}%</span></li>`;
        }).join('') || '<li class="empty">No chapter data yet</li>';
        return `<div class="mastery-book"><div class="mastery-book-head"><span>${b.name}</span><span class="mastery-pct">${pct}%</span><span class="r-bar"><span class="r-fill" style="width:${barW}"></span></span></div><ul class="mastery-chapters">${chRows}</ul></div>`;
      }).join('');
      masteryEl.innerHTML = `<h3>YOUR SCRIPTURE MASTERY</h3>${bookBlocks}`;
    } else {
      masteryEl.innerHTML = '';
    }
  }

  // Weakest chapter — the diagnosis only. It used to print `report.missedVerses`,
  // the whole run's misses, which made it a verbatim copy of the block below it
  // AND misattributed those verses: "2 Timothy 2 — 0/2 correct — 5 verses to
  // revisit" listed misses from 1 Timothy 6 and 2 Timothy 4. The verses live in
  // one place now, and this card counts only its own chapter's misses.
  const weakestEl = el('report-weakest');
  if (weakestEl) {
    const wc = report.weakestChapter;
    if (wc) {
      const pct = Math.round((wc.acc || 0) * 100);
      const right = Math.round((wc.acc || 0) * wc.asked);
      const own = (wc.verses || []).length;
      const toRevisit = own ? ` — ${own} verse${own === 1 ? '' : 's'} to revisit below` : '';
      weakestEl.innerHTML = `<h3>Weakest chapter: ${wc.name}</h3>` +
        `<div class="weakest-meta">${pct}% — ${right} of ${wc.asked} correct${toRevisit}</div>`;
    } else {
      weakestEl.innerHTML = '';
    }
  }
  // The one list of misses. Verses from the weakest chapter are tagged, so the
  // card above connects to them without repeating them.
  const missedEl = el('report-missed');
  if (missedEl) {
    const mv = report.missedVerses || [];
    const weakName = report.weakestChapter?.name;
    if (mv.length) {
      const items = mv.map((v) => {
        const inWeakest = weakName && `${v.book} ${v.chapter}` === weakName;
        const weakTag = inWeakest ? ' <span class="missed-tag">weakest chapter</span>' : '';
        const catTag = v.category ? ` <span class="missed-cat">${categoryLabel(v.category)}</span>` : '';
        return `<li><strong>${v.passage}</strong>${catTag}${weakTag} — &ldquo;${v.text}&rdquo;</li>`;
      }).join('');
      missedEl.innerHTML = `<h3>Verses to revisit (${mv.length})</h3><ul>${items}</ul>`;
    } else {
      missedEl.innerHTML = report.answered ? '<p class="empty">No missed verses — perfect run!</p>' : '';
    }
  }

  const rx = report.prescriptions.length
    ? `<h3>How to do better</h3><ol>${report.prescriptions.map((p) => `<li>${p.instruction}</li>`).join('')}</ol>`
    : '<h3>How to do better</h3><p>Keep climbing — seek the harder rungs.</p>';
  el('report-rx').innerHTML = rx;

  // Item 2: the report used to paint every section at once. Cascade them, count
  // the headline numbers up, and grow the mastery bars from zero.
  staggerIn(document.querySelectorAll('#screen-report > *'), { stagger: 0.06, y: 16 });
  const statNums = [...document.querySelectorAll('#report-summary .stat-num')];
  if (statNums[1]) countUp(statNums[1], Math.round(report.acc * 100), { format: (v) => `${Math.round(v)}%` });
  if (statNums[2]) countUp(statNums[2], report.pot, { format: (v) => `\u269C ${Math.round(v)}` });
  document.querySelectorAll('#report-mastery .r-fill').forEach((bar, i) => {
    const pct = parseFloat(bar.style.width) || 0;
    growBar(bar, pct, { delay: 0.15 + i * 0.04 });
  });

  // Share is available on every finished run, not just the (previously
  // unreachable) Daily Quest path.
  const share = el('btn-report-share');
  if (share) {
    share.classList.remove('hidden');
    share.textContent = lastRunMode === 'daily' ? 'Share your Daily Quest' : 'Share your result';
  }
  // "Take the retest" and "Climb again" sat one above the other and read as the
  // same action. They are one button now: with misses banked it replays them,
  // otherwise it starts a fresh climb. A fresh climb after a retestable run is
  // still a tap away through the candle home.
  const again = el('btn-again');
  if (again) {
    const missed = report.missedVerses?.length || 0;
    again.textContent = missed
      ? `Retest the ${missed} you missed`
      : 'Climb Again';
  }
}

// ---------- Item 3: share card ----------
// `shareGrid` was fully implemented and unit-tested but `#btn-daily-share` was
// hidden on entry and never un-hidden, so no player could ever reach it.
// Wherever this copy happens to be served from — GitHub Pages, a local server,
// somebody's fork. A share with no link is a dead end.
function gameUrl() {
  try {
    const { origin, pathname } = window.location;
    if (!origin || origin === 'null') return '';
    return (origin + pathname).replace(/index\.html$/, '');
  } catch { return ''; }
}

function shareText(withUrl = true) {
  const out = (session?.questions || []).map((q) => q._outcome);
  const total = out.length || 1;
  const right = (session?.questions || []).filter((q) => q._correct).length;
  const pct = Math.round((right / total) * 100);
  const grid = shareGrid(out, total);
  const title = lastRunMode === 'daily'
    ? `Sound Doctrine — Daily Quest ${dailySeed(new Date())}`
    : lastRunMode === 'hero'
      ? `Sound Doctrine — ${HEROES[session?.hero]?.name || 'Hero'} run`
      : 'Sound Doctrine — Ladder climb';
  const streak = player.streak ? ` · 🔥 ${player.streak}-day streak` : '';
  // A scoreline alone told a reader nothing about the game and gave them no way
  // in. The quip carries the flavour, the invitation carries the link.
  const quip = shareQuip(right / total);
  const url = gameUrl();
  const invite = lastRunMode === 'daily'
    ? 'Same questions for everyone today — your turn:'
    : 'Think you know 1 & 2 Timothy and Titus better?';
  // The share sheet renders a `url` field better than a pasted link, so it is
  // held back there and folded in only for the clipboard fallback.
  const tail = (withUrl && url) ? `\n${invite}\n${url}` : `\n${invite}`;
  return `${title}\n${grid}\n${right}/${total} · ${pct}%${streak}\n\n${quip}${tail}`;
}

async function doShare(btn) {
  const url = gameUrl();
  try {
    if (navigator.share) {
      await navigator.share(url
        ? { title: 'Sound Doctrine', text: shareText(false), url }
        : { title: 'Sound Doctrine', text: shareText(false) });
      return;
    }
    await navigator.clipboard.writeText(shareText(true));
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = old; }, 1600);
  } catch { /* user dismissed the sheet — nothing to do */ }
}

// ---------- Mastery (lifetime, across every run) ----------
// storage.js has recorded `lifetimeChapters` since the first commit and nothing
// ever read it. The report's Mastery Map is session-scoped (it says "100% on
// 1 Timothy" after two questions and resets each run); this is the cumulative one.
function renderMastery() {
  const sum = masterySummary(player.lifetimeChapters || {});
  el('mastery-summary').innerHTML = `
    <div class="mastery-headline"><strong>${sum.mastered}</strong> of ${sum.total} chapters mastered</div>
    <div class="mastery-sub">${sum.started} of ${sum.total} begun · ${(player.totalAnswered || 0).toLocaleString()} questions answered all-time</div>
    <div class="mastery-track"><div class="mastery-track-fill" style="width:${Math.round((sum.mastered / sum.total) * 100)}%"></div></div>`;

  const masteryRows = sum.rows.map((r) => {
    const pct = Math.round(r.acc * 100);
    const cls = r.mastered ? 'mastered' : r.started ? 'started' : 'untouched';
    const label = r.started ? `${pct}%` : '—';
    const meta = r.started ? `${r.correct}/${r.asked}` : 'not yet begun';
    return `<div class="mastery-cell ${cls}">
      <div class="mastery-cell-head"><span class="mastery-cell-name">${esc(r.name)}</span>${r.mastered ? '<span class="mastery-badge">✦</span>' : ''}</div>
      <div class="mastery-cell-bar"><span style="width:${pct}%"></span></div>
      <div class="mastery-cell-meta"><b>${label}</b> <span>${meta}</span></div>
    </div>`;
  }).join('');
  el('mastery-grid').innerHTML = masteryRows;
  // Item 2: cascade the 13 chapters rather than painting them all at once.
  staggerIn(document.querySelectorAll('#mastery-grid .mastery-cell'), { stagger: 0.035, y: 12 });
  growBar(el('mastery-summary')?.querySelector('.mastery-track-fill'),
    (sum.mastered / sum.total) * 100, { delay: 0.1 });
  document.querySelectorAll('#mastery-grid .mastery-cell-bar span').forEach((bar, i) => {
    const pct = parseFloat(bar.style.width) || 0;
    growBar(bar, pct, { delay: 0.1 + i * 0.03 });
  });
}

// ---------- Leaderboard ----------
function renderLeaderboard() {
  // Item 6: Flip records where every row sits, lets the re-render reorder them,
  // then animates each row from its old box to its new one — so climbing the
  // board is something you watch happen instead of a silent re-paint.
  flipList(el('lb-list'), () => {
    const rows = sortLeaderboard(loadLeaderboard());
    el('lb-list').innerHTML = rows.length
      ? rows.map((r, i) => {
          const isMe = r.name === player.name;
          // Display the SAME score the sort used — these used to be two different
          // formulas, so row #1 could show a lower number than row #2.
          const s = leaderboardScore(r);
          const acc = Math.round((s.acc || 0) * 100);
          return `<div class="lb-row ${isMe ? 'me' : ''}" data-flip-id="${esc(r.name)}">
            <span class="lb-rank">${s.provisional ? '\u2013' : i + 1}</span>
            <span class="lb-name">${esc(r.name)}${s.provisional ? '<span class="lb-prov">provisional</span>' : ''}</span>
            <span class="lb-rank-title">${esc(rankOf(s.score))}</span>
            <span class="lb-stats">\uD83D\uDD25 ${r.streak || 0} \u00B7 ${acc}% \u00B7 ${(r.totalAnswered || 0)} answered</span>
            <span class="lb-score">\u269C ${s.score.toLocaleString()}</span>
          </div>`;
        }).join('')
          : '<p class="empty">No charges yet. Be the first onto the board.</p>';
  });
  // (Re)opening the local board resets to this tab and drops any Daily subscription
  // so a stale realtime channel or a previous Daily view can't bleed into the feed.
  el('lb-daily')?.classList.add('hidden');
  el('lb-list')?.classList.remove('hidden');
  clearDailySub();
  document.querySelectorAll('.lb-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'local'));
}

// ---------- Daily-Quest (Supabase) leaderboard ----------
// Local-first: when Supabase isn't configured (SUPABASE_READY false) the Daily tab
// shows an explanatory empty state and every helper below is a no-op.
function clearDailySub() {
  if (dailySub) { try { dailySub(); } catch (e) { /* unsubscribe best-effort */ } dailySub = null; }
}
function filterDailyRange(rows, range) {
  const today = new Date().toISOString().slice(0, 10);
  const wk = new Date(); wk.setDate(wk.getDate() - 7);
  const yr = new Date(); yr.setFullYear(yr.getFullYear() - 1);
  const weekAgo = wk.toISOString().slice(0, 10);
  const yearAgo = yr.toISOString().slice(0, 10);
  return rows
    .filter((r) => {
      if (range === 'all') return true;
      if (range === 'day') return r.date === today;
      if (range === 'week') return r.date >= weekAgo;
      if (range === 'year') return r.date >= yearAgo;
      return true;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}
function renderDailyLeaderboard() {
  const list = el('lb-daily-list');
  if (!list) return;
  if (!SUPABASE_READY) return; // the offline empty-state is set by openDailyLeaderboard()
  const rows = filterDailyRange(dailyLbCache || [], dailyActiveRange).slice(0, 60);
  list.innerHTML = rows.length
    ? rows.map((r, i) => `<div class="lb-row" data-flip-id="${esc(r.name)}">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${esc(r.name)}</span>
        <span class="lb-rank-title">${esc(rankOf(r.score || 0))}</span>
        <span class="lb-stats">🔥 ${r.streak || 0} · ${(r.answered || 0)} answered</span>
        <span class="lb-score">⚜ ${(r.score || 0).toLocaleString()}</span>
      </div>`).join('')
    : '<p class="empty">No daily scores yet. Be the first to climb today!</p>';
}
async function refreshDailyLb() {
  dailyLbCache = await loadDailyLeaderboard('all');
  renderDailyLeaderboard();
}
async function openDailyLeaderboard() {
  el('lb-list').classList.add('hidden');
  el('lb-daily')?.classList.remove('hidden');
  el('lb-daily-list').innerHTML = SUPABASE_READY
    ? '<p class="empty">Loading daily scores…</p>'
    : '<p class="empty">Connect Supabase (fill in <code>supabase.config.js</code>) to track Daily-Quest scores online.</p>';
  if (!SUPABASE_READY) return;
  const client = await getSupabaseClient();
  if (!client) {
    el('lb-daily-list').innerHTML = '<p class="empty">Supabase could not initialize. The Daily board stays local.</p>';
    return;
  }
  dailyLbCache = await loadDailyLeaderboard('all') || [];
  clearDailySub();
  dailySub = subscribeDailyScore(() => { refreshDailyLb(); }, client);
  renderDailyLeaderboard();
}
function leaveDailyLeaderboard() {
  el('lb-daily')?.classList.add('hidden');
  el('lb-list')?.classList.remove('hidden');
  clearDailySub();
}

// ---------- Profile ----------
function renderProfile() {
  const sum = masterySummary(player.lifetimeChapters || {});
  el('profile-stats').innerHTML = `
    <div class="profile-card">
      <div class="p-name">${esc(player.name)}</div>
      <div class="p-rank">${rankOf(rankPoints())}</div>
      <div class="p-grid">
        <div><b>⚜ ${rankPoints().toLocaleString()}</b> lifetime score</div>
        <div><b>${player.streak || 0}</b> day streak</div>
        <div><b>${player.bestStreak || 0}</b> best streak</div>
        <div><b>${sum.mastered}/${sum.total}</b> chapters mastered</div>
        <div><b>${player.totalAnswered || 0}</b> answered</div>
        <div><b>${player.totalCorrect || 0}</b> correct</div>
        <div><b>T${player.entryTier || 1}</b> entry tier</div>
      </div>
      ${player.weakSubjects?.length ? `<div class="p-weak"><b>Weak spots:</b> ${esc(player.weakSubjects.join(', '))}</div>` : ''}
    </div>`;
}

// ---------- Wire up ----------
// The title screen is the single opening page on first visit; returning players
// skip straight to the Candle home (see init() below).

// Home header now just opens Settings; sound/music controls live there.
// Keep a tiny shim so old callers (tests) don't crash — Settings is the new source of truth.
function applySoundIcon() {
  const b = el('btn-sound');
  if (!b) return;
  // gear is static; no state to reflect here
  b.textContent = '⚙️';
}

el('btn-begin').addEventListener('click', () => {
  const name = el('input-name').value.trim();
  if (!name) { el('input-name').focus(); return; }
  player.name = name;
  if (!player.createdAt) player.createdAt = Date.now();
  if (player.hearts === undefined) player.hearts = MAX_HEARTS;
  savePlayer(player);
  renderCandle();
  showScreen('screen-home');
});
el('btn-how').addEventListener('click', () => showScreen('screen-how'));
el('btn-how-back').addEventListener('click', () => showScreen('screen-start'));
el('btn-leaderboard').addEventListener('click', () => { renderLeaderboard(); showScreen('screen-lb'); });
el('btn-lb2').addEventListener('click', () => { renderLeaderboard(); showScreen('screen-lb'); });

// Daily-Quest leaderboard tabs: local All-time vs. Supabase Daily Quest feed.
document.querySelectorAll('.lb-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lb-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tab === 'daily') openDailyLeaderboard();
    else leaveDailyLeaderboard();
  });
});
document.querySelectorAll('.lb-dtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lb-dtab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    dailyActiveRange = btn.dataset.ddb || 'all';
    renderDailyLeaderboard();
  });
});
el('btn-lb-back').addEventListener('click', () => {
  // A new player (no name yet) came from the start screen; Back returns there with the name input.
    // A returning player (name set) came from the candle home; Back returns to the game modes.
  clearDailySub(); // drop any Daily-Quest Realtime subscription before leaving the board
  showScreen(player.name ? 'screen-home' : 'screen-start');
});
el('btn-climb').addEventListener('click', () => startClimb());
el('btn-daily-card')?.addEventListener('click', () => startDaily());
el('btn-daily-start').addEventListener('click', () => beginDailyList());
el('btn-daily-back').addEventListener('click', () => showScreen('screen-home'));
el('btn-next').addEventListener('click', btnNextGo);

// Choose Your Hero
el('btn-hero-card')?.addEventListener('click', openHeroSelect);
el('btn-hero-back')?.addEventListener('click', () => showScreen('screen-home'));
document.querySelectorAll('.hero-card[data-hero]').forEach((btn) => {
  btn.addEventListener('click', () => startHero(btn.dataset.hero));
});

// Oil-vial power-ups
el('pu-skip').addEventListener('click', () => usePowerup('skip'));
el('pu-5050').addEventListener('click', () => usePowerup('5050'));
el('pu-freeze').addEventListener('click', () => usePowerup('freeze'));
// A retest is the more useful climb when the last run left misses behind; with
// nothing to retest, startRetest falls through to a fresh climb anyway.
el('btn-again').addEventListener('click', () => {
  if (lastReport?.missedVerses?.length) startRetest();
  else startClimb();
});
el('btn-home').addEventListener('click', () => { renderCandle(); showScreen('screen-home'); });
el('btn-profile-head').addEventListener('click', () => { renderProfile(); showScreen('screen-profile'); });
el('btn-profile-back').addEventListener('click', () => showScreen('screen-home'));
el('btn-settings')?.addEventListener('click', () => openSettings());
el('btn-settings-back')?.addEventListener('click', () => showScreen('screen-home'));

// Sign out: keep history, clear the active name, return to the start screen.
el('btn-profile-signout').addEventListener('click', () => {
  signOutPlayer();
  location.reload(); // fresh start screen
});

// Delete account: fully wipe this player's profile + leaderboard row, with confirmation.
el('btn-profile-delete').addEventListener('click', () => {
  const name = player.name;
  const ok = window.confirm(`Delete ${name ? '\u201C' + name + '\u201D' : 'this account'} for good?\nThis clears all progress, score, and the leaderboard entry. This cannot be undone.`);
  if (!ok) return;
  localStorage.removeItem('sd_tutorial_done'); // let a fresh player see the tutorial again
  deletePlayer(name);
  location.reload();
});
// Exit a climb mid-run (abandons, returns home — no penalty beyond the exit)
el('btn-exit').addEventListener('click', () => {
  stopTimer();
  // Clear any modal/pending state so quitting mid-question can't leave a stale
  // backdrop over the home screen or a stuck _pending lock.
  document.getElementById('feedback-modal-backdrop')?.remove();
  document.getElementById('stake-modal-backdrop')?.remove();
  _pending = null;
  // Half a climb still counts as having climbed — the unlock gate should never
  // be able to strand a player who tried.
  if (mode === 'ladder' && session?.questions?.length >= 5 && !player.ladderPlayed) {
    player.ladderPlayed = true;
    savePlayer(player);
  }
  renderCandle();
  showScreen('screen-home');
});

// Share (report + the Daily screen's own button)
el('btn-report-share')?.addEventListener('click', (e) => doShare(e.currentTarget));
el('btn-daily-share')?.addEventListener('click', (e) => doShare(e.currentTarget));

// Retest — replays exactly what you just missed

// Lifetime mastery
el('btn-mastery')?.addEventListener('click', () => { renderMastery(); showScreen('screen-mastery'); });
el('btn-mastery-back')?.addEventListener('click', () => { renderCandle(); showScreen('screen-home'); });

// ---------- Item 1: installable PWA ----------
// A web game with no install path and no offline shell relies on players
// remembering the URL. Registering the worker enables both.
let deferredInstall = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
  });
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  el('home-install')?.classList.remove('hidden');
});
el('btn-install')?.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null;
  el('home-install')?.classList.add('hidden');
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  el('home-install')?.classList.add('hidden');
});

async function init() {
  try {
    await loadBank();
  } catch (e) {
    el('btn-begin').disabled = true;
    document.querySelector('.tagline')?.replaceWith(Object.assign(document.createElement('p'), {
      textContent: 'Could not load the question bank. Please refresh.',
      className: 'tagline error',
    }));
    return;
  }
  if (player.hearts === undefined) player.hearts = MAX_HEARTS;
  if (player.name) {
    renderCandle();
    showScreen('screen-home');
  } else {
    // First-visit: straight to the title screen (name entry). Mechanics are taught
    // in-context by the first-climb spotlight tutorial, not by a separate lore page.
    showScreen('screen-start');
  }
}

// ---------- Settings (sound, music, motion, haptics) ----------
const LS_REDUCED = 'sd_reduced_motion';
const LS_HAPTICS = 'sd_haptics';

function applyReducedMotion(on) {
  document.documentElement.classList.toggle('reduce-motion', !!on);
}

function haptics(kind) {
  if (localStorage.getItem(LS_HAPTICS) === '0') return;
  if (!('vibrate' in navigator)) return;
  if (kind === 'correct') navigator.vibrate(22);
  else if (kind === 'wrong') navigator.vibrate([30, 40, 30]);
  else if (kind === 'tick') navigator.vibrate(10);
}

function renderSettings() {
  const els = elsSettings();
  if (!els.sfx) return;
  const sfxOn = sfx.isSfxEnabled();
  const musicOn = sfx.isMusicEnabled();
  const reduced = localStorage.getItem(LS_REDUCED) === '1';
  const hap = localStorage.getItem(LS_HAPTICS) !== '0'; // default on
  els.sfx.checked = sfxOn;
  els.music.checked = musicOn;
  els.sfxVol.value = String(Math.round(sfx.getSfxVolume() * 100));
  els.musicVol.value = String(Math.round(sfx.getMusicVolume() * 100));
  els.sfxVolLabel.textContent = els.sfxVol.value + '%';
  els.musicVolLabel.textContent = els.musicVol.value + '%';
  els.reduced.checked = reduced;
  els.haptics.checked = hap;
  els.sfxVol.disabled = !sfxOn;
  els.musicVol.disabled = !musicOn;
  els.sfxVolLabel.style.opacity = sfxOn ? '1' : '.45';
  els.musicVolLabel.style.opacity = musicOn ? '1' : '.45';
  const reducedLabel = document.querySelector('label[for="set-reduced-motion"]');
  if (reducedLabel) reducedLabel.closest('.settings-row')?.classList.toggle('on', reduced);
}

function elsSettings() {
  return {
    sfx: document.getElementById('set-sfx'),
    sfxVol: document.getElementById('set-sfx-vol'),
    sfxVolLabel: document.getElementById('set-sfx-vol-label'),
    music: document.getElementById('set-music'),
    musicVol: document.getElementById('set-music-vol'),
    musicVolLabel: document.getElementById('set-music-vol-label'),
    reduced: document.getElementById('set-reduced-motion'),
    haptics: document.getElementById('set-haptics'),
  };
}

function bindSettings() {
  const e = elsSettings();
  if (!e.sfx || e.sfx.dataset.bound) return;
  e.sfx.dataset.bound = '1';

  e.sfx.addEventListener('change', () => {
    sfx.setSfxEnabled(e.sfx.checked);
    renderSettings();
    if (e.sfx.checked) sfx.correct();
    haptics('correct');
  });
  e.sfxVol.addEventListener('input', () => {
    sfx.setSfxVolume(Number(e.sfxVol.value) / 100);
    e.sfxVolLabel.textContent = e.sfxVol.value + '%';
  });
  e.music.addEventListener('change', () => {
    sfx.setMusicEnabled(e.music.checked);
    renderSettings();
    if (e.music.checked) {
      // Start music immediately on explicit enable (counts as user gesture).
      music.start();
    }
  });
  e.musicVol.addEventListener('input', () => {
    sfx.setMusicVolume(Number(e.musicVol.value) / 100);
    e.musicVolLabel.textContent = e.musicVol.value + '%';
    // If music is enabled, ensure it is playing so the volume change is audible.
    if (sfx.isMusicEnabled()) music.start();
  });
  e.reduced.addEventListener('change', () => {
    localStorage.setItem(LS_REDUCED, e.reduced.checked ? '1' : '0');
    applyReducedMotion(e.reduced.checked);
  });
  e.haptics.addEventListener('change', () => {
    localStorage.setItem(LS_HAPTICS, e.haptics.checked ? '1' : '0');
    if (e.haptics.checked) haptics('correct');
  });
}

function openSettings() {
  renderSettings();
  bindSettings();
  showScreen('screen-settings');
}

// Try to start music after any first real gesture (autoplay policy needs it).
let musicPrimed = false;
function primeMusicOnce() {
  if (musicPrimed) return;
  musicPrimed = true;
  if (sfx.isMusicEnabled()) music.start();
  window.removeEventListener('click', primeMusicOnce);
  window.removeEventListener('keydown', primeMusicOnce);
  window.removeEventListener('touchstart', primeMusicOnce);
}
window.addEventListener('click', primeMusicOnce, { once: true });
window.addEventListener('keydown', primeMusicOnce, { once: true });
window.addEventListener('touchstart', primeMusicOnce, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) music.stop();
  else if (sfx.isMusicEnabled()) music.start();
});

init();
applyReducedMotion(localStorage.getItem(LS_REDUCED) === '1');
bindSettings();

// ---------- Title-screen art upgrade ----------
// When generated art exists (assets/hero-*.png full-body characters,
// assets/start-bg-portrait.jpg phone background, assets/start-bg-landscape.jpg
// tablet/landscape background), the title screen and hero-select upgrade to it
// automatically; otherwise the mascot GIFs and the gradient fallback stay in
// place. A missing file simply never fires onload, so each piece upgrades
// independently and nothing breaks when only some of the art exists.
function upgradeHeroArt() {
  const start = el('screen-start');
  // Probe the SAME file CSS will paint (image-set prefers .webp), so the existence
  // check doesn't pull a second copy. Probing the .jpg here meant every load
  // fetched both formats — which is what defeated the WebP conversion.
  const landscape = window.matchMedia('(orientation: landscape)').matches;
  const bg = new Image();
  bg.onload = () => {
    start?.classList.add('has-bg');
    if (landscape) document.body.classList.add('art-landscape');
    else start?.classList.add('bg-portrait');
  };
  bg.src = landscape ? 'assets/start-bg-landscape.webp' : 'assets/start-bg-portrait.webp';
}

// Full-body hero art on the Hero-select screen. Deferred until that screen opens:
// probing at startup pulled ~2 MB of hero art for a screen most sessions never see,
// and (because the probe assigned .png to img.src) it also overrode the WebP that
// <picture> had already chosen on the title and home screens.
function upgradeHeroSelectArt(root) {
  root?.querySelectorAll('img[data-full]').forEach((img) => {
    const probe = new Image();
    probe.onload = () => {
      img.src = img.dataset.full;
      (img.closest('.hero-art') || img.closest('.mascot-duo-member'))?.classList.add('fullbody');
      delete img.dataset.full;
    };
    probe.src = img.dataset.full;
  });
}

upgradeHeroArt();

// ---------- Tutorial for first-time players ----------
// Interactive spotlight walkthrough shown over the real game screen on the first climb.
// Each step highlights a live element (hearts, timer, options, flame, power-ups) with a
// crisp tip. Correct, current content (bids were removed) + a Skip for returning players.
function showTutorial() {
  if (localStorage.getItem('sd_tutorial_done')) return;
  if (!currentQ) return; // require a live question to spotlight
  tutorialPaused = true; // hold the countdown while the tutorial is visible

  const backdrop = document.createElement('div');
  backdrop.id = 'tutorial-backdrop';
  backdrop.className = 'tutorial-backdrop';

  const steps = [
    {
      target: '#hud-hearts',
      place: 'below',
      h3: 'Your Lamps',
      p: 'You carry <strong>5 lives</strong>. A wrong answer or a timed-out question costs one. Answer well to reach the hardest rungs.',
    },
    {
      target: '#ring-label',
      place: 'below',
      h3: 'The Clock',
      p: 'This ring <strong>counts down</strong>. The further you climb, the less time you get. Answer before it empties.',
    },
    {
      target: '#q-options',
      place: 'above',
      h3: 'Answer Now',
      p: 'Tap an option. Every answer — right <em>or</em> wrong — shows you the very verse that settles it, with its reference.',
    },
    {
      target: '#powerups',
      place: 'below',
      h3: 'Power-ups',
      p: 'Each lifeline is a <strong>one-time</strong> use per game: <strong>Skip</strong> a question, cut it to <strong>50/50</strong>, or <strong>Freeze</strong> the clock for 5 seconds.',
    },
    {
      target: '#hud-score',
      place: 'below',
      h3: 'Confidence × Multiplier',
      p: 'Choosing an option asks <strong>how sure</strong> you are, from 1× Safe up to 5× Preach It. A <strong>correct</strong> answer multiplies your points, but a <strong>wrong</strong> one costs that same amount — press on in faith, and near-misses keep half (Grace).',
    },
  ];

  const tip = document.createElement('div');
  tip.className = 'tutorial-tip';
  const spot = document.createElement('div');
  spot.className = 'tutorial-spot';
  backdrop.appendChild(spot);
  backdrop.appendChild(tip);

  const dots = document.createElement('div');
  dots.className = 'tutorial-dots';
  backdrop.appendChild(dots);

  document.body.appendChild(backdrop);

  let idx = 0;

  function layout() {
    const target = document.querySelector(steps[idx].target);
    if (!target) { finish(); return; }
    const r = target.getBoundingClientRect();
    // Position + size the spotlight hole on the target (top-left origin).
    spot.style.left = (r.left - 6) + 'px';
    spot.style.top = (r.top - 6) + 'px';
    spot.style.width = (r.width + 12) + 'px';
    spot.style.height = (r.height + 12) + 'px';

    // Place the tip card near the target (above/below), within the viewport,
    // and never under the Skip button (top-right).
    const tipW = 300;
    let tx = Math.max(16, Math.min((r.left + r.width / 2 - tipW / 2), (window.innerWidth - tipW - 16)));
    tip.style.left = tx + 'px';
    if (steps[idx].place === 'below') tip.style.top = (r.bottom + 12) + 'px';
    else {
      // above: keep at least 56px from the top so it clears the Skip button
      tip.style.top = Math.max(70, (r.top - tip.offsetHeight - 12)) + 'px';
    }
  }

  function drawDots() {
    dots.innerHTML = steps.map((_, i) => `<span class="${i === idx ? 'on' : ''}"></span>`).join('');
  }

  function render() {
    const s = steps[idx];
    tip.innerHTML = `<h3>${s.h3}</h3><p>${s.p}</p>
      <div class="tutorial-tip-btns">
        <button class="primary" id="tut-now">Skip</button>
        <button class="primary" id="tut-next2">${idx === steps.length - 1 ? 'Done' : 'Next'}</button>
      </div>`;
    layout();
    drawDots();
    document.getElementById('tut-next2').onclick = () => {
      if (idx >= steps.length - 1) finish();
      else { idx++; render(); }
    };
    document.getElementById('tut-now').onclick = finish;
  }

  function finish() {
    localStorage.setItem('sd_tutorial_done', '1');
    tutorialPaused = false; // resume the countdown
    backdrop.remove();
  }

  window.addEventListener('resize', layout);
  render();
}






