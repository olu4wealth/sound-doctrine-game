# Sound Doctrine - Refocus Progress Report

> **ℹ️ Historical snapshot.** Numbers reflect the 144-question era. Current canonical
> bank: 166 questions (`data/questions-merged.json`). The living status matrix is in
> `docs/GDD.md` / `docs/UI-UX.md`.

## Executive Summary

Transformed Sound Doctrine from a Bible quiz game into a Scripture mastery engine aligned with competition judging criteria.

---

## Key Achievements

### 1. Question Bank Expansion & Standardization

**Before:** 69 questions (T1-T4 only in main file)
**After:** 144 validated questions across all tiers

| Tier | Count | % of Total | Description |
|------|-------|------------|-------------|
| T1   | 10    | 6.9%       | Direct recall |
| T2   | 21    | 14.6%      | Precise recall |
| T3   | 48    | 33.3%      | Multiple details |
| T4   | 33    | 22.9%      | Within-book connections |
| T5   | 8     | 5.6%       | Cross-passage synthesis |
| T6   | 13    | 9.0%       | Multi-step reasoning |
| T7   | 11    | 7.6%       | Cross-book synthesis |

**Cross-book/synthesis questions:** 27 (18.8%)

### 2. Coverage Matrix

All 13 chapters covered across 1 Timothy (6), 2 Timothy (4), and Titus (3).

**Remaining Gaps:** 23 chapter/tier combinations (down from 36)
- Priority gaps: T1 questions for 1 Tim 4-5, 2 Tim 1, Titus 1
- Upper tier gaps distributed across books

### 3. Question Validation Gate

Created `verify/validate_questions.py` implementing the 6-point validation:
- ✓ A: Every fact in the three books
- ✓ B: Exactly one defensible answer
- ✓ C: Verse reference provided
- ✓ D: Plausible distractors (no duplicates)
- ✓ E: Valid difficulty tier
- ✓ F: Duplicate detection (framework ready)

**Validation Result:** 144/144 questions passed (100%)

### 4. Tier Redefinition

Tiers now represent biblical synthesis levels, not just difficulty:

| Tier | Tests |
|------|-------|
| T1 | Direct recall |
| T2 | Precise recall |
| T3 | Multiple details from a passage |
| T4 | Connecting information within a book |
| T5 | Connecting passages across the three books |
| T6 | Multi-step biblical reasoning |
| T7 | Cross-book synthesis |

### 5. Mascot Positioning Fixed

Happy/sad mascots now appear:
- Above the popup dialog (not overshadowing)
- Immediately when modal opens (not after continue button)
- Properly sized so full body is visible

---

## Architecture Alignment

### Scripture as Authority
```
1 Timothy + 2 Timothy + Titus (KJV)
           ↓
   SCRIPTURE KNOWLEDGE BASE
           ↓
   AI generates questions
           ↓
   Validation gate
           ↓
   Player answers
           ↓
   Scripture reference shown
           ↓
   Explanation grounded in text
```

### AI Role Clarified
- AI generates and adapts questions
- Scripture constrains and verifies
- Every answer objectively verifiable against KJV text

---

## Remaining Work (Prioritized)

### Phase 1 — Content (Current)
- [x] Merge question files
- [x] Add T5-T7 synthesis questions
- [x] Create validation gate
- [ ] Fill remaining 23 coverage gaps
- [ ] Add metadata (category, skill) to all questions

### Phase 2 — AI Layer
- [ ] Implement runtime question generation
- [ ] Adaptive difficulty based on performance
- [ ] Weak-area targeting
- [ ] Duplicate avoidance
- [ ] Scripture-grounded explanations

### Phase 3 — Mastery Map
- [ ] Book/chapter/subject visualization
- [ ] Knowledge gap identification
- [ ] Study prescription generation
- [ ] Retest weakness feature

### Phase 4 — Home Screen UX
- [ ] Visual Ladder display
- [ ] Dashboard with Flame/Candle/Daily Office
- [ ] Clear confidence mechanic explanation
- [ ] Scripture-centered feedback

### Phase 5 — Competition Features
- [ ] Daily Office polish (identical questions + timer + share)
- [ ] Leaderboard (performance-based, not play-count)
- [ ] Simplified Candle display

---

## Competition Positioning Statement

> **Sound Doctrine** is an AI-powered Scripture mastery game that tests how well you actually know 1 Timothy, 2 Timothy and Titus—not just whether you can answer Bible trivia.

**Three Mechanics:**
- **The Ladder** — Tests depth through T1-T7 synthesis tiers
- **The Candle** — Builds consistency with streak tracking
- **The Daily Office** — Daily competition with identical challenges

**Underneath:** AI identifies knowledge gaps and prescribes specific Scripture study.

---

## Files Modified/Created

| File | Action | Purpose |
|------|--------|---------|
| `data/questions.json` | Updated | Master question bank (144 questions) |
| `data/questions-merged.json` | Created | Working merged dataset |
| `verify/validate_questions.py` | Created | Question validation gate |
| `app.css` | Modified | Mascot positioning fixes |
| `PROGRESS_REPORT.md` | Created | This document |

---

## Next Immediate Actions

1. **Fill critical T1 gaps** — Add 5-7 questions for missing chapter/T1 combinations
2. **Add metadata fields** — category, skill to all questions
3. **Build Mastery Map UI** — Post-game report with visual breakdown
4. **Redesign home screen** — Show Ladder visually, simplify text

---

*Generated: Today*
*Questions: 144 (100% validated)*
*Coverage: 13/13 chapters, 23/91 tier-chapter gaps remaining*
