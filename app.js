// app.js — Sound Doctrine shell: wires game-core + storage to the DOM.
// Duolingo-style: countdown timer (bonus time on correct), kind hearts, color-coded
// options, juicy micro-interactions. Content stays scripturally verified.
import {
  TIER_NAMES, TIER_EMOJI, BIDS, BASE_POINTS, MAX_STREAK, MAX_HEARTS,
  timeForTier, bonusTime,
  dailyCharge, dailySeed, resolveAnswer, tierOf,
  pickNextLadder, applyDailyVisit, buildChargeReport, compositeScore,
  sortLeaderboard, shareGrid, shuffle, mulberry32, hashCode,
} from './game-core.js';
import {
  loadPlayer, savePlayer, recordCharge, updateLeaderboard,
  loadLeaderboard, syncLeaderboardToSupabase, signOutPlayer, deletePlayer,
} from './storage.js';

const el = (id) => document.getElementById(id);

// ---------- State ----------
let bank = [];
let player = loadPlayer();
let mode = 'ladder'; // 'ladder' | 'daily'
let session = null;
let timerInt = null;
let currentQ = null;
let dailyIdx = 0; // index into session._dailyList during a Daily Office

// Countdown state (per question)
let timeLeft = 0;
let timeTotal = 0;
let timeRunning = false;

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
  const [a, b] = await Promise.all([
    fetch('data/questions.json').then((r) => r.json()),
    fetch('data/questions-t47.json').then((r) => r.json()),
  ]);
  bank = [...a, ...b];
  bank.forEach((q) => { q.tier = tierOf(q); });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  el(id).classList.remove('hidden');
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

function renderCandle() {
  el('home-name').textContent = player.name || '—';
  el('home-rank').textContent = rankOf(player.totalCorrect * BASE_POINTS || 0);
  el('streak-num').textContent = player.streak || 0;
  el('oil-count').textContent = `🫗 ${player.oilVials || 0}`;

  const state = candleState();
  el('candle-stage').dataset.state = state;
  el('candle-img').src = CANDLE_IMGS[state];
  el('candle-caption').textContent = CANDLE_CAPTIONS[state];
}

// ---------- Session setup ----------
function resetSession() {
  // A new game always starts afresh: full lives, empty session, cleared per-question state.
  setHearts(MAX_HEARTS);
  session = { questions: [], pot: 0, elapsedMs: 0, daily: false, oilVialsEarned: 0, bestTimeMs: 0, runTiers: [], maxRunTier: 0 };
  dailyIdx = 0;
  bank.forEach((q) => {
    delete q._usedThisRun; delete q._outcome; delete q._correct; delete q._bid; delete q._displayOrder;
  });
  savePlayer(player);
}

function startClimb() {
  mode = 'ladder';
  resetSession();
  renderHearts();
  nextQuestion();
  showScreen('screen-game');
}

