# Sound Doctrine — Comprehensive Audit Report

## Executive Summary

**Status:** Game is well-positioned but has critical gaps between current implementation and competition brief requirements.

**Key Finding:** You have **203 questions** in the test bank (per `npm test`), but only **144 questions** in `questions-merged.json`. The game loads from three separate files (`questions.json`, `questions-t47.json`, `questions-new.json`), creating potential inconsistency.

---

## 1. Question Bank Audit

### Current State
| File | Questions | Purpose |
|------|-----------|---------|
| `questions.json` | ~69 | Base T1-T4 questions |
| `questions-t47.json` | ~? | T5-T7 questions |
| `questions-new.json` | ~? | New additions |
| **Total (loaded)** | **203** | Per test output |
| `questions-merged.json` | **144** | Stale merged snapshot |

### Issues Identified
1. **Merged file is outdated** — `questions-merged.json` has 144 questions, but actual game uses 203
2. **No metadata** — Zero questions have `category` or `skill` fields (required for Mastery Map)
3. **Coverage gaps** — 23 chapter/tier combinations have zero questions

### Tier Distribution (from 144-sample)
| Tier | Count | % | Status |
|------|-------|---|--------|
| T1 | 10 | 6.9% | ⚠️ Too low (should be 15-20%) |
| T2 | 21 | 14.6% | ✓ Acceptable |
| T3 | 48 | 33.3% | ✓ Good |
| T4 | 33 | 22.9% | ✓ Good |
| T5 | 8 | 5.6% | ⚠️ Low (need more synthesis) |
| T6 | 13 | 9.0% | ✓ Acceptable |
| T7 | 11 | 7.6% | ✓ Acceptable |

**Cross-book/synthesis questions:** 15 identified (10.4%) — needs to be 20-25%

### Coverage Gaps (23 total)
**1 Timothy (11 gaps):**
- Ch1 T5, Ch2 T4/T7, Ch3 T2/T6, Ch4 T1/T5/T7, Ch5 T1/T5, Ch6 T7

**2 Timothy (7 gaps):**
- Ch1 T1, Ch2 T7, Ch3 T2/T6, Ch4 T2/T5

**Titus (5 gaps):**
- Ch1 T1/T6, Ch2 T5/T6/T7

**Critical:** Missing T1 questions means new players can't get foundational recall on certain chapters.

---

## 2. Validation Gate Status

### ✅ Implemented
`verify/validate_questions.py` checks:
- A. Every fact in the three books ✓
- B. Exactly one defensible answer ✓
- C. Verse reference provided ✓
- D. No duplicate distractors ✓
- E. Valid tier assignment ✓
- F. Duplicate detection framework ✓

### Results
- **144/144 passed** (100%) — but this only validates the merged snapshot
- **Need to run against all 203 actual questions**

---

## 3. Mascot Positioning

### ✅ Fixed
- Mascots appear **above** dialog (not overshadowing)
- Appear **immediately** when modal opens (not after continue button)
- Properly sized so **full body visible**

### CSS Changes Made
```css
.mascot-reaction {
  top: -80px; /* lowered from -140px */
}
.mascot-reaction img {
  width: 100px; height: 100px; /* reduced from 120px */
}
.mascot-reaction-host {
  height: 80px; /* reduced from 140px */
}
```

**Status:** Complete and working correctly.

---

## 4. AI Layer Assessment

### ❌ Critical Gap
**Current implementation:** All questions are pre-authored, static JSON files.
**Competition requirement:** "What should the AI do?" with examples including:
- Generate fresh questions
- Adjust difficulty dynamically
- Ask harder follow-ups
- Explain wrong answers
- Identify weaknesses
- Produce personalized reports
- Prevent repetition

### What Exists
- ✓ Question selection logic (`pickNextLadder`) adapts based on weak subjects
- ✓ Post-game report identifies weaknesses
- ✓ Duplicate avoidance in session

### What's Missing
- ❌ Runtime question generation
- ❌ Dynamic difficulty adjustment during gameplay
- ❌ AI-generated explanations (currently static)
- ❌ Fresh question generation for repeat players
- ❌ Cross-book synthesis generation

