// storage.js — persistence layer for Sound Doctrine.
// Local-first: player profile + leaderboard live in localStorage so the game works
// offline and with zero backend. Supabase-ready: the same API surface is used; when a
// Supabase client + config is present, leaderboard writes are mirrored there.
// (Global real-time leaderboard needs the Supabase project — see docs/UI-UX.md §4.)

import { runBankedPoints, leaderboardScore } from './game-core.js';

const KEYS = {
  player: 'sd.player.v1',
  leaderboard: 'sd.leaderboard.v1',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ---------- Player profile ----------
const PLAYER_DEFAULTS = {
  name: '',
  createdAt: null,
  streak: 0,
  lastChargeDay: null,
  oilVials: 10, // every new player starts with 10 oil vials
  totalDays: 0,
  totalAnswered: 0,
  totalCorrect: 0,
  lifetimePot: 0, // banked points across every run — drives rank + leaderboard
  fails: 0,
  bestTimeMs: null,
  bestStreak: 0,
  entryTier: 1,
  weakSubjects: [],
  seenIds: [],
  lifetimeChapters: {}, // "book ch" -> {asked, correct}
  lifetimeBooks: {},
  lifetimeSubjects: {},
  ladderPlayed: false, // Daily Quest + Choose Your Hero unlock after a Ladder climb
};
export function loadPlayer() {
  // Merge defaults under whatever is saved so new fields exist for old saves too.
  const saved = read(KEYS.player, {});
  const merged = { ...PLAYER_DEFAULTS, ...saved };
  // Returning players who predate the Ladder-first gate keep everything unlocked.
  if (saved.ladderPlayed === undefined && (merged.totalAnswered || 0) > 0) {
    merged.ladderPlayed = true;
  }
  return merged;
}
export function savePlayer(p) { write(KEYS.player, p); }

// ---------- Leaderboard (local; Supabase-mirrored later) ----------
export function loadLeaderboard() {
  return read(KEYS.leaderboard, []);
}
function saveLeaderboard(rows) { write(KEYS.leaderboard, rows); }

// Record a completed charge into profile + leaderboard.
export function recordCharge(player, session) {
  const p = { ...player };
  const correct = session.questions.filter((q) => q._correct).length;
  // Bank this run's pot (floored at zero) into the lifetime total. This is what
  // rank and the leaderboard now read, so effort always accumulates.
  p.lifetimePot = (p.lifetimePot || 0) + runBankedPoints(session, p.streak || 0);
  p.totalAnswered = (p.totalAnswered || 0) + session.questions.length;
  p.totalCorrect = (p.totalCorrect || 0) + correct;
  p.fails = (p.fails || 0) + (session.questions.length - correct);
  if (session.bestTimeMs != null) {
    p.bestTimeMs = p.bestTimeMs == null ? session.bestTimeMs : Math.min(p.bestTimeMs, session.bestTimeMs);
  }
  p.oilVials = (p.oilVials || 0) + (session.oilVialsEarned || 0);
  // Adaptive: advance entryTier when strong; learn weak subjects.
  const acc = p.totalAnswered ? p.totalCorrect / p.totalAnswered : 0;
  if (acc >= 0.8 && p.entryTier < 7) p.entryTier += 1;
  const weak = session.questions.filter((q) => !q._correct).map((q) => q.subject);
  if (weak.length) {
    const ws = new Set(p.weakSubjects || []);
    weak.forEach((w) => ws.add(w));
    p.weakSubjects = [...ws].slice(0, 12); // unwieldy if unbounded
  } else if (p.weakSubjects?.length) {
    p.weakSubjects = p.weakSubjects.filter((s) => !session.questions.some((q) => q.subject === s && !q._correct));
  }
  // Lifetime chapter/book/subject stats
  const bump = (obj, key, correctFlag) => {
    obj[key] = obj[key] || { asked: 0, correct: 0 };
    obj[key].asked++;
    if (correctFlag) obj[key].correct++;
  };
  for (const q of session.questions) {
    bump(p.lifetimeChapters, `${q.book} ${q.chapter}`, q._correct);
    bump(p.lifetimeBooks, q.book, q._correct);
    bump(p.lifetimeSubjects, q.subject, q._correct);
  }
  // seen ids (bounded)
  p.seenIds = [...new Set([...(p.seenIds || []), ...session.questions.map((q) => q.id)])].slice(-50);

  savePlayer(p);
  return p;
}

// Add/update the current player's row on the leaderboard, then sort.
export function updateLeaderboard(player, session) {
  const rows = loadLeaderboard().filter((r) => r.name !== player.name);
  const entry = {
    name: player.name,
    streak: player.streak,
    fails: player.fails,
    totalCorrect: player.totalCorrect,
    totalAnswered: player.totalAnswered,
    lifetimePot: player.lifetimePot || 0,
    bestTimeMs: player.bestTimeMs,
    updatedAt: Date.now(),
  };
  // Single source of truth: the row stores the same number the board sorts by,
  // so the displayed score and the ranking can no longer disagree.
  const s = leaderboardScore(entry);
  entry.acc = s.acc;
  entry.score = s.score;
  entry.provisional = s.provisional;
  rows.push(entry);
  saveLeaderboard(rows.slice(0, 50));
  return rows;
}

// Supabase-ready mirror. Import `@supabase/supabase-js` and set config to enable.
// Until then, leaderboard stays local (works fully offline).
export async function syncLeaderboardToSupabase(entry) {
  // const sb = window.__SD_SUPABASE__; // set by supabase.js when configured
  // if (sb) return sb.from('leaderboard').upsert(entry);
  return Promise.resolve({ local: true }); // no-op until Supabase configured
}

export function playerRank(rows, name) {
  const idx = rows.findIndex((r) => r.name === name);
  return idx === -1 ? null : idx + 1;
}

// ---------- Account management ----------
// Sign out: keep the local history but clear the active name so the start screen asks again.
export function signOutPlayer(fromProfile) {
  write(KEYS.player, { ...loadPlayer(), name: '' });
  return loadPlayer();
}

// Delete account: wipe the player's profile AND remove their row(s) from the local leaderboard.
export function deletePlayer(name) {
  localStorage.removeItem(KEYS.player);
  const rows = loadLeaderboard().filter((r) => r.name !== name);
  saveLeaderboard(rows);
  return null;
}

// Remove a specific named player's row(s) from the leaderboard.
export function removeLeaderboardRows(name) {
  const rows = loadLeaderboard().filter((r) => r.name !== name);
  saveLeaderboard(rows);
  return rows;
}