# Sound Doctrine — Research Notes (why each mechanic hooks)

Every "fun" mechanic in the GDD is traceable to a source and to an Octalysis
Core Drive (CD2 = Accomplishment · CD4 = Ownership · CD5 = Social ·
CD6 = Scarcity · CD7 = Unpredictability · CD8 = Loss & Avoidance).
This file is the guard against "generic gamification" — nothing ships that isn't
mapped here.

## 1. Streaks convert effort into identity — CD2 → CD8

Duolingo's streak counter lifted **next-day retention from 12% → 55%**. The force
isn't the joy of extending the streak; it's the *dread of losing it* (CD8).
A streak becomes a statement about *who the user is*, so breaking it feels like
breaking the self.

**Adopted:** the Candle (7-day capped streak + oil-vial shields).
**Guardrail applied:** Chou's warning — infinite streaks create burnout and a
"cliff" on one missed day. We cap at 7 (paired with a lifetime counter) and use a
gentle *gutter*, a shame-free welcome-back, and earn-it-back revival — never pay.

- [Streak Design: The 5 Steps Behind Duolingo's Daily Loop — Yu-kai Chou](https://yukaichou.com/gamification-study/master-the-art-of-streak-design-for-short-term-engagement-and-long-term-success)

## 2. Goal gradient + near-miss — CD2 + CD7 + CD8

People invest *more* effort and feel *more* positive as they near a goal (goal
gradient); a **near miss** (almost, but not quite) stings yet stirs the desire to
try again — often more than a clean loss. Wordle's tight five-guess ladder leans on
exactly this.

**Adopted:** the Ladder — visible rungs you nearly reached; a **Grace** half-save on a
near-miss so the "almost" is a hook, not a punishment.

- [Using "Wordle" to assess goal-gradient and near-misses — Nature / Scientific Reports (2024)](https://www.nature.com/articles/s41598-024-74450-0)
- [Near-miss effect — Wikipedia](https://en.wikipedia.org/wiki/Near-miss_effect)

## 3. Anticipation & uncertainty drive dopamine — CD7

The brain's reward system responds most to *anticipation and uncertainty*, not to
the payoff itself. This is why mystery boxes and variable rewards compel.

**Adopted:** the confidence bid (you risk *before* you see the options) and the
oil-vial reward cadence — variable, anticipated, earned.

- [The psychology of games: why we play and keep playing — Guul Games](https://guul.games/blog/the-psychology-behind-game-engagement-why-we-play-and-stay)

## 4. Double-or-nothing converts trivia into nerve — CD8 + CD2

The most gripping quiz format stakes a growing pot on each next answer: one miss
burns it. "The Ladder" (Problyx) and Cash Cab's double-or-nothing make every answer
carry escalating consequence.

**Adopted:** the Ladder's bid-and-multiply pot.

- [The Ladder — a double-or-nothing prediction quiz — Problyx](https://www.problyx.com/play/ladder)
- [Decision-making under uncertainty in the Cash Cab — Lake Forest College](https://campus.lakeforest.edu/lemke/cash_cab_acp.pdf)

## 5. Shared daily ritual = identity + pacing — CD5 + CD6

NYT Wordle/Connections succeed on *quiet pacing* (one a day), *identity* ("I solved
it — here's proof"), and a *common ritual* shared socially. The share card is the
social payoff.

**Adopted:** the Daily Office (one seeded charge/day + spoiler-safe share card).

- [Wordle, Connections and Strands: NYT Puzzle Psychology](https://mysterious.top/inside-the-nyt-puzzle-factory-how-connections-wordle-and-str)

## 6. Daily rewards as habit loops — CD6 + CD8

Daily-reward psychology: habit + appointment drives retention without shame when
framed as progress, not a tax.

**Adopted:** the Candle's Appointment Dynamic ("keep it lit" every day), balanced so
CD6 (come *for* the reward) and CD8 (return *to avoid* loss) both fire.

- [The Psychology of Daily Rewards — PM Playground](https://pmplayground.substack.com/p/the-psychology-of-daily-rewards-why)

## Source-of-truth guardrails for every mapped hook

1. Maps to a real, citable source (above).
2. Never conflicts with a challenge rule (Q&A from the 3 books, correction cites
   Scripture, AI can't invent, mobile-only, builder verifies).
3. Respects the Guardrails in `GDD.md §5` (no pay-to-win/ads/loot loops, capped
   compulsion, kind loss, Study mode, shame-free).
