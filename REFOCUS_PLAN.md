# Sound Doctrine — Refocus Plan

## Priority Order (per competition brief)

1. **Scriptural accuracy** ← HIGHEST
2. Question quality/difficulty
3. Ability to expose knowledge gaps
4. Intelligent AI use
5. Engagement/game mechanics
6. Visual polish

---

## Phase 1: Content Audit & Enhancement (DONE: mascot fix; TODO: question expansion)

### Current State
- 69 questions in questions.json
- Coverage gaps: T5/T6/T7 completely empty, many chapter/tier combinations at 0

### Action Items

#### 1.1 Expand question bank to 150+ questions
Target distribution:
```
Tier 1 (Recall): 20 questions
Tier 2 (Recall · Multi): 20 questions  
Tier 3 (Reference): 30 questions
Tier 4 (Discern): 30 questions
Tier 5 (Sequence): 20 questions
Tier 6 (Cross-reference): 20 questions
Tier 7 (Synthesis): 10 questions
```

#### 1.2 Add metadata to every question
Each question needs:
```json
{
  "id": "unique-id",
  "book": "1 Timothy|2 Timothy|Titus",
  "chapter": 1-6|1-4|1-3,
  "subject": "canonical subject tag",
  "category": "Sound doctrine|Faith & grace|Church order|etc",
  "difficulty": 1-7,
  "type": "completion|recall|crossref|synthesis",
  "prompt": "...",
  "options": [...],
  "correctIndex": 0,
  "passage": "Book X:Y",
  "verseText": "exact KJV text",
  "tier": 1-7,
  "skill": "recall|precision|connection|reasoning|synthesis",
  "nearIndexes": [1] // optional: explicitly authored close distractors for Grace
}
```

#### 1.3 Question Validation Gate
Every AI-generated or manually added question must pass:
- [ ] Is every fact in the three books?
- [ ] Is there exactly one defensible answer?
- [ ] Does the answer have a verse reference?
- [ ] Are distractors supported by book content or plausible combinations?
- [ ] Is the question testing the intended difficulty tier?
- [ ] Has this question appeared before (duplicate check)?

---

## Phase 2: Tier Redefinition (T1-T7 as Biblical Synthesis Levels)

### New Tier Definitions

| Tier | Name | What It Tests | Example Pattern |
|------|------|---------------|-----------------|
| T1 | Recall | Direct recall of a single fact | "Complete: 'All scripture is given by ______ of God.'" |
| T2 | Recall · Multi | Precise recall with multiple details | "Timothy's unfeigned faith dwelt first in which two relatives?" |
| T3 | Reference | Multiple details from a passage | Questions requiring knowledge of chapter context |
| T4 | Discern | Connecting information within a book | "Which instruction appears in 1 Timothy 3 concerning bishops?" |
| T5 | Sequence | Ordering or connecting passages across the three books | "Arrange these events from Paul's ministry" |
| T6 | Cross-reference | Multi-step biblical reasoning across books | "1 Timothy 6:20 says 'keep'; what similar charge appears in 2 Timothy 1:14?" |
| T7 | Synthesis | Cross-book thematic synthesis | "What verb appears in both 1 Tim 6:20 and 2 Tim 1:14 for guarding the deposit?" |

### Critical Rule for T6/T7
NO theological interpretation. Only objectively verifiable answers from the text.

Bad: "What does Paul mean by godliness?"
Good: "Which two instructions appear in both 1 Timothy and Titus concerning church leaders?"

---

## Phase 3: AI Integration (Make AI genuinely central)

### Current State
- 95 pre-authored questions, no runtime AI
- Judges will ask: "Where is the AI?"

### Target Architecture

```
1 Timothy ┐
2 Timothy ├→ SCRIPTURE-ONLY KNOWLEDGE BASE → AI GENERATES QUESTION → VALIDATION → PLAYER
   Titus ┘                                        ↓
                                            Scripture-grounded explanation
                                            Performance analysis
                                            Weakness identification
```

### AI Responsibilities
1. **Question Generation**: Generate fresh questions from Scripture corpus
2. **Difficulty Classification**: Auto-classify T1-T7 based on cognitive demand
3. **Duplicate Detection**: Prevent repetition across sessions
4. **Adaptive Selection**: Choose questions based on player performance
5. **Explanation Generation**: Produce Scripture-grounded explanations for wrong answers
6. **Weakness Analysis**: Identify specific knowledge gaps (book/chapter/subject level)
7. **Personalized Reports**: Generate study prescriptions with verse references

### Implementation Approach
- Use existing 95 questions as "gold standard" training data
- AI generates new questions following the same patterns
- Every AI-generated question passes through validation gate
- Scripture remains the authority, not the AI

---

## Phase 4: Home Screen Redesign

### Current Issues
- Too much explanatory text
- Doesn't show the Ladder visually
- Player doesn't immediately see their progression

### Target Layout

