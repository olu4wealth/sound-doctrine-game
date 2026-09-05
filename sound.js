// sound.js — lightweight Web Audio SFX + subtle generative background music.
// SFX are synthesized tones (no assets) so it works offline + on mobile.
// Music is a slow hymn-like pad loop (triangle oscillators, lowpass) — also synthesized.
// A single AudioContext is created lazily on first user gesture (autoplay-safe).
// Volumes and enables persist in localStorage.

let ctx = null;
let musicGain = null;
let musicTimer = null;
let chordIdx = 0;

// --- persisted settings (defaults) ---
const LS_SFX_VOL = 'sd_sfx_vol';
const LS_MUSIC_VOL = 'sd_music_vol';
const LS_SFX_ON = 'sd_sfx_enabled';
const LS_MUSIC_ON = 'sd_music_enabled';

function readNum(key, fallback) {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function readOn(key, fallback) {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v !== '0';
}

// migrate legacy sd_muted (0=mute all, 1=sound on previously? actually '1' meant muted)
// original: if sd_muted==='1' → sfx disabled. Keep compat.
(function migrateLegacyMute() {
  const legacy = localStorage.getItem('sd_muted');
  if (legacy !== null && localStorage.getItem(LS_SFX_ON) === null && localStorage.getItem(LS_MUSIC_ON) === null) {
    const muted = legacy === '1';
    if (muted) {
      localStorage.setItem(LS_SFX_ON, '0');
      localStorage.setItem(LS_MUSIC_ON, '0');
    }
  }
})();

let sfxEnabled = readOn(LS_SFX_ON, true);
let musicEnabled = readOn(LS_MUSIC_ON, true);
let sfxVol = Math.min(1, Math.max(0, readNum(LS_SFX_VOL, 0.55)));
let musicVol = Math.min(1, Math.max(0, readNum(LS_MUSIC_VOL, 0.28)));

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function ensureMusicGain() {
  const c = ac();
  if (!c) return null;
  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = musicEnabled ? musicVol * 0.45 : 0.0001;
    musicGain.connect(c.destination);
  }
  return musicGain;
}

function tone({ freq = 440, dur = 0.18, type = 'sine', vol = 0.18, when = 0, slide = 0 }) {
  if (!sfxEnabled) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  const peak = vol * sfxVol;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// --- Music: slow hymn pad ---
const CHORDS = [
  [48, 52, 55], // C  (C3 E3 G3)
  [53, 57, 60], // F  (F3 A3 C4)
  [57, 60, 64], // Am (A3 C4 E4)
  [55, 59, 62], // G  (G3 B3 D4)
  [48, 52, 55], // C
  [50, 53, 57], // D-? (D3 F3 A3) — gentle passing
];
const CHORD_DURATION = 10; // seconds per pad (with fade)
const CHORD_INTERVAL = 7;  // seconds between chord starts (2s crossfade)

function playChord(midis) {
  const c = ac();
  const mg = ensureMusicGain();
  if (!c || !mg) return;
  if (!musicEnabled) return;
  const now = c.currentTime;
  const perNotePeak = 0.055; // very subtle per note
  for (const midi of midis) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 880;
    filt.Q.value = 0.6;
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 5; // tiny chorus
    // envelope: slow attack, hold, slow release
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(perNotePeak, now + 2.4);
    gain.gain.setValueAtTime(perNotePeak, now + CHORD_DURATION - 2.4);
    gain.gain.linearRampToValueAtTime(0.0001, now + CHORD_DURATION);
    // gentle vibrato via detune wobble (optional)
    osc.connect(filt).connect(gain).connect(mg);
    osc.start(now);
    osc.stop(now + CHORD_DURATION + 0.05);
  }
}

function scheduleMusic() {
  if (!musicEnabled) return;
  playChord(CHORDS[chordIdx % CHORDS.length]);
  chordIdx++;
}

export const sfx = {
  correct() {
    tone({ freq: 523, dur: 0.12, type: 'triangle', vol: 0.2 });
    tone({ freq: 784, dur: 0.22, type: 'triangle', vol: 0.22, when: 0.08 });
  },
  grace() {
    tone({ freq: 440, dur: 0.14, type: 'sine', vol: 0.18 });
    tone({ freq: 587, dur: 0.2, type: 'sine', vol: 0.18, when: 0.1 });
  },
  wrong() {
    tone({ freq: 220, dur: 0.25, type: 'sawtooth', vol: 0.12, slide: -80 });
    tone({ freq: 160, dur: 0.3, type: 'sine', vol: 0.12, when: 0.08, slide: -40 });
  },
  timeout() {
    tone({ freq: 200, dur: 0.4, type: 'sine', vol: 0.12, slide: -120 });
  },
  tick() {
    tone({ freq: 880, dur: 0.05, type: 'square', vol: 0.06 });
  },
  milestone() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.18, when: i * 0.09 }));
  },
  powerup() {
    tone({ freq: 660, dur: 0.1, type: 'triangle', vol: 0.18 });
    tone({ freq: 990, dur: 0.14, type: 'triangle', vol: 0.18, when: 0.08 });
  },
  // legacy single-toggle (maps to SFX)
  setEnabled(v) {
    sfxEnabled = !!v;
    localStorage.setItem(LS_SFX_ON, sfxEnabled ? '1' : '0');
  },
  isEnabled() { return sfxEnabled; },
  // granular SFX
  setSfxEnabled(v) {
    sfxEnabled = !!v;
    localStorage.setItem(LS_SFX_ON, sfxEnabled ? '1' : '0');
  },
  isSfxEnabled() { return sfxEnabled; },
  setSfxVolume(v) {
    sfxVol = Math.min(1, Math.max(0, v));
    localStorage.setItem(LS_SFX_VOL, String(sfxVol));
  },
  getSfxVolume() { return sfxVol; },
  // music
  setMusicEnabled(v) {
    musicEnabled = !!v;
    localStorage.setItem(LS_MUSIC_ON, musicEnabled ? '1' : '0');
    const mg = ensureMusicGain();
    if (mg && ctx) mg.gain.setTargetAtTime(musicEnabled ? musicVol * 0.45 : 0.0001, ctx.currentTime, 0.35);
    if (musicEnabled) music.start(); else music.stop();
  },
  isMusicEnabled() { return musicEnabled; },
  setMusicVolume(v) {
    musicVol = Math.min(1, Math.max(0, v));
    localStorage.setItem(LS_MUSIC_VOL, String(musicVol));
    const mg = ensureMusicGain();
    if (mg && ctx) mg.gain.setTargetAtTime(musicEnabled ? musicVol * 0.45 : 0.0001, ctx.currentTime, 0.25);
  },
  getMusicVolume() { return musicVol; },
};

export const music = {
  start() {
    if (musicTimer) return;
    if (!musicEnabled) return;
    const c = ac();
    const mg = ensureMusicGain();
    if (!c || !mg) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    mg.gain.setTargetAtTime(musicVol * 0.45, c.currentTime, 0.35);
    // play immediately, then interval
    scheduleMusic();
    musicTimer = setInterval(scheduleMusic, CHORD_INTERVAL * 1000);
  },
  stop() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (musicGain && ctx) musicGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
  },
  isEnabled() { return musicEnabled; },
  getVolume() { return musicVol; },
  setVolume(v) { sfx.setMusicVolume(v); },
  setEnabled(v) { sfx.setMusicEnabled(v); },
};
