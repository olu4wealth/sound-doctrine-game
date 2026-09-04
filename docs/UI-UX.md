# Sound Doctrine — UI/UX & Interaction Design (Living Spec)

> Status legend: **🟢 shipped** · **🟡 spec'd, not built** · **⚪ planned, unscoped**
> This document is the living source of truth for how the game *feels* and *flows*.
> It sits beside `docs/GDD.md` (game mechanics) and `docs/research-notes.md` (why each
> hook works). When any grows stale, update it here first.

---

## 1. North star

**A tense, warm charge — not a quiz.** The emotional contract in one line:

> *You are a young elder commissioned for the road. Answer well and your lamp burns
> bright for all to see; answer loosely and you are — gently, scripturally — corrected.*

Three operative adjectives: **reverent**, **sharp**, **alive**. Anti-patterns we will
never become: sugary, gamified-to-death, or guilt-driven (see guardrails, §9).

## 2. Players & identity

Named users are core (not an afterthought). Every player has:

- **Name** (required, public on the leaderboard): chosen display name, e.g. "Tychicus" or "Priscilla."
- **Rank title** (earned, shown beside name): from the Ladder — `Recruit → … → Crownbearer`.
- **House banner** (a 3-book sigil): "1 Tim · 2 Tim · Titus" — a unifying crest, not a faction choice.

Account signup is **one-tap**: Supabase anonymous-upgrade or magic link. No password
wall on a phone. First-run asks only for a display name — everything else is optional.

### Persistent profile stats (the numbers you asked for)

| Stat | Definition | Where it shows |
|---|---|---|
| **Streak** | Consecutive days with ≥1 completed Charge (capped at 7, per GDD) | Candle + profile + leaderboard |
| **Fails** | Lifetime wrong answers (public, low = honour) | profile + leaderboard |
| **Best solve time** | Fastest fully-correct 10-question Charge (mm:ss) | profile + leaderboard |
| **Accuracy** | Lifetime correct ÷ answered | profile + leaderboard |
| **Grace used** | Near-miss half-saves consumed (a humility signal) | profile only |

## 3. The screens (mobile-first, portrait)

```
Start (title screen — the single opening page)
 ├─ Name entry → "Begin the Charge" → Candle home
 ├─ How to play
 └─ Leaderboard (tab)
Ladder (the core play screen)
 ├─ Question + confidence stake + countdown ring
 ├─ Correction panel (verse + reference) on miss / near-miss
 └─ Charge-complete → faithful report → share card
Candle (retention screen — the "keep it lit" home)
Daily Quest (one seeded 10-question quest per day)
Choose Your Hero (Timothy or Titus — a seeded 10-question run from his own book only)
Report (per-session + lifetime)
Leaderboard (local; Supabase-ready)
Profile (name, stats, edit)
```

### 3.1 Start (title screen)
One game-style opening screen: crest + title + subtitle, then **Timothy & Titus** as
huge transparent key art — each anchored half off a screen edge (no GIFs on this
screen; the idle GIF loops live only in-game) — flanking the tagline *Three books. One
charge. Know the doctrine.* Below: name entry and the primary **"Begin the Charge"**, with "How to
play" and "Leaderboard" as secondary links. Returning players (already named) skip this
screen straight to the Candle home. Mechanics are taught **in-context** by the
first-climb spotlight tutorial — there is no separate lore page.

When generated art is present (`assets/start-bg-portrait.jpg` phone background,
`assets/start-bg-landscape.jpg` tablet/landscape background,
`assets/hero-timothy.png` / `assets/hero-titus.png` full-body transparent characters),
the screen upgrades automatically into a game-store-style composition: phones get the
painted background under a warm parchment veil inside the column; landscape devices get
the scene full-bleed across the viewport with the column floating as a parchment card,
with the full-body characters standing half off the left/right screen edges. Missing
files fall back gracefully — no broken images; every asset upgrades independently.

### 3.2 The Ladder (core loop)
One question at a time, **full-bleed, no chrome** — focus is the point. The climb is
**progressive** — a visible **rung-level ladder** (Recall → … → Synthesis, T1–T7) that
ascends from easy recognition to extremely-hard cross-book synthesis (see `GDD.md §3`).
1. Question + its book/subject chips + a small **rung indicator** (current tier 1–7).
2. **Confidence bid**: `Confident · Certain · "I'll preach it"` — higher stake = bigger
   multiplier (1× / 2× / 3×). Bid *before* seeing options (decision under uncertainty).