```
┌─────────────────────────────────────┐
│  SOUND DOCTRINE                    │
│  Saints, Martyrs & Heroes          │
│                                    │
│  ┌──────────────────────────────┐  │
│  │       YOUR FLAME 🔥          │  │
│  │       5 DAY STREAK           │  │
│  │       Oil × 2                │  │
│  └──────────────────────────────┘  │
│                                    │
│  CROWNBEARER (Tier 4)              │
│                                    │
│  ┌──────────────────────────────┐  │
│  │    TODAY'S OFFICE            │  │
│  │    10 QUESTIONS │ 05:00      │  │
│  │    [BEGIN OFFICE]            │  │
│  └──────────────────────────────┘  │
│                                    │
│  THE LADDER                        │
│        T7 ─ Synthesis              │
│          │                         │
│        T6 ─ Cross-reference        │
│          │                         │
│        T5 ─ Sequence         🔥YOU │
│          │                         │
│        T4 ─ Discern                │
│          │                         │
│        T3 ─ Reference              │
│          │                         │
│        T2 ─ Recall·Multi           │
│          │                         │
│        T1 ─ Recall                 │
│                                    │
│  [Continue Climb] [Study] [Stats]  │
└─────────────────────────────────────┘
```

---

## Phase 5: Mastery Map (Knowledge Gap Visualization)

### Post-Game Report Enhancement

Current: Generic strengths/weaknesses by subject

Target: Detailed mastery map showing:

```
YOUR SCRIPTURE MASTERY

1 TIMOTHY ████████░░ 84%
├─ Ch 1: Leadership ████████░░
├─ Ch 2: Doctrine █████████░
├─ Ch 3: Church Order ███████░░░
├─ Ch 4: Godliness ████████░░
├─ Ch 5: Elders & Widows ██████░░░░
└─ Ch 6: Riches & Contentment █████████░

2 TIMOTHY ██████░░░░ 67%
├─ Ch 1: Encouragement ███████░░░
├─ Ch 2: Endurance ████░░░░░░ ← WEAKEST
├─ Ch 3: Last Days ███████░░░
└─ Ch 4: Final Charge ██████░░░░

TITUS █████████░ 91%
├─ Ch 1: Elders █████████░
├─ Ch 2: Christian Conduct ██████████
└─ Ch 3: Good Works █████████░

SPECIFIC WEAKNESS: 2 Timothy Chapter 2
Accuracy: 43% (3/7 correct)

Missed Verses:
• 2 Timothy 2:3 — "Endure hardness as a good soldier"
• 2 Timothy 2:15 — "Study to shew thyself approved"
• 2 Timothy 2:22 — "Flee youthful lusts"
• 2 Timothy 2:24-25 — "Servant of the Lord"

[RETEST MY WEAKNESS] [STUDY 2 TIMOTHY 2]
```

---

## Phase 6: Confidence Mechanic Clarity

### Current State
Confidence bidding exists but may not be clear enough

### Target Flow

Before answering:
```
HOW CONFIDENT ARE YOU?

1× Safe      (+100 / -100)
2× Cautious  (+200 / -200)  
3× Confident (+300 / -300)
4× Certain   (+400 / -400)
5× Preach It (+500 / -500)

[Select 3×] → Pot: 300 points
Correct: +300 | Wrong: -300
Grace: +150 (near-miss)
```

### Grace Transparency
```
GRACE APPLIED

Your answer was a recognized near-miss.
Normal loss: -300
Grace loss: -150 (50% retained)

"You chose 'faith and love' but the verse says 'faith and a good conscience'"
1 Timothy 1:5 — "Now the end of the commandment is charity out of a pure heart, 
and of a good conscience, and of faith unfeigned."
```

---

## Phase 7: Scripture-Centered Feedback

### Current State
Shows verse reference and text on wrong answers ✓

### Enhancement
Make Scripture the visual center:

```
NOT QUITE

The correct answer was: "a pure heart, and of a good conscience, and of faith unfeigned"

📖 1 Timothy 1:5 (KJV)
"Now the end of the commandment is charity out of a pure heart, 
and of a good conscience, and of faith unfeigned."

Why this matters:
Paul tells Timothy that the goal of all teaching is love flowing from 
three sources: purity of heart, clear conscience, and genuine faith.
```

---

## Phase 8: Rank System Refinement

### Current Ranks (by points)
Recruit → Squire → Deacon → Elder in Training → Elder → Bishop → Good Soldier → Workman Unashamed → Shepherd → Crownbearer

### Target: Ranks Represent Mastery

| Rank | Requirement | Meaning |
|------|-------------|---------|
| Recruit | 0 pts | Beginning the journey |
| Learner | 300 pts | Foundational recall established |
| Steward | 600 pts | Consistent knowledge demonstrated |
| Teacher | 1000 pts | Strong command of basics |
| Elder | 1500 pts | Advanced mastery shown |
| Shepherd | 2000 pts | Broad mastery across books |
| Crownbearer | 2700+ pts | Exceptional command, ready to teach |

---

## Immediate Next Steps (This Week)