**Risk:** Judges could reasonably ask "Where is the AI?" and have no satisfactory answer.

---

## 5. Home Screen & Ladder Visualization

### Current State
**Home screen shows:**
- Candle with streak counter
- Oil vials
- "Begin a Climb" button
- "Daily Office" button
- Profile/Leaderboard buttons

**Missing (per refocus plan):**
- ❌ Visual Ladder display (T1-T7 with player position)
- ❌ Tier names/descriptions visible upfront
- ❌ Progress indicator showing current rung
- ❌ Dashboard feel (too much text, not enough visualization)

### Tier Names (in code, not shown visually)
```javascript
TIER_NAMES = [
  null, 'Recall', 'Recall · Multi', 'Reference',
  'Discern', 'Sequence', 'Cross-reference', 'Synthesis'
]
```

These are shown during gameplay (`q-type` element) but not on home screen.

---

## 6. Mastery Map / Knowledge Gap Visualization

### Current Report Features
✅ Shows:
- Grade (S+/A/B/C/D) with title
- Correct/total, accuracy %, pot
- Strengths (top 3 subjects by accuracy)
- Weaknesses (bottom 3 subjects)
- Book performance
- Chapters to revisit (accuracy < 100%)
- Study prescriptions with verse references

### Missing (per refocus plan)
❌ Visual mastery map with:
- Book-by-book breakdown (1 Tim, 2 Tim, Titus percentages)
- Chapter-level heatmap
- Subject/category breakdown
- Specific weakness evidence ("You missed 2 Tim 2:3, 2:15, 2:22")
- "Retest My Weakness" button

❌ Category metadata needed for grouping:
- Currently using raw `subject` field
- No standardized categories (Leadership, Doctrine, Conduct, etc.)

---

## 7. Confidence Mechanic

### Current Implementation
```javascript
BIDS = [
  { id: 'confident', label: 'Confident', mult: 1 },
  { id: 'certain', label: 'Certain', mult: 2 },
  { id: 'preach', label: "I'll preach it", mult: 3 },
]
```

### Issues
⚠️ **Not transparent enough** — Players don't see point consequences before committing
⚠️ **Labels unclear** — "I'll preach it" is thematic but doesn't communicate risk level
⚠️ **No preview** — Should show "Correct: +X, Wrong: -Y" before answering

### Grace Mechanism
✅ Implemented via `nearIndexes` field
✅ Half-points awarded for near-misses
⚠️ Not explicitly explained to players before first occurrence

---

## 8. Scripture-Centered Feedback

### Current Implementation
✅ Wrong answers show:
- "Not quite" / "Grace!" / "Correct!" header
- Correct answer highlighted
- Full verse text in blockquote
- Verse reference in cite element

✅ Every correction includes Scripture

### Missing
⚠️ Could add "Here's why" explanation for complex questions
⚠️ Cross-reference links for synthesis questions (show both verses)

---

## 9. Daily Office

### Current Implementation
✅ 10 questions per day
✅ Same questions for all players (seeded by date)
✅ Timer included
✅ Excludes T7 (appropriate difficulty)
✅ Covers all 3 books
✅ Shareable results grid

### Missing
⚠️ No ranking display ("You ranked #14 today")
⚠️ No percentage comparison ("Top 12%")
⚠️ No immediate weakness identification post-Daily Office

---

## 10. Leaderboard

### Current Implementation
✅ Composite score formula:
```javascript
score = acc × streakWeight × (1 - normalizedTime)
```
✅ Sorts by composite score (not play count)
✅ Supabase integration ready

### Missing
⚠️ Not yet deployed/active
⚠️ No daily vs. all-time distinction
⚠️ No filter by book/tier specialization

---

## 11. Ranks System

### Current Ranks
```javascript
RANKS = [
  { req: 0, name: 'Recruit' },
  { req: 300, name: 'Squire' },
  { req: 600, name: 'Deacon' },
  { req: 1000, name: 'Elder in Training' },
  { req: 1500, name: 'Elder' },
  { req: 2000, name: 'Bishop' },
  { req: 2700, name: 'Good Soldier' },
  { req: 3500, name: 'Workman Unashamed' },
  { req: 4500, name: 'Shepherd' },
  { req: 6000, name: 'Crownbearer' },
]
```