3. **Live timer** (count-up, not countdown) — speed feeds your profile "best solve time"
   but never kills a turn (no anxiety bombs); a soft pace hint ("steady / swift / burn")
   appears on higher rungs.
4. Answer → instant **correct / near-miss / wrong** flash (colour + haptic), then:
   - **Correct** → pot grows with a rising-flame animation; rung +1 (unlock next tier).
   - **Near-miss** → "Grace" — half the pot survives, with a gentle correction.
   - **Wrong** → the **correction panel**: the full verse + reference, styled as a
     *handoff of truth*, not a red "X." This is the mandated scriptural correction
     *made into the emotional payoff*.

### 3.3 The Candle (home / retention)
A single lamp flame as the hero. **Lit** = streak alive; **guttering** = at risk;
**smoke** = broken (with a warm "welcome back," never shame). Below it: **oil vials**
(streak shields, earned by play), days-remaining, and a quiet reminder of the daily
Quest. Landing here every day is the Appointment Dynamic. Home order: **The Ladder**
first, **Choose Your Hero**, then the **Daily Quest** — and new players see Hero + Daily
locked until they finish their first Ladder climb. The top-left avatar + name chip opens
the profile, and a live ⚜ score chip shows the running pot during play.

### 3.4 The Daily Quest (shared daily quest)
One timed 10-question Quest seeded per day (same seed → same questions for everyone, so
the leaderboard is fair). Ends in a **spoiler-safe share card** (emoji grid + % + time) —
this is the social engine that makes the men's challenge competitive.

### 3.5 Choose Your Hero (per-book runs)
A home card (below The Ladder, above the Daily Quest) opens the **hero-select screen**:
two large character cards — **Timothy** (1 TIMOTHY · 2 TIMOTHY) and **Titus** (TITUS) —
with art slot, book badge,
blurb, and a "Play as …" pill. Choosing a hero starts a seeded 10-question run made only
of his own book's material, hosted by the book-matched mascot. Three new question types
rotate inside the run:
- **True or False** — a statement judged against the exact KJV verse (2-option layout).
- **Word Order** — the verse's words sit in a shuffled pool; the player taps them into
  the dashed line in order (tap a placed word to take it back; Clear resets). The line
  auto-commits when complete; generous timer (~2.2s per word, min 24s).
- **Who Did This** — "Who forsook Paul?" with four names as options.
Type label sits in the usual `q-type` chip (⚖️ / ✋ / 🗣️). 50/50 is disabled on Word
Order (nothing to hide); Skip and Freeze work everywhere. Runs end in the standard
Charge Report and feed streak, oil, and leaderboard exactly like the other modes.

### 3.6 Leaderboard
Ranked, real-time, scrollable. Columns: rank · name · rank-title · streak · fails ·
best time. **Tabs**: Today's Quest / This week / All time. Your own row is pinned and
highlighted. (Supabase Realtime pushes updates, no refresh.)

### 3.7 The Charge Report (post-game scoring + guidance)
The finish-line screen — the *reward*, not an afterthought. Four stacked parts:

1. **Grade banner** — letter + title (e.g. **A · "Workman Unashamed"**) with a subtle
   scroll/shine on reveal.
2. **Strengths** — top subjects/books/chapters, *"You held fast"* (green).
3. **Weaknesses** — bottom subjects, *"strengthen your charge"* (amber), each with the
   **exact chapter:verse references to revisit**.
4. **"How to do better"** — a 3-line *study prescription*: concrete, cited, next-climb
   action ("Read 1 Tim 5 again — it will come back for you").

A **lifetime** toggle above it shifts to the cumulative report (weak books/chapters/
subjects over time), framed as *shepherding* — never a failure list.

## 4. The leaderboard model

Global, multi-player, real-time via **Supabase**:

- **Auth** — Supabase Auth (email magic-link and/or anonymous → named), JWT sessions.
- **Tables** — `players` (id, name, created_at, streak, fails, total_correct, total_answered,
  best_time_ms), `charges` (id, player_id, seed/date, score, time_ms, created_at),
  `leaderboard` (a materialized view or RLS-enabled query ordered by a composite score).
- **Composite score** (the blend you chose): `accuracy weight × streak × (1 − normalized best-time)`,
  with fails as a tiebreaker. Exact weights tuned in `docs/GDD.md`; kept transparent here.
- **RLS** — each player can read leaderboard reads, write only their own rows.
- **Realtime** — subscribe to the leaderboard channel for live rows.

