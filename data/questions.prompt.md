# Question Bank — Generation & Verification Notes

## How the bank is produced (D5: build-time only)

The game's questions are **pre-generated and machine-verified**, not invented
live. The canonical bank is `data/questions-merged.json` (150 questions, D2).
Source files under `data/src/` are provenance only.

Every question follows this schema:

```json
{
  "id": "new-t5-001",
  "book": "1 Timothy | 2 Timothy | Titus",
  "chapter": 6,
  "subject": "contentment",
  "category": "Stewardship & Contentment",
  "difficulty": 5,
  "type": "sequence",
  "prompt": "Which is the correct KJV word-order of 1 Timothy 6:6?",
  "options": ["...", "...", "...", "..."],
  "correctIndex": 0,
  "passage": "1 Timothy 6:6",
  "verseText": "But godliness with contentment is great gain.",
  "tier": 5,
  "skill": "reasoning",
  "nearIndexes": [1]
}
```

Tiers map to `skill` (D1): T1 `recall` · T2 `precision` · T3 `connection` · T4-6 `reasoning` · T7 `synthesis`.
`nearIndexes` marks which distractor(s) are close enough to trigger Grace (D3, two-step stake).

## Build-time AI pipeline (D5)

```
KJV lockbox (data/kjv-*.json)
  → prompt template (this file + 8 gold examples per tier)
  → LLM batch generate 30 candidates (offline, human-invoked)
  → verify/check.mjs 6-gate validator
  → human approve
  → merge into data/questions-merged.json
```

Steps:

1. Choose a model (configured via env, not shipped). Provide the KJV excerpts
   for the target chapter(s) + 2 gold examples at the target tier.
2. Run `node scripts/ai-generate.mjs --tier 5 --count 10 --out data/questions-ai.json`
   (build-time only, never called in the browser).
3. Run `node verify/check.mjs data/questions-ai.json` — every candidate must pass
   all 6 gates (see `verify/check.mjs` header). Failures are discarded, not fixed.
4. Human reviews survivors (KJV spot-check) and merges: `node scripts/merge-ai.mjs`.

No runtime LLM calls are shipped. The app fetches only `questions-merged.json`.

## Generation rules (the "AI contract")

1. **Every question** must have an objectively verifiable answer drawn
   verbatim from 1 Timothy, 2 Timothy, or Titus (KJV).
2. **`verseText`** must reproduce the KJV verse for `passage` *exactly*
   (character-for-character, including U+2019 apostrophes and archaic spelling).
3. **Distractor options** must be credible and, wherever possible, taken from
   the same three books. At least one distractor should be marked `nearIndexes`
   when it is a plausible near-miss (for Grace).
4. **No verse outside** the three pastoral epistles may be referenced or quoted.
5. **`correctIndex`** must point at the one true answer among 4 distinct options.
6. **T6/T7** must not require theological interpretation — only verifiable text
   overlap (e.g. shared verb, shared qualification, same headed phrase).
7. Every candidate needs `category` (one of the 8) and `skill` per tier map.

## Verifying

Run from the repo root:

```
node verify/check.mjs
```

It asserts per question (6 gates):
- A) verseText exact KJV match, passage in scope
- B) 4 distinct options, correctIndex 0-3
- C) passage resolves to a real verse
- D) distractors plausible (no outside-book mentions)
- E) tier/skill/category/difficulty/chapter consistent
- F) no duplicate id or prompt hash

This check is in **addition** to the required personal, manual
comparison of each question against a physical/canonical KJV (challenge rule 6).

Backfill audit:

```
node scripts/backfill-metadata.mjs        # dry run audit
node scripts/backfill-metadata.mjs --write  # persist category/skill/difficulty
```
