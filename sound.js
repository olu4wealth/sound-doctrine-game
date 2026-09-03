// sound.js — lightweight Web Audio SFX for Sound Doctrine.
// Synthesized tones (no asset files) so it works offline + on mobile.
// A single AudioContext is created lazily on first user interaction (autoplay-safe).

let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone({ freq = 440, dur = 0.18, type = 'sine', vol = 0.18, when = 0, slide = 0 }) {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  correct() {
    // Rising two-note chime
    tone({ freq: 523, dur: 0.12, type: 'triangle', vol: 0.2 });       // C5
    tone({ freq: 784, dur: 0.22, type: 'triangle', vol: 0.22, when: 0.08 }); // G5
  },
  grace() {
    tone({ freq: 440, dur: 0.14, type: 'sine', vol: 0.18 });
    tone({ freq: 587, dur: 0.2, type: 'sine', vol: 0.18, when: 0.1 }); // D5
  },
  wrong() {
    // Soft descending "thud"
    tone({ freq: 220, dur: 0.25, type: 'sawtooth', vol: 0.12, slide: -80 });
    tone({ freq: 160, dur: 0.3, type: 'sine', vol: 0.12, when: 0.08, slide: -40 });
  },
  timeout() {
    tone({ freq: 200, dur: 0.4, type: 'sine', vol: 0.12, slide: -120 });
  },
  tick() {
    // short blip for danger timer
    tone({ freq: 880, dur: 0.05, type: 'square', vol: 0.06 });
  },
  milestone() {
    // celebratory arpeggio
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.18, when: i * 0.09 }));
  },
  powerup() {
    tone({ freq: 660, dur: 0.1, type: 'triangle', vol: 0.18 });
    tone({ freq: 990, dur: 0.14, type: 'triangle', vol: 0.18, when: 0.08 });
  },
  setEnabled(v) { enabled = !!v; },
  isEnabled() { return enabled; },
};
