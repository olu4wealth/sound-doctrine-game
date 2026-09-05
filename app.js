// app.js — Sound Doctrine shell: wires game-core + storage to the DOM.
// Duolingo-style: countdown timer (bonus time on correct), kind hearts, color-coded
// options, juicy micro-interactions. Content stays scripturally verified.
import {
  TIER_NAMES, TIER_EMOJI, BIDS, BASE_POINTS, MAX_STREAK, MAX_HEARTS,
  bonusTime, QUESTION_TIME, fiftyFiftyHide, climbTierFor,
  dailyCharge, dailySeed, resolveAnswer, tierOf,
  pickNextLadder, applyDailyVisit, buildChargeReport, compositeScore,
  sortLeaderboard, shareGrid, shuffle, mulberry32, hashCode,
  heroRun, HEROES,
} from './game-core.js';
import {
  loadPlayer, savePlayer, recordCharge, updateLeaderboard,
  loadLeaderboard, syncLeaderboardToSupabase, signOutPlayer, deletePlayer,
} from './storage.js';
import { sfx, music } from './sound.js';

const el = (id) => document.getElementById(id);

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

// Countdown state (per question)
let timeLeft = 0;
let timeTotal = 0;
let timeRunning = false;
let frozenUntil = 0; // timestamp (ms) until which the timer is frozen (power-up)
let tutorialPaused = false; // while true, the countdown doesn't tick (during tutorial)

const RANKS = [
  { req: 0, name: 'Recruit' },
  { req: 300, name: 'Squire' },
  { req: 600, name: 'Deacon' },
  { req: 1000, name: 'Elder in Training' },
  { req: 1500, name: 'Elder' },
  { req: 2000, name: 'Bishop' },
  { req: 2700, name: 'Good Soldier' },
  { req: 3500, name: 'Workman Unashamed' },
  { req: 4500, name: 'Shepherd' },
  { req: 6000, name: 'Crownbearer' },
];

function rankOf(pts) {
  let r = RANKS[0];
  for (const cand of RANKS) if (pts >= cand.req) r = cand;
  return r.name;
}

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

// ---------- Candle ----------
// The home menu now shows a single static, self-contained candle.webp (no CSS
// flame, no melt system, no sprite states). renderCandle only fills the personal
// header data — the flame card itself is static markup in index.html.
function renderCandle() {
  el('home-name').textContent = player.name || '—';
  el('home-rank').textContent = rankOf(player.totalCorrect * BASE_POINTS || 0);
  el('streak-num').textContent = player.streak || 0;

  // New-player gating: Daily Quest + Choose Your Hero unlock after a Ladder climb.
  const ladderDone = !!player.ladderPlayed;
  el('daily-card')?.classList.toggle('locked', !ladderDone);
  el('hero-card')?.classList.toggle('locked', !ladderDone);

  renderLadder();
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
  // A new game always starts afresh: full lives, empty session, cleared per-question state, timer reset to 30s.
  stopTimer();
  timeLeft = 0; timeTotal = 0; frozenUntil = 0;
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
  showScreen('screen-hero');
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
  renderQuestion(q, { hideSubject: true });
  el('q-type').textContent = heroTypeLabel(q);
}

function finishHero() { finishCommon(); }

// ---------- Countdown timer ----------
// Constant base time (QUESTION_TIME) for every question. No carry-over bonus —
// each question always starts at 30s (word-order questions may pass a larger
// floorSeconds so they keep extra reading time, never below 30s).
function startCountdown(tier, idxInTier = 0, floorSeconds = 0) {
  stopTimer();
  timeTotal = Math.max(floorSeconds || 0, QUESTION_TIME);
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

// ---------- Question rendering ----------
function renderQuestion(q, opts = {}) {
  frozenUntil = 0; // reset any freeze power-up for the next question
  setMascot(q.book);
  el('q-book').textContent = q.book;
  // The subject/area chip can hint at the correct answer (e.g. a hero-mode
  // question labeled "faithfulness of God"), so it is hidden for modes where
  // the prompt alone must carry the clue.
  el('q-subject').textContent = opts.hideSubject ? '' : q.subject;
  el('q-subject').classList.toggle('hidden', !!opts.hideSubject);
  el('q-type').textContent = `${TIER_EMOJI[q.tier]} T${q.tier} · ${TIER_NAMES[q.tier]}`;
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

  // Confidence bids removed: options are always shown immediately.
  el('q-options').classList.remove('hidden');
  el('feedback').classList.add('hidden');
  el('feedback').classList.remove('correct', 'wrong', 'grace');
  updateProgress();
  renderScore();
  renderTimerBar();

  // Timer scales with the effective (ramped) run tier, so harder progress = less time.
  const runTier = q._runTier || q.tier;
  startCountdown(runTier, (session?.questions?.length || 0));
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
    // Endless climb: no fixed cap; show the count climbed and a creeping bar.
    idx = session.questions.length + 1;
    el('hud-progress').textContent = `Q${idx}`;
    // Creep toward full as the climb goes on (never exceeds 100%).
    const pct = Math.min(100, Math.round((idx / 20) * 100));
    el('progress-bar').style.width = `${pct}%`;
  }
}

