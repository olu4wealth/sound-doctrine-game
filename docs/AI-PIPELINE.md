# AI Pipeline — Sound Doctrine (D5: Build-time only)

> Judges' question: "Where is the AI?" — answer in one diagram.

```
1 Timothy ─┐
2 Timothy ─┤► KJV lockbox (data/kjv-*.json, exact text, U+2019)
   Titus ──┘          │
                      ▼
              Scripture-only knowledge base
                      │
                      ▼
              AI generates candidates
              (scripts/ai-generate.mjs, offline)
              prompt = KJV excerpts + 8 gold examples per tier
                      │
                      ▼
              6-gate validator
              (verify/check.mjs: A-F)
                      │
                 ┌────┴────┐
                 │  FAIL   │ ──► discard (no auto-fix)
                 └────┬────┘
                      │ PASS
                      ▼
              Human approve (KJV spot-check)
                      │
                      ▼
              Merge into canonical bank
              (scripts/merge-ai.mjs -> data/questions-merged.json)
                      │
                      ▼
                 Player
                 (static SPA, no runtime LLM)
                      │
                      ▼
              Scripture-grounded feedback
              (verse + reference + near-miss Grace)
                      │
                      ▼
              Weakness analysis + prescriptions
              (game-core.js buildChargeReport, category/chapter)
```

## Why build-time only

- **Scripture is the authority, not the model.** Every question is verified
  character-for-character against the lockbox before a player ever sees it.
- **No hallucination risk in production** — the shipped site makes zero
  network calls to an LLM; judges can inspect the Network tab.
- **Reproducible** — `node verify/check.mjs` gates every commit; the bank
  is auditable as a static file.

## What the AI does (7 responsibilities, all offline)

1. **Question generation** — propose fresh questions at a target tier
2. **Difficulty classification** — `difficulty`/`skill` per tier map (T1 recall … T7 synthesis)
3. **Duplicate detection** — id + prompt hash dedupe (Gate F)
4. **Adaptive selection** — `game-core.js: pickNextLadder` biases to weak categories/chapters
5. **Explanation generation** — verse + reference + Grace math (no theology invention)
6. **Weakness analysis** — `buildChargeReport` per category/book/chapter
7. **Personalized reports** — study prescriptions with chapter:verse citations

Items 4-7 run **in the browser** on the static bank (no model call). Items 1-3 run **at build time** via the scripts below.

## Scripts

| Script | Purpose |
|---|---|
| `data/questions.prompt.md` | Few-shot prompt + AI contract (8 gold examples per tier) |
| `scripts/ai-generate.mjs --tier 5 --count 10 --out data/questions-ai.json` | Batch-generate candidates (stub when `SOUND_DOCTRINE_LLM_PROVIDER=none`) |
| `verify/check.mjs` | 6-gate Scripture validator (A-F) + coverage report |
| `scripts/merge-ai.mjs --in data/questions-ai.json` | Human-approved merge (re-validates combined bank) |
| `scripts/backfill-metadata.mjs [--write]` | Category/skill/difficulty audit & fill |

## Environment (optional)

```
SOUND_DOCTRINE_LLM_PROVIDER=openai|anthropic|none   # default none (stub)
OPENAI_API_KEY / ANTHROPIC_API_KEY                   # only if provider != none
```

When `none`, `ai-generate.mjs` emits a **stub template** you can fill manually
or pipe through an external LLM, then validate with `verify/check.mjs` before merging.

## Verification

```
node verify/check.mjs        # 6 gates + coverage (current bank: 150, PASSED with 4 warnings)
node verify/game-core.test.mjs  # 36 unit tests
node scripts/backfill-metadata.mjs  # category/skill audit
```