1. ✅ Fix mascot positioning (DONE)
2. Audit existing 95 questions for Scripture accuracy
3. Add metadata (category, skill) to all questions
4. Create 20+ new T5/T6/T7 questions with cross-book synthesis
5. Implement question validation script
6. Redesign home screen with visual Ladder
7. Build Mastery Map visualization
8. Enhance post-game report with chapter-level breakdown
9. Make confidence betting more explicit
10. Polish Daily Office share card

---

## Competition Positioning Statement

> **Sound Doctrine** is an AI-powered Scripture mastery game that tests how well you actually know 1 Timothy, 2 Timothy and Titus—not just whether you can answer Bible trivia.

Three mechanics support this:
- **The Ladder** — Tests depth (T1 recall → T7 synthesis)
- **The Candle** — Builds consistency (7-day streak)
- **The Daily Office** — Compete against everyone (same 10 questions daily)

Underneath: AI identifies what you don't know and tells you exactly what to study next.

---

## Decisions — Locked 2026-09-04 (Review Outcome)

These resolve the open questions from the review session and are binding for Phases 1-8.

### D1 — Categories (Phase 1.2)
Use 8 canonical categories as starting taxonomy, extensible if subjects require it:
`Sound Doctrine | Faith & Grace | Church Order | Christian Conduct | Endurance & Faithfulness | False Teaching & Discernment | Last Days | Stewardship & Contentment`
- Implemented via `subject → category` mapping table (`scripts/category-map.json`).
- If a `subject` cannot map cleanly, add a category (you explicitly allowed expansion) and document it in the mapping file.
- Every question will carry `category` after backfill; missing `category` will fail `verify/check.mjs`.

### D2 — Canonical Question File (Phase 1)
`data/questions-merged.json` (currently 128) becomes the **single source of truth**.
- `app.js: loadBank` will change to single `fetch('data/questions-merged.json')` with 3-file fallback during migration.
- Source files `data/questions.json`, `questions-t47.json`, `questions-new.json` retained under `data/src/` as archive/provenance — no longer fetched at runtime.
- Validation gate runs only against `questions-merged.json` (and future `questions-ai.json` candidates before merge).

### D3 — Confidence Mechanic (Phase 6)
Restore 5-tier staking **but not as pre-answer buttons** (your constraint: "mustn't be buttons the player clicks before choosing an answer — not self-explanatory").
- **Approved pattern: two-step confirmation (answer → stake).**
  1. Player taps an answer option (A/B/C/D) — normal knowledge decision.
  2. Confirmation card appears: `You chose B — how sure are you?` with 5 stake choices: `1× Safe (+100/−100) | 2× Cautious (+200/−200) | 3× Confident (+300/−300) | 4× Certain (+400/−400) | 5× Preach It (+500/−500)` — live preview reads `Correct: +300 | Wrong: −300 | Grace (near-miss): +150 (50% retained)`.
  3. Confirm commits; scoring is `± stake × 100` (Grace = 50% loss mitigation, only if `nearIndexes` marks the chosen distractor as a near-miss).
- Rationale: separates knowledge from risk, makes consequence explicit before commit. Alternative behind this (horizontal slider after answer) was considered and rejected for this project — the card is clearer for judges.
- Dependency: `nearIndexes` backfill must complete before Grace triggers; without it, Grace silently falls back to full loss (no invented near-miss).

### D4 — Ranks (Phase 8)
Keep the **10-rank shipped ladder**: `Recruit → Squire → Deacon → Elder in Training → Elder → Bishop → Good Soldier → Workman Unashamed → Shepherd → Crownbearer (0→6000)`.
- Do not switch to the 7-rank proposal (2700+ cap). REFOCUS rank table remains reference only.

### D5 — AI Scope (Phase 3)
**Build-time only** — no runtime LLM calls in the shipped SPA.
- Pipeline: `KJV lockbox (kjv-*.json) → prompt (gold 128) → LLM batch generate 30 candidates → verify/check.mjs 6-gate → human approve → merge into questions-merged.json`.
- Add `data/questions.prompt.md` back to tracking (remove from .gitignore) as few-shot source; add `scripts/ai-generate.mjs` + `docs/AI-PIPELINE.md` diagram (`Scripture-only knowledge base → AI generates → Validation → Player`) for judges.
- Runtime responsibilities (duplicate avoidance, adaptive selection, weakness analysis, personalized reports) stay in `game-core.js`/`storage.js` using static bank — demonstrably `AI generates, Scripture verifies`.

### D6 — Repo Hygiene (Phase 0, completed)
Fast-forwarded `75be1df..c7bdad5`, restored `REFOCUS_PLAN.md` + `questions-merged.json`, fixed `.gitignore` to project-tailored version, now tracking `package-lock.json`. `serve@14.2.6` in devDeps ensures `npx serve . -l 4173` reproducibility. `app.css` synced to `100px / 80px@420px, top:-80px` mascot-above-modal fix.
- Verified: `verify/check.mjs PASSED (128)`, `game-core.test 36/36`, `playwright 18/18`.