// Live score chip: the running pot is always visible in the HUD.
function renderScore() {
  const chip = el('hud-score');
  if (chip) chip.textContent = `⚜ ${session?.pot || 0}`;
}

function nextQuestion() {
  // Progressive difficulty: ramp the effective tier up as the climb progresses.
  // climbTierFor always starts at T1 and rises +1 tier every 4 questions (capped at 7), so the
  // further you climb the harder it gets — a real ladder.
  const qIndex = session.questions.length; // 0-based before this question
  const effectiveTier = climbTierFor(qIndex);
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
  // Word order needs time to read: ~2.2s per word, minimum 24s.
  startCountdown(q.tier || 5, session?.questions?.length || 0, Math.max(24, Math.round(q.words.length * 2.2)));
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

// ---------- Answering (D3 two-step: answer → stake → commit) ----------
let _pending = null; // { displayIdx, chosenOrig }

function onAnswer(displayIdx) {
  if (!timeRunning) return;
  if (_pending) return; // already pending a stake
  const q = currentQ;
  const chosenOrig = q._displayOrder[displayIdx];
  _pending = { displayIdx, chosenOrig };
  // Pause the clock while the stake card is up (player has already chosen knowledge)
  stopTimer();
  // Dim the chosen option to show selection, but keep all enabled until stake commits
  const qWrap = el('q-options');
  qWrap.querySelectorAll('.option').forEach((btn) => {
    btn.classList.toggle('pending', Number(btn.dataset.display) === displayIdx);
  });
  showStakeCard(q, displayIdx, chosenOrig);
}

function showStakeCard(q, displayIdx, chosenOrig) {
  const old = document.getElementById('stake-modal-backdrop');
  if (old) old.remove();
  const chosenText = q.options[chosenOrig] || '';
  const letter = ['A', 'B', 'C', 'D'][displayIdx] || '?';
  let selectedBid = BIDS[0]; // default 1× Safe

  const backdrop = document.createElement('div');
  backdrop.id = 'stake-modal-backdrop';
  backdrop.className = 'feedback-modal-backdrop stake-backdrop';
  backdrop.innerHTML = `
    <div class="stake-card">
      ${!localStorage.getItem('sd_tutorial_done') ? '<div class="stake-hint">💡 Set your <strong>Confidence</strong> — correct answers earn the multiplier, wrong ones cost it, near-misses keep half.</div>' : ''}
      <div class="stake-head">You chose ${letter} — how sure are you?</div>
      <div class="stake-chosen">&ldquo;${chosenText}&rdquo;</div>
      <div class="stake-options" id="stake-options"></div>
      <div class="stake-preview" id="stake-preview"></div>
      <div class="stake-actions">
        <button class="ghost" id="stake-cancel">Change answer</button>
        <button class="primary" id="stake-confirm">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const optsWrap = backdrop.querySelector('#stake-options');
  const prevEl = backdrop.querySelector('#stake-preview');

  function renderPreview() {
    const p = BASE_POINTS * selectedBid.mult;
    const grace = Math.round(p * 0.5);
    const near = Array.isArray(q.nearIndexes) && q.nearIndexes.includes(chosenOrig);
    const graceLine = near ? ` · Grace (near-miss): +${grace}` : ' · Grace: — (only close distractors)';
    prevEl.textContent = `Correct: +${p}  ·  Wrong: −${p}${graceLine}`;
  }

  BIDS.forEach((bid) => {
    const btn = document.createElement('button');
    btn.className = 'stake-opt' + (bid.mult === selectedBid.mult ? ' active' : '');
    btn.dataset.mult = String(bid.mult);
    btn.innerHTML = `<span class="stake-mult">${bid.mult}×</span> ${bid.label} <span class="stake-pts">+${BASE_POINTS * bid.mult}/−${BASE_POINTS * bid.mult}</span>`;
    btn.addEventListener('click', () => {
      selectedBid = bid;
      optsWrap.querySelectorAll('.stake-opt').forEach((b) => b.classList.toggle('active', Number(b.dataset.mult) === bid.mult));
      renderPreview();
    });
    optsWrap.appendChild(btn);
  });
  renderPreview();

  backdrop.querySelector('#stake-cancel').onclick = () => {
    backdrop.remove();
    _pending = null;
    el('q-options')?.querySelectorAll('.option').forEach((b) => b.classList.remove('pending'));
    // resume the clock from where it was (give at least 5s so stake time doesn't punish)
    timeLeft = Math.max(5, timeLeft);
    timeRunning = true;
    renderTimerBar();
    timerInt = setInterval(() => {
      if (tutorialPaused) { renderTimerBar(); return; }
      if (Date.now() < frozenUntil) { renderTimerBar(); return; }
      timeLeft -= 0.1;
      if (timeLeft <= 0) { timeLeft = 0; stopTimer(); onTimeout(); return; }
      renderTimerBar();
    }, 100);
  };
  backdrop.querySelector('#stake-confirm').onclick = () => {
    backdrop.remove();
    const pending = _pending;
    _pending = null;
    el('q-options')?.querySelectorAll('.option').forEach((b) => b.classList.remove('pending'));
    commitAnswer(pending.displayIdx, pending.chosenOrig, selectedBid);
  };
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
  return false; // endless climb — never "last"; it ends when the player fails
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
function highlightQuotedSafe(text) {
  let h = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // curly quotes — keep the curly glyphs, wrap inner in orange
  h = h.replace(/\u201C([^\u201D]+?)\u201D/g, '\u201C<span class="q-quote">$1</span>\u201D');
  // straight double quotes — convert to curly + wrap
  h = h.replace(/"([^"]+?)"/g, '\u201C<span class="q-quote">$1</span>\u201D');
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
  const earlier = player.streak || 0;
  player = applyDailyVisit(player, dailySeed(new Date()));
  player = { ...player, streak: Math.max(player.streak || 0, earlier) };
  player.bestStreak = Math.max(player.bestStreak || 0, player.streak || 0);
  player = recordCharge(player, session);
  if (!session.daily && session.questions.length >= 8) {
    player.oilVials = (player.oilVials || 0) + 1;
  }
  setHearts(hearts()); // keep hearts as-is (persist below)
  savePlayer(player);

  const rows = updateLeaderboard(player, session);
  syncLeaderboardToSupabase(rows.find((r) => r.name === player.name) || {});

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

  // Weakest chapter card — now lists every missed verse so the player
  // sees the exact passages (KJV) they need to re-read across all books.
  const weakestEl = el('report-weakest');
  if (weakestEl) {
    const wc = report.weakestChapter;
    if (wc) {
      const pct = Math.round((wc.acc || 0) * 100);
      const allMissed = report.missedVerses || [];
      const versesList = allMissed.length
        ? `<ul class="weakest-verses">${allMissed.map((v) => `<li><strong>${v.passage || wc.name}</strong> — &ldquo;${v.text}&rdquo;</li>`).join('')}</ul>`
        : (wc.verses && wc.verses.length
          ? `<ul class="weakest-verses">${wc.verses.map((v) => `<li><strong>${v.passage || wc.name}</strong> — &ldquo;${v.text}&rdquo;</li>`).join('')}</ul>`
          : '');
      weakestEl.innerHTML = `<h3>SPECIFIC WEAKNESS: ${wc.name}</h3><div class="weakest-meta">Accuracy: ${pct}% (${Math.round(wc.acc * wc.asked)}/${wc.asked} correct) — ${allMissed.length} verse${allMissed.length===1?'':'s'} to revisit</div>${versesList}`;
    } else {
      weakestEl.innerHTML = '';
    }
  }
  // Dedicated full missed-verses block (same data, always visible when there are misses)
  const missedEl = el('report-missed');
  if (missedEl) {
    const mv = report.missedVerses || [];
    if (mv.length) {
      missedEl.innerHTML = `<h3>Verses you missed (${mv.length})</h3><ul>${mv.map((v) => `<li><strong>${v.passage}</strong> — &ldquo;${v.text}&rdquo;</li>`).join('')}</ul>`;
    } else {
      missedEl.innerHTML = report.answered ? '<p class="empty">No missed verses — perfect run!</p>' : '';
    }
  }

  const rx = report.prescriptions.length
    ? `<h3>How to do better</h3><ul>${report.prescriptions.map((p) => `<li>${p.instruction}</li>`).join('')}</ul>`
    : '<h3>How to do better</h3><p>Keep climbing — seek the harder rungs.</p>';
  el('report-rx').innerHTML = rx;
}

// ---------- Leaderboard ----------
function renderLeaderboard() {
  const rows = sortLeaderboard(loadLeaderboard());
  el('lb-list').innerHTML = rows.length
    ? rows.map((r, i) => {
        const isMe = r.name === player.name;
        return `<div class="lb-row ${isMe ? 'me' : ''}">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${r.name}</span>
          <span class="lb-stats">🔥 ${r.streak || 0} · ✗ ${r.fails || 0} · ⏱ ${fmtTime(Math.round((r.bestTimeMs || 0) / 1000))}</span>
          <span class="lb-score">${Math.round(r.score)}</span>
        </div>`;
      }).join('')
    : '<p class="empty">No charges yet. Be the first onto the board.</p>';
}

// ---------- Profile ----------
function renderProfile() {
  el('profile-stats').innerHTML = `
    <div class="profile-card">
      <div class="p-name">${player.name}</div>
      <div class="p-rank">${rankOf(player.totalCorrect * BASE_POINTS || 0)}</div>
      <div class="p-grid">
        <div><b>${player.streak || 0}</b> day streak</div>
        <div><b>${player.oilVials || 0}</b> oil vials</div>
        <div><b>${player.hearts ?? MAX_HEARTS}</b> hearts</div>
        <div><b>${player.totalAnswered || 0}</b> answered</div>
        <div><b>${player.totalCorrect || 0}</b> correct</div>
        <div><b>${player.fails || 0}</b> fails</div>
        <div><b>${fmtTime(Math.round((player.bestTimeMs || 0) / 1000))}</b> best time</div>
        <div><b>T${player.entryTier || 1}</b> entry tier</div>
      </div>
      ${player.weakSubjects?.length ? `<div class="p-weak"><b>Weak spots:</b> ${player.weakSubjects.join(', ')}</div>` : ''}
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
  renderCandle();
  showScreen('screen-home');
});

