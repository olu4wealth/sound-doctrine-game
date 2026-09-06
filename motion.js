// motion.js — the game's animation layer, built on GSAP (vendored in vendor/).
//
// Everything here degrades to "apply the final state instantly" when GSAP is
// missing or the player asks for reduced motion. GSAP tweens are JS, so the CSS
// `@media (prefers-reduced-motion: reduce)` block does NOT cover them — every
// helper has to check `motionOK()` itself. That check is the contract of this file.

const gsap = globalThis.gsap || null;
const Flip = globalThis.Flip || null;

const reduceQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false, addEventListener: () => {} };

export function hasGsap() { return !!gsap; }
export function prefersReducedMotion() { return !!reduceQuery.matches; }
export function motionOK() { return !!gsap && !reduceQuery.matches; }

// Kill everything in flight — used when a run ends or the player quits, so a
// half-finished tween can't keep mutating an element on another screen.
export function killAll(targets) {
  if (!gsap) return;
  if (targets) gsap.killTweensOf(targets);
  else gsap.globalTimeline.clear();
}

// ---------- 1. Number tallying ----------
// The score chip used to teleport: `chip.textContent = '⚜ ' + pot`. Winning 900
// points in one answer looked identical to winning 100. Counting up gives the
// game's primary reward signal actual weight.
const counters = new WeakMap();
export function countUp(node, to, { format = (v) => String(Math.round(v)), duration = 0.7 } = {}) {
  if (!node) return;
  const target = Number(to) || 0;
  if (!motionOK()) { node.textContent = format(target); counters.set(node, target); return; }
  const from = counters.has(node) ? counters.get(node) : target;
  counters.set(node, target);
  if (from === target) { node.textContent = format(target); return; }
  const proxy = { v: from };
  gsap.killTweensOf(proxy);
  gsap.to(proxy, {
    v: target,
    duration,
    ease: 'power2.out',
    overwrite: true,
    onUpdate: () => { node.textContent = format(proxy.v); },
    onComplete: () => { node.textContent = format(target); },
  });
}

// Seed a counter without animating (e.g. when a screen first renders).
export function seedCounter(node, value, format = (v) => String(Math.round(v))) {
  if (!node) return;
  counters.set(node, Number(value) || 0);
  node.textContent = format(Number(value) || 0);
}

// ---------- 2. Staggered reveals ----------
// Report sections and the 13-chapter Mastery grid used to paint all at once.
// A cascade turns a data dump into a reveal. Staggering N runtime-generated
// nodes is exactly what CSS is bad at (it needs per-element animation-delay).
export function staggerIn(nodes, { y = 14, duration = 0.42, stagger = 0.05, delay = 0 } = {}) {
  const list = [...(nodes || [])].filter(Boolean);
  if (!list.length) return;
  if (!motionOK()) { gsap && gsap.set(list, { clearProps: 'all' }); return; }
  gsap.killTweensOf(list);
  gsap.fromTo(list,
    { opacity: 0, y },
    { opacity: 1, y: 0, duration, stagger, delay, ease: 'power2.out', clearProps: 'transform,opacity' });
}

// Grow a progress bar to its target width (rank bar, mastery bars).
export function growBar(node, pct, { duration = 0.8, delay = 0 } = {}) {
  if (!node) return;
  const w = `${Math.max(0, Math.min(100, pct))}%`;
  if (!motionOK()) { node.style.width = w; return; }
  gsap.killTweensOf(node);
  gsap.fromTo(node, { width: 0 }, { width: w, duration, delay, ease: 'power2.out' });
}

