// app.js — Sound Doctrine shell: wires game-core + storage to the DOM.
// Duolingo-style: countdown timer (bonus time on correct), kind hearts, color-coded
// options, juicy micro-interactions. Content stays scripturally verified.
import {
  TIER_NAMES, TIER_EMOJI, BIDS, BASE_POINTS, MAX_STREAK, MAX_HEARTS,
  STREAK_MILESTONE, LADDER_LENGTH, DAILY_LENGTH,
  timeForTier, timeForQuestion, bonusTime,
  dailyCharge, dailySeed, resolveAnswer, tierOf,
  pickNextLadder, applyDailyVisit, buildChargeReport, leaderboardScore,
  sortLeaderboard, shareGrid, shuffle, mulberry32, hashCode,
  heroRun, HEROES, candleMeltFraction,
  rankOf, rankProgress, retestRun, masterySummary,
  msUntilDailyReset, formatCountdown,
} from './game-core.js';
import {
  loadPlayer, savePlayer, recordCharge, updateLeaderboard,
  loadLeaderboard, syncLeaderboardToSupabase, signOutPlayer, deletePlayer,
} from './storage.js';
import { sfx } from './sound.js';

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
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  el(id).classList.remove('hidden');
  // Painted title scene (generated art) spans the viewport only while the title screen is up.
  document.body.classList.toggle('on-start', id === 'screen-start');
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

// ---------- Candle ----------
const CANDLE_IMGS = {
  lit: 'assets/candle-lit.png',
  guttering: 'assets/candle-guttering.png',
  smouldering: 'assets/candle-smouldering.png',
};
const CANDLE_CAPTIONS = {
  lit: 'Your lamp is lit',
  guttering: 'The flame gutters — climb to feed it',
  smouldering: 'The wick smoulders — climb to relight it',
};

function candleState() {
  const streak = player.streak || 0;
  const oil = player.oilVials || 0;
  if (streak >= 1 && oil > 0) return 'lit';
  if (streak >= 1 || oil > 0) return 'guttering';
  return 'smouldering';
}

// Apply the day's melt to the home candle: --melt (0..1) for any JS math and
// --melt-top (%) = how much of the candle body is clipped from the top. The
// 6% floor always masks the tiny flame baked into the candle art so the CSS
// flame below is the only flame shown; at night the melt reaches ~72%, leaving
// a short stub that a fresh dawn (melt resets) replaces.
function applyCandleMelt(stage) {
  const melt = candleMeltFraction(new Date());
  stage.style.setProperty('--melt', melt.toFixed(3));
  stage.style.setProperty('--melt-top', `${(6 + melt * 66).toFixed(1)}%`);
}