function startDaily() {
  mode = 'daily';
  const today = dailySeed(new Date());
  const list = dailyCharge(bank, today, mulberry32(hashCode(today)));
  resetSession();
  session.daily = true;
  session._dailyList = list;
  el('daily-intro').textContent = `Today's Office — ${list.length} questions (${today}). Same for everyone, so the board is fair.`;
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

// ---------- Countdown timer ----------
function adaptiveTimeForTier(tier, questionIndexInTier) {
  // Base time from tier (harder tier = less base time)
  let base = timeForTier(tier);
  // Speed up by 10% per answered question within the same tier band
  // (so T2 starts at 26s, gets tighter as you progress)
  const progressFactor = Math.min(1, (questionIndexInTier || 0) / 5);
  return Math.max(10, Math.round(base * (1 - progressFactor * 0.3)));
}

function startCountdown(tier, idxInTier = 0) {
  stopTimer();
  timeTotal = adaptiveTimeForTier(tier, idxInTier);
  timeLeft = timeTotal;
  timeRunning = true;
  renderTimerBar();
  timerInt = setInterval(() => {
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
  updateFlame(frac);
}

// Drive the live flame: full/steady at full time, dims toward zero, out when time's up.
function updateFlame(frac) {
  const meter = el('flame-meter');
  const flame = el('flame');
  if (!meter || !flame) return;
  const intensity = Math.max(0.25, Math.min(1, frac)); // never fully dark, but visibly dims
  meter.style.setProperty('--flame-intensity', String(intensity));
  if (frac <= 0.2) flame.classList.add('dim');
  else flame.classList.remove('dim');
  // NOTE: 'bright' pulse is NOT cleared here — it times out in pulseFlameBright().
}
function fmtTime(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ---------- Question rendering ----------
function renderQuestion(q) {
  el('q-book').textContent = q.book;
  el('q-subject').textContent = q.subject;
  el('q-type').textContent = `${TIER_EMOJI[q.tier]} T${q.tier} · ${TIER_NAMES[q.tier]}`;
  el('q-prompt').textContent = q.prompt;

  const order = shuffle(Math.random, [0, 1, 2, 3]);
  q._displayOrder = order;
  const wrap = el('q-options');
  wrap.innerHTML = '';
  const accent = ['a', 'b', 'c', 'd']; // color coding per position
  order.forEach((orig, displayIdx) => {
    const btn = document.createElement('button');
    btn.className = `option opt-${accent[displayIdx]}`;
    btn.textContent = q.options[orig];
    btn.dataset.display = String(displayIdx);
    btn.addEventListener('click', () => onAnswer(displayIdx));
    wrap.appendChild(btn);
  });

  // Ladder: options hidden until a confidence bid is chosen.
  // Daily Office: no bids — options are shown immediately.
  el('bid-row').classList.toggle('hidden', mode === 'daily');
  if (mode === 'daily') {
    q._bid = BIDS[0]; // default confident for the office
    el('q-options').classList.remove('hidden');
  } else {
    el('q-options').classList.add('hidden');
  }
  el('feedback').classList.add('hidden');
  el('feedback').classList.remove('correct', 'wrong', 'grace');
  updateProgress();
  renderTimerBar();

  // Timer scales with the effective (ramped) run tier, so harder progress = less time.
  const runTier = q._runTier || q.tier;
  startCountdown(runTier, (session?.questions?.length || 0));
}

function updateProgress() {
  let idx, total;
  if (mode === 'daily') {
    total = session._dailyList?.length || 10;
    idx = dailyIdx + 1; // 1-based current question number
  } else {
    total = 12;
    idx = session.questions.length + 1;
  }
  idx = Math.max(1, Math.min(idx, total));
  el('progress-bar').style.width = `${Math.round((idx / total) * 100)}%`;
  el('hud-progress').textContent = `${idx}/${total}`;
}

function nextQuestion() {
  // Progressive difficulty: ramp the effective tier up as the climb progresses.
  // Start at entryTier, gain +1 tier every 4 questions (capped at 7), so the
  // further you climb the harder it gets — a real ladder.
  const qIndex = session.questions.length; // 0-based before this question
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
  el('q-type').textContent = `${TIER_EMOJI[q.tier]} T${q.tier} · Daily Office`;
}

function showFeedbackModal(head, verse, ref, kind, isLast) {
  // Remove old modal if any
  const old = document.getElementById('feedback-modal-backdrop');
  if (old) old.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'feedback-modal-backdrop';
  backdrop.className = 'feedback-modal-backdrop';
  backdrop.innerHTML = `
    <div class="feedback-modal-card ${kind}">
      <div class="feedback-modal-head">${head}</div>
      <blockquote class="feedback-modal-verse">${verse}</blockquote>
      <cite class="feedback-modal-ref">${ref}</cite>
      <button class="primary feedback-modal-btn" id="feedback-modal-continue">${isLast ? 'See the report' : 'Continue'}</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('feedback-modal-continue').onclick = () => {
    backdrop.remove();
    btnNextGo();
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

// Flame flares bright briefly on a correct answer, then returns to normal.
function pulseFlameBright() {
  const flame = el('flame');
  if (!flame) return;
  flame.classList.add('bright');
  setTimeout(() => {
    // The next renderTimerBar tick will drop 'bright' and re-apply 'dim' if needed.
    const meter = el('flame-meter');
    if (meter) meter.style.setProperty('--flame-intensity', '1');
  }, 450);
}

// ---------- Answering ----------
function onAnswer(displayIdx) {
  if (!timeRunning) return; // already answered / timed out
  stopTimer();
  const q = currentQ;
  const qWrap = el('q-options');
  const buttons = qWrap.querySelectorAll('.option');
  const chosenOrig = q._displayOrder[displayIdx];

  if (q._bid === undefined) q._bid = BIDS[0];
  const res = resolveAnswer(q, chosenOrig, q._bid);
  const isCorrect = res.outcome === 'correct';
  const isGrace = res.outcome === 'near-miss';

  q._correct = isCorrect;
  q._outcome = res.outcome;
  session.questions.push(q);
  session.elapsedMs = (session.elapsedMs || 0) + Math.round((timeTotal - timeLeft) * 1000);
  if (isCorrect || isGrace) session.pot += res.pot;

  // Flame flares brighter on a correct answer, then settles back.
  if (isCorrect) pulseFlameBright();

  // Reward for getting far: milestone bonuses as the climb ramps up.
  const milestone = checkMilestoneReward();
  let bonusLine = '';
  if (milestone && isCorrect) {
    session.pot += milestone.points;
    bonusLine = ` · ${milestone.label} +${milestone.points} ⚜`;
  }

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
  el('bid-row').classList.add('hidden');

  const gained = bonusTime(res.outcome);
  let head = '';
  let kind = 'correct';
  if (isCorrect) {
    head = `Rightly divided! +${res.points} ⚜ · +${gained}s${bonusLine}`;
    kind = 'correct';
  } else if (isGrace) {
    head = `Grace — near to it. ${res.points} ⚜ kept · +${gained}s`;
    kind = 'grace';
  } else {
    head = 'Not quite. Scripture corrects us —';
    kind = 'wrong';
  }
  const verse = quotesOf(q);
  const ref = refsOf(q) + ' (KJV)';
  showFeedbackModal(head, verse, ref, kind, isLastQuestion());

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
  el('bid-row').classList.add('hidden');
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
    isLastQuestion()
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
  return session.questions.length >= 12;
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
  // No automatic heart refill — the charge is over when hearts reach zero.
  if (hearts() <= 0) {
    finishCommon(); // End the game properly with report
    return;
  }
  if (mode === 'daily') {
    dailyIdx++;
    renderDailyQuestion();
  } else {
    if (session.questions.length >= 12) { finishClimb(); return; }
    nextQuestion();
  }
}

// ---------- Finishing ----------
function finishCommon() {
  stopTimer();
  session.bestTimeMs = session.elapsedMs || 0;
  const report = buildChargeReport(session, bank);

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

  const col = (title, rows) => {
    const body = rows.length
      ? rows.map((r) => `<li><span class="r-label">${r.name}</span><span class="r-bar"><span class="r-fill" style="width:${Math.round(r.acc * 100)}%"></span></span><span class="r-pct">${Math.round(r.acc * 100)}%</span></li>`).join('')
      : '<li class="empty">Not enough data yet</li>';
    return `<div class="col"><h3>${title}</h3><ul>${body}</ul></div>`;
  };

  el('report-columns').innerHTML =
    col('Strengths — you held fast', report.strengths) +
    col('Weaknesses — strengthen your charge', report.weaknesses) +
    col('Books', report.books) +
    col('Chapters to revisit', report.chapters);

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
// Intro → start (first-time cinematic)
el('btn-intro-begin').addEventListener('click', () => { showTutorial(); showScreen('screen-start'); });
el('btn-intro-how').addEventListener('click', () => showScreen('screen-how'));

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
el('btn-daily').addEventListener('click', () => startDaily());
el('btn-daily-start').addEventListener('click', () => beginDailyList());
el('btn-daily-back').addEventListener('click', () => showScreen('screen-home'));
el('btn-next').addEventListener('click', btnNextGo);
el('btn-again').addEventListener('click', startClimb);
el('btn-home').addEventListener('click', () => { renderCandle(); showScreen('screen-home'); });
el('btn-profile').addEventListener('click', () => { renderProfile(); showScreen('screen-profile'); });
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
  renderCandle();
  showScreen('screen-home');
});

// Bid selection
document.querySelectorAll('.bid').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.bid;
    const bid = BIDS.find((b) => b.id === id);
    if (!currentQ) return;
    currentQ._bid = bid;
    document.querySelectorAll('.bid').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    el('q-options').classList.remove('hidden');
  });
});

// Daily share card
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-daily-share') {
    const out = session.questions.map((q) => q._outcome);
    const grid = shareGrid(out);
    const pct = Math.round((session.questions.filter((q) => q._correct).length / session.questions.length) * 100);
    const text = `Sound Doctrine — Daily Office ${dailySeed(new Date())}\n${grid}\n${pct}%`;
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
    // First-visit: show the cinematic intro; then the start screen (with tutorial).
    showScreen('screen-intro');
  }
}

init();

// ---------- Tutorial for first-time players ----------
function showTutorial() {
  if (localStorage.getItem('sd_tutorial_done')) return;
  const backdrop = document.createElement('div');
  backdrop.id = 'tutorial-backdrop';
  backdrop.className = 'tutorial-backdrop';
  backdrop.innerHTML = `
    <div class="tutorial-card">
      <div class="tutorial-step" data-step="1">
        <h3>Welcome, young elder</h3>
        <p>Type your name and press <strong>Begin the Charge</strong> to start.</p>
      </div>
      <div class="tutorial-step hidden" data-step="2">
        <h3>The Candle</h3>
        <p>This is your lamp. <strong>Keep it lit</strong> with correct answers.</p>
      </div>
      <div class="tutorial-step hidden" data-step="3">
        <h3>Answer with confidence</h3>
        <p>Choose <strong>Confident / Certain / I'll preach it</strong> before picking an answer.</p>
      </div>
      <div class="tutorial-step hidden" data-step="4">
        <h3>The Verse Corrects You</h3>
        <p>Every answer shows the Scripture — correct or wrong — so you learn.</p>
      </div>
      <div class="tutorial-nav">
        <button id="tut-prev" class="ghost small">Back</button>
        <button id="tut-next" class="primary">Next</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  
  let step = 1;
  const goTo = (n) => {
    backdrop.querySelectorAll('.tutorial-step').forEach(s => s.classList.add('hidden'));
    const target = backdrop.querySelector(`[data-step="${n}"]`);
    if (target) target.classList.remove('hidden');
    step = n;
    // Hide Back with display:none on step 1 so it doesn't reserve flex space (keeps Next steady).
    const prev = document.getElementById('tut-prev');
    prev.style.display = step <= 1 ? 'none' : 'inline-block';
    document.getElementById('tut-next').textContent = step >= 4 ? 'Begin' : 'Next';
  };
  document.getElementById('tut-next').onclick = () => {
    if (step >= 4) {
      localStorage.setItem('sd_tutorial_done', '1');
      backdrop.remove();
    } else {
      goTo(step + 1);
    }
  };
  document.getElementById('tut-prev').onclick = () => {
    if (step > 1) goTo(step - 1);
  };
  goTo(1);
}