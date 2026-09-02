# Question Bank — Generation & Verification Notes

## How the bank is produced

The game's questions are **pre-generated and machine-verified**, not invented
live. The seed bank in `questions.json` was authored against the KJV lockbox
(see `data/README.md`), following this fixed schema:

```json
{
  "id": "1ti-1-15",
  "book": "1 Timothy",
  "chapter": 1,
  "subject": "faithful sayings",
  "difficulty": 1,
  "type": "completion",
  "prompt": "...",
  "options": ["...", "...", "...", "..."],
  "correctIndex": 0,
  "passage": "1 Timothy 1:15",
  "verseText": "This is a faithful saying, ..."
}
```

## Generation rules (the "AI contract")

1. **Every question** must have an objectively verifiable answer drawn
   verbatim from 1 Timothy, 2 Timothy, or Titus (KJV).
2. **`verseText`** must reproduce the KJV verse for `passage` *exactly*
   (character-for-character, including U+2019 apostrophes and archaic spelling).
3. **Distractor options** must be credible and, wherever possible, taken from
   the same three books.
4. **No verse outside** the three pastoral epistles may be referenced or quoted.
5. **`correctIndex`** must point at the one true answer.

## Verifying

Run the machine check from the repo root:

```
node verify/check.mjs
```

It asserts, for every question:
- the `passage` resolves to a real book/chapter/verse in the lockbox;
- the `passage` is within the three allowed books;
- `verseText` exactly matches that verse in the lockbox;
- `correctIndex` is in range and there are exactly 4 options.

This automated check is in **addition** to the required personal, manual
comparison of each question against a physical/canonical KJV (challenge rule 6).