function renderCandle() {
  el('home-name').textContent = player.name || '—';
  el('home-rank').textContent = rankOf(rankPoints());
  el('streak-num').textContent = player.streak || 0;
  renderRankProgress();
  renderDailyCountdown();

  // New-player gating: Daily Quest + Choose Your Hero unlock after a Ladder climb.
  const ladderDone = !!player.ladderPlayed;
  el('daily-card')?.classList.toggle('locked', !ladderDone);
  el('hero-card')?.classList.toggle('locked', !ladderDone);

  // The candle melts through the day (browser clock), fresh again each dawn.
  applyCandleMelt(el('candle-stage'));

  const state = candleState();
  el('candle-stage').dataset.state = state;
  el('candle-img').src = CANDLE_IMGS[state];
  el('candle-caption').textContent = CANDLE_CAPTIONS[state];
  renderLadder();
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
  if (fill) fill.style.width = `${Math.round(rp.pct * 100)}%`;
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

// Keep the candle's melt in sync with the wall clock while the page stays open
// (a long-lived home screen shouldn't freeze at morning forever). Light touch:
// refresh every 5 minutes — the burn is imperceptible in between.
function setupCandleClock() {
  setInterval(() => {
    const stage = el('candle-stage');
    if (!stage) return;
    applyCandleMelt(stage);
  }, 5 * 60 * 1000);
  // The reset countdown ticks once a minute while the home screen is visible.
  setInterval(() => {
    if (!el('screen-home')?.classList.contains('hidden')) renderDailyCountdown();
  }, 60 * 1000);
}

function renderLadder() {
  const wrap = el('ladder-rungs');
  if (!wrap) return;
  wrap.innerHTML = '';
  const current = Math.min(7, Math.max(1, player.entryTier || 1));
  for (let t = 7; t >= 1; t--) {
    const row = document.createElement('div');
    row.className = `ladder-rung${t === current ? ' you' : ''}${t < current ? ' passed' : ''}`;
    row.dataset.tier = String(t);
    row.innerHTML = `<span class="rung-dot" aria-hidden="true"></span><span class="rung-capsule">T${t} — ${TIER_NAMES[t]}</span>${t === current ? '<span class="rung-you">🔥YOU</span>' : ''}`;
    wrap.appendChild(row);
  }
}

// ---------- Session setup ----------
function resetSession() {
  // A new game always starts afresh: full lives, empty session, cleared per-question state.
  setHearts(MAX_HEARTS);
  session = { questions: [], pot: 0, elapsedMs: 0, daily: false, oilVialsEarned: 0, bestTimeMs: 0, runTiers: [], maxRunTier: 0, streak: 0 };
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
  el('daily-charge-intro').textContent = `Today's Quest — ${list.length} questions (${today}). Same for everyone, so the board is fair.`;
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
  el('q-type').textContent = heroTypeLabel(q);
}

function finishHero() { finishCommon(); }

// ---------- Countdown timer ----------
// The clock is budgeted per QUESTION now (reading time + tier-scaled thinking
// time), not per tier. A 41-word T7 item used to get a hard 10s floor — less
// than its bare reading time — so the hardest content always timed out.
function startCountdown(q, idxInRun = 0, floorSeconds = 0) {
  stopTimer();
  const ramp = Math.min(1, (idxInRun || 0) / 5);
  timeTotal = Math.max(floorSeconds || 0, timeForQuestion(q, ramp));
  timeLeft = timeTotal;
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
    sfx.tick();
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

// ---------- Question rendering ----------
function renderQuestion(q) {
  frozenUntil = 0; // reset any freeze power-up for the next question
  setMascot(q.book);
  el('q-book').textContent = q.book;
  el('q-subject').textContent = q.subject;
  el('q-type').textContent = `${TIER_EMOJI[q.tier]} T${q.tier} · ${TIER_NAMES[q.tier]}`;
  el('q-prompt').textContent = q.prompt;

  const wrap = el('q-options');
  // Word-order questions (Choose Your Hero) replace the option grid entirely.
  if (q.type === 'wordorder') { renderWordOrder(q); return; }
  const order = shuffle(Math.random, q.options.map((_, i) => i));
  q._displayOrder = order;
  wrap.innerHTML = '';
  wrap.classList.toggle('count-2', q.options.length === 2); // True/False gets the wide look
  const accent = ['a', 'b', 'c', 'd']; // color coding per position
  order.forEach((orig, displayIdx) => {
    const btn = document.createElement('button');
    btn.className = `option opt-${accent[displayIdx]}`;
    btn.textContent = q.options[orig];
    btn.dataset.display = String(displayIdx);
    btn.addEventListener('click', () => onAnswer(displayIdx));
    wrap.appendChild(btn);
  });

  renderStakeRow(q);
  el('q-options').classList.remove('hidden');
  el('feedback').classList.add('hidden');
  el('feedback').classList.remove('correct', 'wrong', 'grace');
  updateProgress();
  renderScore();
  renderTimerBar();

  // Budget follows this question's own reading load and effective tier.
  startCountdown({ ...q, tier: q._runTier || q.tier }, (session?.questions?.length || 0));
  renderPowerups();
}

function updateProgress() {
  let idx, total;
  if (mode === 'daily' || mode === 'hero') {
    const list = mode === 'daily' ? session._dailyList : session._heroList;
    const i = mode === 'daily' ? dailyIdx : heroIdx;
    total = list?.length || 10;
    idx = i + 1; // 1-based current question number
    idx = Math.max(1, Math.min(idx, total));
    el('progress-bar').style.width = `${Math.round((idx / total) * 100)}%`;
    el('hud-progress').textContent = `${idx}/${total}`;
  } else {
    // Fixed-length climb: a real, honest progress bar.
    total = runLength();
    idx = Math.max(1, Math.min(session.questions.length + 1, total));
    el('hud-progress').textContent = `${idx}/${total}`;
    el('progress-bar').style.width = `${Math.round((idx / total) * 100)}%`;
  }
}

// Live score chip: the running pot is always visible in the HUD.
function renderScore() {
  const chip = el('hud-score');
  if (chip) chip.textContent = `⚜ ${session?.pot || 0}`;
}

function nextQuestion() {
  // Progressive difficulty: ramp the effective tier up as the climb progresses.
  // Start at entryTier, gain +1 tier every 4 questions (capped at 7), so the
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
    el('q-type').textContent = `${TIER_EMOJI[rq.tier]} T${rq.tier} · Retest`;
    return;
  }
  const ramp = Math.min(6, Math.floor(qIndex / 4)); // +1 tier each 4 questions, max +6
  const effectiveTier = Math.min(7, (player.entryTier || 1) + ramp);
  const q = pickNextLadder(bank, {
    entryTier: effectiveTier,
    weakSubjects: new Set(player.weakSubjects || []),
  });
  if (!q) { finishClimb(); return; }
  currentQ = q;
  recordRunTier(qIndex, effectiveTier); // track for reward + timer scaling
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
  el('q-type').textContent = `${TIER_EMOJI[q.tier]} T${q.tier} · Daily Quest`;
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
  
  document.getElementById('feedback-modal-continue').onclick = () => {
    // Reaction is already visible; just dismiss together with the modal
    setTimeout(() => {
      backdrop.remove();
      btnNextGo();
    }, 200);
  };
}

// Reward for climbing far: award a bonus at each tier-ramp milestone
// (every 4 questions) and for reaching the hardest tiers.
function checkMilestoneReward() {
  const answered = session.questions.length;
  const tier = currentQ?._runTier || currentQ?.tier || 1;
  let label = '', points = 0;
  if (answered === 4) { label = 'Tier climbed!'; points = 50; }
  else if (answered === 8) { label = 'The ascent!'; points = 100; }
  else if (answered === 12) { label = 'Summit reached!'; points = 200; }
  else if (tier >= 6 && session.maxRunTier <= 6) { label = 'Deep waters!'; points = 150; }
  else if (tier >= 7) { label = 'The hardest rungs!'; points = 250; }
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
  const scale = 1.15 + Math.min(0.5, (streak - 1) * 0.12); // higher streak = bigger flare
  flame.classList.add('bright');
  flame.style.setProperty('--flare-scale', String(scale));
  setTimeout(() => {
    const meter = el('flame-meter');
    if (meter) meter.style.setProperty('--flame-intensity', '1');
    flame.style.removeProperty('--flare-scale');
    flame.classList.remove('bright');
  }, 450);
}

// ---------- Oil-vial power-ups ----------
function oilCount() { return player.oilVials || 0; }
function setOil(n) { player.oilVials = Math.max(0, n); }

// Spend one oil vial; returns true if enough oil was available.
function spendOil() {
  if (oilCount() < 1) return false;
  setOil(oilCount() - 1);
  savePlayer(player);
  return true;
}

// Refresh the power-up buttons' enabled/disabled state + the HUD oil counter.
function renderPowerups() {
  const n = oilCount();
  document.querySelectorAll('.powerup').forEach((b) => {
    // 50/50 is meaningless on word-order questions (there are no options to hide).
    const wordBlock = b.id === 'pu-5050' && currentQ?.type === 'wordorder';
    b.disabled = n < 1 || !timeRunning || wordBlock; // need oil + a live question
  });
  const hud = el('hud-oil');
  if (hud) {
    hud.textContent = `🫗 ${n}`;
    hud.classList.toggle('empty', n < 1);
  }
}

function usePowerup(type) {
  if (!timeRunning || !currentQ) return; // only during a live question
  if (!spendOil()) {
    // No oil — flash the buttons to signal.
    document.querySelectorAll('.powerup').forEach((b) => b.classList.add('no-oil'));
    setTimeout(() => document.querySelectorAll('.powerup').forEach((b) => b.classList.remove('no-oil')), 500);
    return;
  }
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
    // Remove two incorrect options (never the correct one).
    const wrap = el('q-options');
    const btns = [...wrap.querySelectorAll('.option:not(:disabled)')];
    const wrong = btns.map((b, i) => ({ b, oi: Number(b.dataset.display) }))
      .filter((x) => x.oi !== currentQ.correctIndex);
    for (const w of wrong.slice(-2)) w.b.style.visibility = 'hidden';
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
  renderStakeRow(q); // hides itself for word-order
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

// ---------- Answering (single-step: pick a stake inline, then answer) ----------
// The stake used to open a full-screen blurred modal on EVERY question — two
// modal transitions per question, and the stake fed only `session.pot`, which was
// then discarded. The stake row is now inline and sticky across questions, so a
// question costs one tap to answer instead of a tap, a modal and a confirm.
let _pending = null;   // re-entrancy guard so a double-tap can't answer twice
let selectedBid = BIDS[0]; // remembered across questions (default 1× Safe)

function renderStakeRow(q) {
  const wrap = el('stake-row');
  if (!wrap) return;
  // Word order has no options to stake against — it's all-or-nothing.
  if (q.type === 'wordorder') { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = '<span class="stake-row-label">How sure?</span>';
  const opts = document.createElement('div');
  opts.className = 'stake-row-opts';
  BIDS.forEach((bid) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stake-pill' + (bid.mult === selectedBid.mult ? ' active' : '');
    btn.dataset.mult = String(bid.mult);
    btn.setAttribute('aria-pressed', bid.mult === selectedBid.mult ? 'true' : 'false');
    btn.innerHTML = `<span class="stake-pill-mult">${bid.mult}×</span><span class="stake-pill-label">${bid.label}</span>`;
    btn.addEventListener('click', () => {
      selectedBid = bid;
      opts.querySelectorAll('.stake-pill').forEach((b) => {
        const on = Number(b.dataset.mult) === bid.mult;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      updateStakeHint();
    });
    opts.appendChild(btn);
  });
  wrap.appendChild(opts);
  const hint = document.createElement('div');
  hint.className = 'stake-row-hint';
  hint.id = 'stake-row-hint';
  wrap.appendChild(hint);
  updateStakeHint();
}

function updateStakeHint() {
  const hint = el('stake-row-hint');
  if (!hint) return;
  const p = BASE_POINTS * selectedBid.mult;
  hint.textContent = `Correct +${p} · Wrong −${p}`;
}

function onAnswer(displayIdx) {
  if (!timeRunning) return;
  if (_pending) return; // already committing
  _pending = true;
  const q = currentQ;
  const chosenOrig = q._displayOrder[displayIdx];
  stopTimer();
  commitAnswer(displayIdx, chosenOrig, selectedBid);
  _pending = null;
}

function commitAnswer(displayIdx, chosenOrig, bid) {
  const q = currentQ;
  const qWrap = el('q-options');
  const buttons = qWrap.querySelectorAll('.option');

  el('stake-row')?.querySelectorAll('.stake-pill').forEach((b) => { b.disabled = true; });
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
  if (isCorrect) { pulseFlameBright(); sfx.correct(); burstSparkles(8); }
  else if (isGrace) { sfx.grace(); }
  else { sfx.wrong(); }

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

  buttons.forEach((btn) => {
    btn.disabled = true;
    const oi = q._displayOrder[Number(btn.dataset.display)];
    if (oi === q.correctIndex) btn.classList.add('correct');
    if (Number(btn.dataset.display) === displayIdx && !isCorrect && !isGrace) btn.classList.add('wrong');
    if (Number(btn.dataset.display) === displayIdx && isGrace) btn.classList.add('grace');
  });

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
  // A Ladder climb is a fixed 10-question run. It used to be endless and could
  // only end at 0 hearts, which meant a new player had to LOSE five times before
  // Daily Quest and Choose Your Hero unlocked.
  return session.questions.length >= runLength() - 1;
}

// How many questions this run holds.
function runLength() {
  if (mode === 'daily') return session._dailyList?.length || DAILY_LENGTH;
  if (mode === 'hero') return session._heroList?.length || DAILY_LENGTH;
  return session._retestList ? session._retestList.length : LADDER_LENGTH;
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
  if (q.passage && q.verseText) return `\u201C${q.verseText}\u201D`;
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
  if (!session.daily && session.questions.length >= 8) {
    player.oilVials = (player.oilVials || 0) + 1;
  }
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
function finishDaily() { finishCommon(); }

// ---------- Report ----------
function renderReport(report, session) {
  el('report-grade').innerHTML =
    `<div class="grade-big">${report.grade.label}</div>
     <div class="grade-title">${report.grade.title}</div>`;
  el('report-summary').innerHTML = `
    <div class="stat"><span class="stat-num">${report.correct}/${report.answered}</span><span class="stat-label">correct</span></div>
    <div class="stat"><span class="stat-num">${Math.round(report.acc * 100)}%</span><span class="stat-label">accuracy</span></div>
    <div class="stat"><span class="stat-num">⚜ ${report.pot}</span><span class="stat-label">pot</span></div>
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

  // Weakest chapter card
  const weakestEl = el('report-weakest');
  if (weakestEl) {
    const wc = report.weakestChapter;
    if (wc) {
      const pct = Math.round((wc.acc || 0) * 100);
      const versesList = wc.verses && wc.verses.length
        ? `<ul class="weakest-verses">${wc.verses.map((v) => `<li><strong>${v.passage || wc.name}</strong> — &ldquo;${v.text}&rdquo;</li>`).join('')}</ul>`
        : '';
      weakestEl.innerHTML = `<h3>SPECIFIC WEAKNESS: ${wc.name}</h3><div class="weakest-meta">Accuracy: ${pct}% (${Math.round(wc.acc * wc.asked)}/${wc.asked} correct)</div>${versesList}`;
    } else {
      weakestEl.innerHTML = '';
    }
  }

  const rx = report.prescriptions.length
    ? `<h3>How to do better</h3><ul>${report.prescriptions.map((p) => `<li>${p.instruction}</li>`).join('')}</ul>`
    : '<h3>How to do better</h3><p>Keep climbing — seek the harder rungs.</p>';
  el('report-rx').innerHTML = rx;

  // Share is available on every finished run, not just the (previously
  // unreachable) Daily Quest path.
  const share = el('btn-report-share');
  if (share) {
    share.classList.remove('hidden');
    share.textContent = lastRunMode === 'daily' ? 'Share your Daily Quest' : 'Share your result';
  }
  // Retest only makes sense when there was something to get wrong.
  const retest = el('btn-retest');
  if (retest) {
    const missed = report.missedVerses?.length || 0;
    retest.classList.toggle('hidden', missed === 0);
    retest.textContent = missed ? `Take the retest (${missed} missed)` : 'Take the retest';
  }
}

// ---------- Item 3: share card ----------
// `shareGrid` was fully implemented and unit-tested but `#btn-daily-share` was
// hidden on entry and never un-hidden, so no player could ever reach it.
function shareText() {
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
  const streak = player.streak ? `\n🔥 ${player.streak}-day streak` : '';
  return `${title}\n${grid}\n${right}/${total} · ${pct}%${streak}`;
}

async function doShare(btn) {
  const text = shareText();
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
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

  el('mastery-grid').innerHTML = sum.rows.map((r) => {
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
}

// ---------- Leaderboard ----------
function renderLeaderboard() {
  const rows = sortLeaderboard(loadLeaderboard());
  el('lb-list').innerHTML = rows.length
    ? rows.map((r, i) => {
        const isMe = r.name === player.name;
        // Display the SAME score the sort used — these used to be two different
        // formulas, so row #1 could show a lower number than row #2.
        const s = leaderboardScore(r);
        const acc = Math.round((s.acc || 0) * 100);
        return `<div class="lb-row ${isMe ? 'me' : ''}">
          <span class="lb-rank">${s.provisional ? '–' : i + 1}</span>
          <span class="lb-name">${esc(r.name)}${s.provisional ? '<span class="lb-prov">provisional</span>' : ''}</span>
          <span class="lb-stats">🔥 ${r.streak || 0} · ${acc}% · ${(r.totalAnswered || 0)} answered</span>
          <span class="lb-score">⚜ ${s.score.toLocaleString()}</span>
        </div>`;
      }).join('')
    : '<p class="empty">No charges yet. Be the first onto the board.</p>';
}

// ---------- Profile ----------
function renderProfile() {
  const sum = masterySummary(player.lifetimeChapters || {});
  el('profile-stats').innerHTML = `
    <div class="profile-card">
      <div class="p-name">${esc(player.name)}</div>
      <div class="p-rank">${rankOf(rankPoints())}</div>
      <div class="p-grid">
        <div><b>⚜ ${rankPoints().toLocaleString()}</b> lifetime pot</div>
        <div><b>${player.streak || 0}</b> day streak</div>
        <div><b>${player.bestStreak || 0}</b> best streak</div>
        <div><b>${sum.mastered}/${sum.total}</b> chapters mastered</div>
        <div><b>${player.oilVials || 0}</b> oil vials</div>
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

// Sound on/off toggle (persists). Default: on.
function applySoundIcon() {
  const on = sfx.isEnabled();
  const b = el('btn-sound');
  if (b) b.textContent = on ? '🔊' : '🔇';
}
if (localStorage.getItem('sd_muted') === '1') sfx.setEnabled(false);
applySoundIcon();
el('btn-sound')?.addEventListener('click', () => {
  const on = !sfx.isEnabled();
  sfx.setEnabled(on);
  localStorage.setItem('sd_muted', on ? '0' : '1');
  applySoundIcon();
  if (on) sfx.correct(); // confirm sound back on
});

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
el('btn-lb-back').addEventListener('click', () => {
  // A new player (no name yet) came from the start screen; Back returns there with the name input.
  // A returning player (name set) came from the candle home; Back returns to the game modes.
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
el('btn-again').addEventListener('click', startClimb);
el('btn-home').addEventListener('click', () => { renderCandle(); showScreen('screen-home'); });
el('btn-profile-head').addEventListener('click', () => { renderProfile(); showScreen('screen-profile'); });
el('btn-profile-back').addEventListener('click', () => showScreen('screen-home'));

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
el('btn-retest')?.addEventListener('click', startRetest);

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

init();
setupCandleClock(); // keep the home candle melting with the wall clock

// ---------- Title-screen art upgrade ----------
// When generated art exists (assets/hero-*.png full-body characters,
// assets/start-bg-portrait.jpg phone background, assets/start-bg-landscape.jpg
// tablet/landscape background), the title screen and hero-select upgrade to it
// automatically; otherwise the mascot GIFs and the gradient fallback stay in
// place. A missing file simply never fires onload, so each piece upgrades
// independently and nothing breaks when only some of the art exists.
function upgradeHeroArt() {
  document.querySelectorAll('img[data-png]').forEach((img) => {
    const probe = new Image();
    probe.onload = () => {
      img.src = img.dataset.png;
      (img.closest('.hero-art') || img.closest('.mascot-duo-member'))?.classList.add('fullbody');
    };
    probe.src = img.dataset.png;
  });
  const start = el('screen-start');
  // Only fetch the background this orientation will actually use — the old code
  // downloaded both (824 KB) on every load regardless.
  const landscape = window.matchMedia('(orientation: landscape)').matches;
  const bg = new Image();
  bg.onload = () => {
    start?.classList.add('has-bg');
    if (landscape) document.body.classList.add('art-landscape');
    else start?.classList.add('bg-portrait');
  };
  bg.src = landscape ? 'assets/start-bg-landscape.jpg' : 'assets/start-bg-portrait.jpg';
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
      p: 'Spend an <strong>oil vial (🫗)</strong> to <strong>Skip</strong> a question, cut it to <strong>50/50</strong>, or <strong>Freeze</strong> the clock for 5 seconds.',
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