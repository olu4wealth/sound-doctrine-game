# Sound Doctrine — Saints, Martyrs & Heroes

A Scripture study game built entirely on **1 Timothy, 2 Timothy, and Titus (KJV)**.

Three books. One charge. Know the doctrine.

## What it does

- **The Ladder** — a progressive climb from easy recall to extremely-hard synthesis
  (T1–T7). Stake your confidence (1× / 2× / 3×) before answering; near-misses earn
  *Grace* (half kept).
- **The Candle** — a 7-day capped streak that keeps your lamp lit; oil vials are
  earned shields; misses gutter gently and never shame you.
- **Daily Office** — one seeded 10-question charge per day, identical for everyone,
  ending in a shareable spoiler-safe card.
- **Charge Report** — after every climb: a letter grade, strengths ("you held fast"),
  weaknesses ("strengthen your charge"), and concrete study prescriptions with
  chapter:verse references ("how to do better").
- **Profile + Leaderboard** — named players with persistent streak / fails / best
  time / accuracy; a local leaderboard ranks everyone (Supabase-ready for a global,
  real-time board — see below).

**Scriptural safety:** the game never calls a model while you play. All 95 questions
are pre-authored and machine-verified character-for-character against the KJV lockbox
(`data/kjv-*.json`, `verify/check.mjs`).

## Running locally

```
# from this directory
npx serve .
# open http://localhost:3000
```

(or `python -m http.server`, or any static host).

## Verifying

```
node verify/check.mjs            # content vs KJV lockbox (95 questions)
node verify/game-core.test.mjs   # engine unit tests (35 checks)
npm run test                     # both of the above
```

## End-to-end testing (Playwright)

The game is E2E-tested with [Playwright](https://playwright.dev) across mobile
(iPhone Chromium) and desktop Chromium — driving the real UI in a real browser.

```
npm install --include=dev          # installs @playwright/test
npx playwright install chromium    # one-time browser download
npm run test:e2e                   # runs tests/game.e2e.spec.js (auto-serves on :4173)
```

> Note: this repo sets `omit` quirks aside — use `--include=dev` when installing,
> because Playwright lives in `devDependencies`.

The suite covers the full player journey: name entry → Candle home → climb →
question + countdown ring ticks down → answer + verse correction → Daily Office
(seeded day, 10 questions) → Charge Report (grade + "how to do better") →
leaderboard, plus localStorage persistence across reload.

## Deploying

Any static host works (GitHub Pages, Cloudflare Pages, Netlify). No build step, no
backend for the game itself.

**Global leaderboard** (multiple players around the world) needs a Supabase project:
`storage.js` is written against that API surface — set `window.__SD_SUPABASE__` and
wire the client to enable real-time cross-device ranking. Until then the leaderboard
is local-only (fully offline-capable).

## Docs

- `docs/GDD.md` — living game design document (systems, progression, scoring, report)
- `docs/UI-UX.md` — living UI/UX spec (screens, identity, leaderboard, metrics)
- `docs/research-notes.md` — every "fun" mechanic mapped to a source

## Credits

- King James Version text (public domain), JSON encoding from
  [aruljohn/Bible-kjv](https://github.com/aruljohn/Bible-kjv) (MIT license,
  see `data/LICENCE.aruljohn-bible-kjv.txt`).