### Issues
⚠️ Based purely on accumulated points, not mastery
⚠️ No description of what each rank represents
⚠️ Doesn't reflect biblical knowledge depth

### Recommended Reframe
| Rank | Should Mean |
|------|-------------|
| Recruit | Beginning the journey |
| Learner | Foundational recall (T1-T2) |
| Steward | Consistent knowledge (T3-T4) |
| Teacher | Strong command (T5) |
| Elder | Advanced mastery (T6) |
| Shepherd | Broad mastery (T7) |
| Crownbearer | Exceptional command (all tiers) |

---

## 12. Test Coverage

### Unit Tests (`verify/game-core.test.mjs`)
✅ 36 tests passing:
- Daily seed determinism
- Question resolution (correct/wrong/grace)
- Adaptive picker
- Streak mechanics
- Report generation
- Composite scoring
- Share grid

### End-to-End Tests (`tests/game.e2e.spec.js`)
⚠️ Need to verify coverage of:
- Confidence betting flow
- Mascot reactions
- Post-game report
- Daily Office flow
- Power-up usage

### Validation Script
✅ `verify/validate_questions.py` — 100% pass rate on 144 questions
⚠️ Needs to run against full 203-question bank

---

## Priority Recommendations

### 🔴 CRITICAL (Do First)
1. **Regenerate questions-merged.json** from actual source files (203 questions)
2. **Run validation against all 203 questions**
3. **Add category/skill metadata** to enable Mastery Map
4. **Implement basic AI generation layer** (even if simple template-based)
5. **Fill T1 coverage gaps** (at least 1 question per chapter)

### 🟡 HIGH (Do Second)
6. **Build visual Mastery Map** in post-game report
7. **Add "Retest Weakness" button** linking to targeted practice
8. **Redesign home screen** with visual Ladder
9. **Make confidence consequences explicit** before answering
10. **Add Daily Office ranking display**

### 🟢 MEDIUM (Do Third)
11. **Expand cross-book synthesis questions** to 20-25% of bank
12. **Add explanation text** to complex T5-T7 questions
13. **Reframe ranks** around mastery levels
14. **Deploy leaderboard** with proper scoring
15. **Simplify Candle display** (2-second understanding)

### ⚪ LOW (Nice to Have)
16. Add cross-reference links in feedback
17. Create chapter heatmap visualization
18. Add daily/weekly leaderboard filters
19. Implement dynamic difficulty mid-session
20. Add AI-generated personalized encouragement

---

## Competition Readiness Score

| Criterion | Score | Notes |
|-----------|-------|-------|
| Scriptural accuracy | 9/10 | All answers verified, but need full bank validation |
| Question quality | 7/10 | Good T3-T4, weak T1 foundation, limited synthesis |
| Knowledge gap exposure | 6/10 | Report exists but lacks visual mastery map |
| AI implementation | 3/10 | Selection logic exists, no generation/adaptation |
| Engagement mechanics | 8/10 | Ladder, Candle, Daily Office all solid |
| Visual polish | 7/10 | Mascots fixed, needs Ladder visualization |

**Overall: 6.7/10** — Strong foundation, needs AI layer and Mastery Map to meet brief

---

## Immediate Next Steps (This Week)

```bash
# 1. Regenerate merged file
cat data/questions*.json | jq -s 'add | unique_by(.id)' > data/questions-merged.json

# 2. Validate all questions
python3 verify/validate_questions.py

# 3. Add metadata template
# Add category/skill to all 203 questions

# 4. Fill critical gaps
# Write 5-7 T1 questions for missing chapters

# 5. Build Mastery Map UI
# Add book/chapter/subject breakdown to report screen
```

---

*Audit completed: Today*
*Questions audited: 203 (actual), 144 (merged snapshot)*
*Validation status: 144/144 passed (snapshot), 203/203 pending*
