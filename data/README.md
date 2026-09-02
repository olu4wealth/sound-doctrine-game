# Scripture Lockbox — Provenance

This directory holds the **only** Scripture text the game is allowed to use. Every
question, answer, and correction in the app is pinned to (and machine-verified
against) these three JSON files. The game never calls a language model at play
time, so the AI cannot invent verses.

## Source of truth

- **Repository:** https://github.com/aruljohn/Bible-kjv
- **Branch / commit:** `master`
- **License:** MIT (Copyright (c) 2019 Arul John) — recorded in `data/LICENCE.aruljohn-bible-kjv.txt`
- **Files used (verbatim KJV text):**
  - `1Timothy.json` → `kjv-1timothy.json`
  - `2Timothy.json` → `kjv-2timothy.json`
  - `Titus.json`     → `kjv-titus.json`

The King James Version is public domain. The JSON *encoding* from
aruljohn/Bible-kjv is MIT-licensed, so we may copy, modify, and distribute it
with the copyright notice.

## Scope

Only **1 Timothy, 2 Timothy, and Titus** are in scope. The verifier
(`../verify/check.mjs`) rejects any question referencing a verse outside these
three books.

## JSON shape

```json
{
  "book": "1 Timothy",
  "chapters": [
    {
      "chapter": 1,
      "verses": [
        { "verse": 1, "text": "Paul, an apostle of Jesus Christ ..." }
      ]
    }
  ]
}
```

## Manual-verification note

Per the challenge rule "the builder must personally test and verify the app's
content against Scripture," each question must be hand-compared to the KJV
before shipping, in addition to the automated check. The apostrophe character
(U+2019, the KJV's right single quote) is used verbatim from the source.