> ⚠️ **Architecture note (honest flag):** this is the first requirement that *cannot*
> be met by a pure static GitHub Pages site. The **game itself** still deploys static;
> **the leaderboard/auth** becomes a Supabase project + a thin read/write layer.
> This is spec'd here; it is **not built** until you approve the Supabase project.

## 5. Interaction principles

- **Tap targets ≥ 48px**; one primary action per screen; thumb-reach layout.
- **Haptics** on correct/wrong (respecting device settings).
- **Motion** is meaning: flame rises on correct, gutters on miss; never decorative-only.
- **Reduced-motion** respected throughout.
- **Offline-tolerant**: the pre-verified bank is local; leaderboard writes queue and sync
  when back online (a queue, not a lost score).

## 6. Visual language (evolved from the current theme)

Kept as **leather-and-gold**, sharpened for a game (not a doc):

- **Color** — deep umber `#1a120b` ground; gold `#d4a94e` motion/accent; ivory `#f0e9d8`
  text; semantic **correct** = candle-gold-green `#57b57b`, **near-miss** = amber
  `#d99a3d`, **wrong/correction** = muted umber-red `#c05a4a` (never alarming crimson).
- **Type** — a reverent serif (display) + a clean humanist sans (UI/labels); tabular
  figures for all numbers (leaderboard, timers, streaks).
- **Shape** — soft rounded cards (12–16px); pill chips; the Candle flame is the only
  "irregular" shape — it's the brand mark.
- **Elevation** — borders over heavy shadows (warm thin gold borders); layered paper feel.

*Formal tokens (hex/type/spacing/radius) live in `docs/design.md` + `docs/design.html`
when we run the design-system pass — this section is the intent, that pass is the spec.*

## 7. States & edge cases

| State | Behaviour |
|---|---|
| Correct | gold flash + score bump + streak +1 |
| Near-miss | amber "Grace" half-save + correction |
| Wrong (clean) | correction panel, streak reset on Ladder |
| Streak day-missed | Candle gutters (ramp-down, never zero cliff) |
| Streak broken | warm welcome-back + revival path |
| Offline | play continues; writes queued; leaderboard shows cached + "syncing" |
| New player | name prompt → Ladder, no friction |
| Session timeout | counts as a "charge," fail recorded without shame |

## 8. Timing & metric specifics (your asks, pinned)

- **Per-question timer**: count-UP (shows elapsed), never count-down (no anxiety).
- **Streak**: consecutive *days* with a completed Charge, capped at 7; oil-vial shields
  protect it; shown on Candle + profile + leaderboard.
- **No. of Fails**: lifetime wrong answers; public profile stat; tiebreaker in ranking.
- **Best time**: fastest fully-correct Charge; leaderboard column.
- All are **persistent** (Supabase `players`), not per-session.

## 9. Guardrails (enforced, not aspirational)

1. No paywalls, no ads, no loot-box-like purchase loops.
2. Daily caps on Charge attempts (prevents grind that decays into compulsion).
3. Streak loss always has a *kind* recovery path; the app never shames.
4. "Study mode" (untimed, unhurried) sits beside "Charge mode".
5. A visible "what I get wrong" reads as shepherding, never shame.
6. Anonymous data only; leaderboard names user-chosen; nothing else public by default.

## 10. Status matrix (living)

| Item | Status |
|---|---|
| Deterministic quiz — 166-question verified bank + 36 hero questions | 🟢 shipped |
| Named players + profile stats (streak / fails / best time) | 🟢 shipped (local profile) |
| Ladder: confidence bid + count-up timer + grace near-miss | 🟢 shipped |
| **Progressive 7-rung ladder (easy → extremely hard)** | 🟢 shipped |
| **Charge Report (grade + strengths/weaknesses + study Rx)** | 🟢 shipped |
| Candle: capped streak + oil shields + gutter | 🟢 shipped |
| Daily Quest: seeded daily + share card | 🟢 shipped |
| Choose Your Hero: per-book runs (true/false, word order, who-did-this) | 🟢 shipped |
| Title screen painted-background composition + full-body hero art (drop-in assets) | 🟢 shipped (fallbacks to GIFs/gradient) |
| Global real-time leaderboard | 🟡 spec'd — local board shipped |
| Formal design tokens (design.md / design.html) | ⚪ planned |
| Supabase backend implementation | ⚪ planned (needs approval) |

---

*Next: run the design-system pass to freeze visual tokens into `docs/design.md` +
`docs/design.html`, then decide build order (Ladder + Candle first, then Daily Quest,
then the Supabase leaderboard).*