// ---------- 3. Answer → feedback sequence ----------
// Previously a hard cut: colour the buttons, then inject the modal. A timeline
// lets the correct answer register before the modal arrives, and (unlike the old
// setTimeout chain) it can be killed if the player taps Continue immediately.
let feedbackTl = null;
export function answerFeedback({ correctBtn, chosenBtn, wrong = false } = {}) {
  if (feedbackTl) { feedbackTl.kill(); feedbackTl = null; }
  if (!motionOK()) return null;
  feedbackTl = gsap.timeline();
  if (wrong && chosenBtn) {
    feedbackTl.fromTo(chosenBtn,
      { x: 0 }, { x: -6, duration: 0.06, repeat: 3, yoyo: true, ease: 'none', clearProps: 'x' }, 0);
  }
  if (correctBtn) {
    feedbackTl.fromTo(correctBtn,
      { scale: 1 }, { scale: 1.04, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out', clearProps: 'scale' }, 0.02);
  }
  return feedbackTl;
}

// The feedback modal itself: card rises, mascot lands just after it.
export function revealModal(card, mascot) {
  if (!card) return;
  if (!motionOK()) return;
  gsap.killTweensOf([card, mascot].filter(Boolean));
  const tl = gsap.timeline();
  tl.fromTo(card, { opacity: 0, y: 24, scale: 0.96 },
    { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: 'back.out(1.4)', clearProps: 'transform' });
  if (mascot) {
    tl.fromTo(mascot, { opacity: 0, y: -14, scale: 0.8 },
      { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(2)', clearProps: 'transform' }, '-=0.14');
  }
  return tl;
}

// ---------- 4. Interruptible state ----------
// `pulseFlameBright` removed a class on a 450ms setTimeout. Answering quickly
// stacked timeouts and the flame could stick bright or reset early. `overwrite`
// makes the newest pulse win by construction.
export function pulseFlame(node, intensity = 1.25) {
  if (!node) return;
  if (!motionOK()) return;
  gsap.fromTo(node,
    { scale: 1 },
    { scale: intensity, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out',
      overwrite: 'auto', clearProps: 'scale' });
}

// A short attention shake used when the player has no oil for a power-up.
export function nudge(nodes) {
  const list = [...(nodes || [])].filter(Boolean);
  if (!list.length || !motionOK()) return;
  gsap.fromTo(list, { x: 0 },
    { x: -4, duration: 0.05, repeat: 5, yoyo: true, ease: 'none', overwrite: 'auto', clearProps: 'x' });
}

// ---------- 5. Screen transitions ----------
// showScreen() toggled `.hidden` (display:none), so screens hard-cut out with no
// exit at all — the app read as a slideshow. The outgoing screen is pulled out of
// flow for the length of its fade so the incoming one drives layout immediately.
export function swapScreens(outgoing, incoming, { onDone } = {}) {
  if (!incoming) return;
  const finish = () => { onDone && onDone(); };
  if (!motionOK()) {
    if (outgoing && outgoing !== incoming) outgoing.classList.add('hidden');
    incoming.classList.remove('hidden');
    finish();
    return;
  }
  incoming.classList.remove('hidden');
  gsap.killTweensOf(incoming);
  if (outgoing && outgoing !== incoming) {
    gsap.killTweensOf(outgoing);
    outgoing.classList.add('screen-leaving');
    gsap.to(outgoing, {
      opacity: 0, duration: 0.14, ease: 'power1.in',
      onComplete: () => {
        outgoing.classList.remove('screen-leaving');
        outgoing.classList.add('hidden');
        gsap.set(outgoing, { clearProps: 'opacity' });
      },
    });
  }
  gsap.fromTo(incoming, { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', clearProps: 'transform,opacity', onComplete: finish });
}

// ---------- 6. Leaderboard reordering (Flip) ----------
// Rows used to re-render straight into their new order. Flip records where each
// row was, lets the caller re-render, then animates every row from its old box to
// its new one — so climbing the board is something you actually see happen.
export function flipList(container, rerender, { duration = 0.55 } = {}) {
  if (!container) return;
  if (!motionOK() || !Flip) { rerender(); return; }
  const rows = container.querySelectorAll('[data-flip-id]');
  if (!rows.length) { rerender(); staggerIn(container.querySelectorAll('[data-flip-id]')); return; }
  const state = Flip.getState(rows);
  rerender();
  Flip.from(state, {
    duration,
    ease: 'power2.inOut',
    absolute: true,
    onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35 }),
    onLeave: (els) => gsap.to(els, { opacity: 0, duration: 0.2 }),
  });
}
