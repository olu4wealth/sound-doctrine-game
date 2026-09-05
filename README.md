# Sound Doctrine — Saints, Martyrs & Heroes

A Scripture study game built entirely on **1 Timothy, 2 Timothy, and Titus (KJV)**.

Three books. One charge. Know the doctrine.

## What it does

- **The Ladder** — a fixed 10-question climb from easy recall to extremely-hard
  synthesis (T1–T7). Pick your confidence (1×–5×) from the inline stake row before
  answering; near-misses earn *Grace* (half kept). Points bank into a **lifetime
  pot** that drives your rank and your place on the board.
- **The Candle** — an uncapped daily streak that keeps your lamp lit; every new player
  starts with 10 oil vials (earned shields); misses gutter gently and never shame you.
  Day 7 is the *lamp is trimmed* milestone, not the ceiling.
- **Daily Quest** — one seeded 10-question quest per day, identical for everyone,
  ending in a shareable spoiler-safe card.
- **Choose Your Hero** — pick **Timothy** (1 Timothy · 2 Timothy) or **Titus** (Titus) for a
  seeded 10-question run from *his own book only*, mixing three fresh question types:
  **True or False**, **Word Order** (rebuild the verse by tapping its words), and
  **Who Did This** (four names, one verse-backed answer).
- **Charge Report** — after every climb: a letter grade, strengths ("you held fast"),
  weaknesses ("strengthen your charge"), and concrete study prescriptions with
  chapter:verse references ("how to do better").
- **Your Mastery** — lifetime, per-chapter progress across all 13 chapters of the
  three books ("4 of 13 chapters mastered"), accumulated across every run.
- **Retest** — the Charge Report turns straight into a run built from exactly what
  you just missed, so study → test → restudy closes without leaving the app.
- **Profile + Leaderboard** — named players with persistent streak / lifetime pot /
  accuracy; a local leaderboard ranks everyone (Supabase-ready for a global,
  real-time board — see below). Playing more can never lower your score.
- **Installable** — a service worker caches the shell, so the game installs to a
  home screen and plays offline.

**Scriptural safety:** the game never calls a model while you play. All 166 ladder/daily
questions plus 36 Choose-Your-Hero questions are pre-authored and pinned to the KJV
lockbox (`data/kjv-*.json`); `verify/check.mjs` machine-checks the main bank against it
(current status: `docs/AI-PIPELINE.md`), and `verify/hero.test.mjs` machine-checks every
hero verse, word-order segment, and true/false statement against the same lockbox.

## Running locally

```
# from this directory
npx serve .
# open http://localhost:3000
```

(or `python -m http.server`, or any static host).

## Verifying

```text
node verify/game-core.test.mjs   # engine unit tests (71 checks, canonical bank)
node verify/hero.test.mjs        # Choose Your Hero engine + data tests (32 checks, KJV-verified)
node verify/check.mjs            # content vs KJV lockbox — ⚠ currently FAILS (84 errors)
npm run test                     # all of the above (fails until check.mjs is repaired)
```

> **Known-failing:** `verify/check.mjs` reports 84 content errors — 62 missing
> `category`/`skill` metadata, 7 Gate-A verse-text mismatches (six are legitimate
> ellipsis abridgements the gate can't recognise; one, `t6-guard-faith`, cites
> 1 Timothy 6:20 over text that ends with Titus 1:9 and is a real misattribution),
> plus a few unparsed passage ranges. Tracked in `docs/AI-PIPELINE.md`.

```text
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

The suite (36 tests) covers the full player journey: title screen + name entry →
Candle home → climb → question + countdown ring ticks down → answer + verse
correction → Daily Quest (seeded day, 10 questions) → Charge Report (grade +
"how to do better") → leaderboard, plus localStorage persistence across reload —
and the retention surfaces: the inline stake row, the fixed-length climb, rank
progress, the daily reset countdown, the Mastery screen, share/retest, and
service-worker registration.

## Deploying

Any static host works (GitHub Pages, Cloudflare Pages, Netlify). No build step, no
backend for the game itself. `sw.js` must be served from the site root so its scope
covers the whole app, and the site must be on HTTPS (or localhost) for the service
worker and the install prompt to activate.

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