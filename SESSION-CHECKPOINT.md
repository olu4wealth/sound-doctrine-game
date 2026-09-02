# Session Checkpoint — Sound Doctrine Scripture Trivia

**Saved:** 2026-09-01
**Status:** Game built, verified, visually inspected. Ready for next step.

---

## What's Done (Complete)

### Core Game
- Static SPA (vanilla HTML5/CSS3/ES module JS), no framework, no build step, no runtime npm deps
- Pure-engine pattern: `game-core.js` (pure) + `storage.js` (localStorage + Supabase stub) + `app.js` (DOM glue)
- 95 questions across 1 Timothy, 2 Timothy, Titus (KJV only), 7 tiers (Recall → Synthesis)
- Mechanics: confidence bid (1×/2×/3×), near-miss Grace (50% pot via explicit `nearIndexes`), adaptive ladder picker, 7-day candle streak + oil-vial shields, countdown timer (T1=30s → T7=15s, +5s correct, +2s near-miss), kind hearts (5 lives), deterministic daily seed via mulberry32(hashCode(YYYY-MM-DD))
- Composite leaderboard score, Charge Report with grade/weaknesses/how-to-do-better (scriptural references)
- "Daylight sacred" theme: Duolingo-style claymorphism, color-coded options, circular countdown ring, pop/shake feedback

### Verification (all green)
- **95/95** KJV content vs lockbox (`verify/check.mjs`)
- **35/35** engine unit tests (`verify/game-core.test.mjs`)
- **18/18** Playwright E2E (mobile-chromium + desktop-chromium) (`tests/game.e2e.spec.js`)

### Visual Inspection (2026-09-01)
8 screenshots captured and reviewed:
- 00-start.png, 01-candle-home.png, 02-question.png, 04-correction.png
- 10-report.png, 11-report-rx.png, 20-leaderboard.png, 21-profile.png
- All screens render correctly; countdown timer, +5s bonus, verse correction, Charge Report with "How to do better" all confirmed working

### Assets
- DALL-E assets processed: `verify/key-white.ps1` (chroma-key RGB≥235 → alpha), `verify/slice-candle.ps1` (1801px → 3×600px strips)
- `assets/`: icon-crest.png, candle-lit.png, candle-guttering.png, candle-smouldering.png, clay-decorations-alpha.png, background-texture.png

---

## Pending / Next Steps

1. **Candle slice order unverified** — need to confirm lit/guttering/smouldering left→right matches `CANDLE_IMGS` in `app.js`. One-line fix if wrong.
2. **rank-emblems asset** — gray edge resisted keying; not yet wired (non-core).
3. **Supabase global leaderboard backend** — needs user-provided project + URL/key.
4. **Deployment** — GitHub Pages or Cloudflare Pages (needs host).
5. **Background texture opt-in** — `body.textured` class exists in CSS but isn't toggled by JS.

---

## Known Environment Facts
- npm `omit=dev` quirk baked into README — `npm install --include=dev` required
- localhost doesn't resolve in sandbox; server reachable only at `http://[IP_ADDRESS]:4173`
- No browser provider in this environment — UI verification via Playwright screenshots
- Vision quota (Aihubmix free tier, 10/day) exhausted — cannot re-glance assets
- No ImageMagick/sharp/ffmpeg — used System.Drawing for keying/slicing/PNG generation
- Scripture safety: runtime game never calls a model — question bank pre-verified against KJV lockbox

---

## User Preferences (baked in)
- Title: "Sound Doctrine"; subtitle: "Saints, Martyrs & Heroes · 1 & 2 Timothy · Titus"
- "Daylight sacred" palette (bright playful + warm reverent accent)
- Circular countdown ring; kind hearts (5 lives); no shaming on loss
- Tier-scaled time (T1=30s → T7=15s); +5s bonus on correct, +2s on grace
- Grade titles from the texts; oil-vial streak shields
- "Young elder on a charge" tone
- Playwright for E2E testing

---

## How to Resume
1. Run `npx serve . -l 4173` then open `http://[IP_ADDRESS]:4173` on phone/browser
2. Run `npx playwright test` to confirm 18 tests still pass
3. Ask user to visually confirm candle slice order (lit/guttering/smouldering)
4. Decide on rank-emblems, Supabase backend, deployment