// Daily share card
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-daily-share') {
    const out = session.questions.map((q) => q._outcome);
    const grid = shareGrid(out);
    const pct = Math.round((session.questions.filter((q) => q._correct).length / session.questions.length) * 100);
    const text = `Sound Doctrine — Daily Quest ${dailySeed(new Date())}\n${grid}\n${pct}%`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).then(() => {
        el('btn-daily-share').textContent = 'Copied!';
      });
    }
  }
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
  document.querySelectorAll('img[data-png]').forEach((img) => {
    const probe = new Image();
    probe.onload = () => {
      img.src = img.dataset.png;
      (img.closest('.hero-art') || img.closest('.mascot-duo-member'))?.classList.add('fullbody');
    };
    probe.src = img.dataset.png;
  });
  const start = el('screen-start');
  const bgPortrait = new Image();
  bgPortrait.onload = () => start?.classList.add('has-bg', 'bg-portrait');
  bgPortrait.src = 'assets/start-bg-portrait.jpg';
  const bgLandscape = new Image();
  bgLandscape.onload = () => {
    start?.classList.add('has-bg');
    document.body.classList.add('art-landscape');
  };
  bgLandscape.src = 'assets/start-bg-landscape.jpg';
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
    {
      target: '#hud-score',
      place: 'below',
      h3: 'Confidence × Multiplier',
      p: 'After you answer, set your <strong>Confidence</strong> from 1× Safe up to 5× Certain. A <strong>correct</strong> answer multiplies your points, but a <strong>wrong</strong> one costs that same amount — press on in faith, and near-misses keep half (Grace).',
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






