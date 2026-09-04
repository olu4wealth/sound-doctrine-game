#!/usr/bin/env node
// scripts/build-heroes.mjs — builds data/heroes.json for the Choose Your Hero mode.
// Curated hero question spec: true/false, word-order, and who-did-this items per hero
// (Timothy -> 1 & 2 Timothy, Titus -> Titus). All scripture is pulled VERBATIM from
// data/kjv-*.json at build time — nothing is hand-typed. Validation is strict:
//   - TRUE statements must be an exact substring of the referenced KJV verse.
//   - FALSE statements must NOT appear anywhere in the three books.
//   - Word-order segments must be exact substrings of the referenced verse.
//   - ids and prompts must be unique; who-did-this must have 3 distractors.
// Usage: node scripts/build-heroes.mjs   (writes data/heroes.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ---------- KJV lockbox ----------
const BOOK_FILES = {
  '1 Timothy': 'kjv-1timothy.json',
  '2 Timothy': 'kjv-2timothy.json',
  Titus: 'kjv-titus.json',
};
const lockbox = {};
for (const [book, file] of Object.entries(BOOK_FILES)) {
  const raw = JSON.parse(readFileSync(join(root, 'data', file), 'utf8'));
  lockbox[book] = {};
  for (const ch of raw.chapters) {
    lockbox[book][ch.chapter] = {};
    for (const v of ch.verses) lockbox[book][ch.chapter][v.verse] = v.text;
  }
}
function verseOf(book, chapter, verse) {
  const t = lockbox[book]?.[chapter]?.[verse];
  if (t === undefined) throw new Error(`Ref not found in KJV lockbox: ${book} ${chapter}:${verse}`);
  return t;
}
const fullCorpus = () => Object.values(BOOK_FILES)
  .map((f) => readFileSync(join(root, 'data', f), 'utf8'))
  .join('\n');

// ---------- Curated hero question spec ----------
// kind: 'truefalse' (tf: true|false), 'wordorder' (segment of the verse),
// 'whodid' (prompt + correct + exactly 3 distractors).
// Tier mapping: truefalse -> 2 (Recall), whodid -> 3 (Reference), wordorder -> 5 (Sequence).
const SPEC = {
  timothy: [
    // ----- True / False -----
    { kind: 'truefalse', tf: true,  book: '1 Timothy', chapter: 1,  verse: 15, subject: 'faithful sayings',
      statement: 'Christ Jesus came into the world to save sinners; of whom I am chief.' },
    { kind: 'truefalse', tf: true,  book: '2 Timothy', chapter: 1,  verse: 12, subject: "paul's testimony",
      statement: 'I know whom I have believed, and am persuaded that he is able to keep that which I have committed unto him against that day.' },
    { kind: 'truefalse', tf: true,  book: '1 Timothy', chapter: 2,  verse: 5,  subject: 'mediator',
      statement: 'there is one God, and one mediator between God and men, the man Christ Jesus' },
    { kind: 'truefalse', tf: false, book: '2 Timothy', chapter: 1,  verse: 5,  subject: "timothy's family",
      statement: "Timothy's unfeigned faith dwelt first in his grandmother Eunice, and his mother Lois." },
    { kind: 'truefalse', tf: false, book: '2 Timothy', chapter: 4,  verse: 20, subject: 'travel plans',
      statement: 'Trophimus have I left at Corinth sick.' },
    { kind: 'truefalse', tf: false, book: '1 Timothy', chapter: 6,  verse: 10, subject: 'money',
      statement: 'The love of money is the root of all unrighteousness.' },
    // ----- Word order -----
    { kind: 'wordorder', book: '2 Timothy', chapter: 2, verse: 13, subject: 'faithfulness of God' },
    { kind: 'wordorder', book: '2 Timothy', chapter: 2, verse: 15, subject: 'study',
      segment: 'Study to shew thyself approved unto God, a workman that needeth not to be ashamed' },
    { kind: 'wordorder', book: '1 Timothy', chapter: 6, verse: 6,  subject: 'contentment' },
    { kind: 'wordorder', book: '2 Timothy', chapter: 1, verse: 7,  subject: 'spirit',
      segment: 'For God hath not given us the spirit of fear; but of power, and of love' },
    { kind: 'wordorder', book: '1 Timothy', chapter: 4, verse: 12, subject: 'example',
      segment: 'Let no man despise thy youth; but be thou an example of the believers' },
    { kind: 'wordorder', book: '2 Timothy', chapter: 4, verse: 2,  subject: 'preaching',
      segment: 'Preach the word; be instant in season, out of season' },
    // ----- Who did this -----
    { kind: 'whodid', book: '2 Timothy', chapter: 4, verse: 10, subject: "paul's perseverance",
      prompt: 'Who forsook Paul, having loved this present world?',
      correct: 'Demas', distractors: ['Crescens', 'Tychicus', 'Zenas'] },
    { kind: 'whodid', book: '2 Timothy', chapter: 4, verse: 14, subject: 'opposition',
      prompt: 'Who did Paul much evil?',
      correct: 'Alexander the coppersmith', distractors: ['Hymenaeus', 'Philetus', 'Diotrephes'] },
    { kind: 'whodid', book: '2 Timothy', chapter: 1, verse: 16, subject: 'mercy on Onesiphorus',
      prompt: "Who was not ashamed of Paul's chain, and oft refreshed him?",
      correct: 'Onesiphorus', distractors: ['Luke', 'Mark', 'Trophimus'] },
    { kind: 'whodid', book: '2 Timothy', chapter: 4, verse: 13, subject: 'personal requests',
      prompt: 'With whom did Paul leave his cloke when he came to Troas?',
      correct: 'Carpus', distractors: ['Trophimus', 'Erastus', 'Tychicus'] },
    { kind: 'whodid', book: '2 Timothy', chapter: 4, verse: 11, subject: 'closings',
      prompt: 'Who does Paul say is profitable to him for the ministry?',
      correct: 'Mark', distractors: ['Luke', 'Crescens', 'Zenas'] },
    { kind: 'whodid', book: '2 Timothy', chapter: 1, verse: 5, subject: "timothy's family",
      prompt: "Who was Timothy's grandmother?",
      correct: 'Lois', distractors: ['Eunice', 'Priscilla', 'Claudia'] },
  ],
  titus: [
    // ----- True / False -----
    { kind: 'truefalse', tf: true,  book: 'Titus', chapter: 1, verse: 5,  subject: 'elders',
      statement: 'thou shouldest set in order the things that are wanting, and ordain elders in every city' },
    { kind: 'truefalse', tf: true,  book: 'Titus', chapter: 1, verse: 12, subject: 'cretian proverb',
      statement: 'The Cretians are alway liars, evil beasts, slow bellies.' },
    { kind: 'truefalse', tf: true,  book: 'Titus', chapter: 3, verse: 5,  subject: 'salvation',
      statement: 'Not by works of righteousness which we have done, but according to his mercy he saved us' },
    { kind: 'truefalse', tf: true,  book: 'Titus', chapter: 3, verse: 13, subject: 'closings',
      statement: 'Bring Zenas the lawyer and Apollos on their journey diligently, that nothing be wanting unto them.' },
    { kind: 'truefalse', tf: false, book: 'Titus', chapter: 2, verse: 12, subject: 'grace teaching',
      statement: 'The grace of God teaches us that we may live ungodly in this present world.' },
    { kind: 'truefalse', tf: false, book: 'Titus', chapter: 1, verse: 14, subject: 'avoid',
      statement: 'Paul commands Titus to give heed to Jewish fables, and commandments of men, that turn from the truth.' },
    // ----- Word order -----
    { kind: 'wordorder', book: 'Titus', chapter: 2, verse: 11, subject: 'grace',
      segment: 'For the grace of God that bringeth salvation hath appeared to all men' },
    { kind: 'wordorder', book: 'Titus', chapter: 2, verse: 14, subject: 'redeemed people',
      segment: 'Who gave himself for us, that he might redeem us from all iniquity' },
    { kind: 'wordorder', book: 'Titus', chapter: 3, verse: 8,  subject: 'faithful sayings',
      segment: 'This is a faithful saying, and these things I will that thou affirm constantly' },
    { kind: 'wordorder', book: 'Titus', chapter: 2, verse: 12, subject: 'grace teaching',
      segment: 'Teaching us that, denying ungodliness and worldly lusts, we should live soberly' },
    { kind: 'wordorder', book: 'Titus', chapter: 1, verse: 15, subject: 'purity',
      segment: 'Unto the pure all things are pure' },
    { kind: 'wordorder', book: 'Titus', chapter: 3, verse: 2,  subject: 'brotherly conduct',
      segment: 'To speak evil of no man, to be no brawlers, but gentle' },
    // ----- Who did this -----
    { kind: 'whodid', book: 'Titus', chapter: 3, verse: 13, subject: 'closings',
      prompt: "Who is called 'the lawyer'?",
      correct: 'Zenas', distractors: ['Apollos', 'Artemas', 'Tychicus'] },
    { kind: 'whodid', book: 'Titus', chapter: 1, verse: 5,  subject: 'calling',
      prompt: 'Who left Titus in Crete?',
      correct: 'Paul', distractors: ['Barnabas', 'Silas', 'Luke'] },
    { kind: 'whodid', book: 'Titus', chapter: 3, verse: 12, subject: 'travel plans',
      prompt: 'Whom did Paul plan to send unto Titus?',
      correct: 'Artemas', distractors: ['Zenas', 'Trophimus', 'Erastus'] },
    { kind: 'whodid', book: 'Titus', chapter: 3, verse: 12, subject: 'travel plans',
      prompt: 'Whither did Paul tell Titus to come to him?',
      correct: 'Nicopolis', distractors: ['Corinth', 'Ephesus', 'Miletum'], sfx: 'b' },
    { kind: 'whodid', book: 'Titus', chapter: 1, verse: 4,  subject: 'greetings',
      prompt: "To whom does Paul write, calling him his 'own son after the common faith'?",
      correct: 'Titus', distractors: ['Timothy', 'Onesimus', 'Philemon'] },
    { kind: 'whodid', book: 'Titus', chapter: 3, verse: 13, subject: 'closings',
      prompt: 'With whom was Zenas to be brought on their journey?',
      correct: 'Apollos', distractors: ['Barnabas', 'Silas', 'Tychicus'], sfx: 'b' },
  ],
};

// ---------- Build + validate ----------
const TIERS = { truefalse: 2, whodid: 3, wordorder: 5 };
const DIFFICULTY = { truefalse: 2, whodid: 3, wordorder: 3 };
const BOOK_ABB = { '1 Timothy': '1ti', '2 Timothy': '2ti', Titus: 'tit' };
const corpus = fullCorpus();
const errors = [];
const out = [];
const seenIds = new Set();
const seenPrompts = new Set();

for (const [heroId, items] of Object.entries(SPEC)) {
  for (const it of items) {
    const text = verseOf(it.book, it.chapter, it.verse); // throws if ref invalid
    const passage = `${it.book} ${it.chapter}:${it.verse}`;
    const id = `hero-${heroId === 'timothy' ? 'tim' : 'tit'}-${it.kind}-${BOOK_ABB[it.book]}-${it.chapter}-${it.verse}${it.sfx || ''}`;
    if (seenIds.has(id)) errors.push(`Duplicate id: ${id}`);

    let q;
    if (it.kind === 'truefalse') {
      if (it.tf && !text.includes(it.statement)) {
        errors.push(`TRUE statement is not a verbatim substring of ${passage}\n    statement: ${it.statement}\n    verse:     ${text}`);
      }
      if (!it.tf && corpus.includes(it.statement)) {
        errors.push(`FALSE statement unexpectedly found verbatim in the books: ${it.statement}`);
      }
      q = {
        id, hero: heroId, book: it.book, chapter: it.chapter, subject: it.subject,
        difficulty: DIFFICULTY.truefalse, tier: TIERS.truefalse, type: 'truefalse',
        prompt: `True or false (KJV, ${passage}): \u201C${it.statement}\u201D`,
        options: ['True', 'False'], correctIndex: it.tf ? 0 : 1,
        passage, verseText: text, nearIndexes: [],
      };
    } else if (it.kind === 'wordorder') {
      const seg = it.segment || text;
      if (!text.includes(seg)) errors.push(`Word-order segment is not a verbatim substring of ${passage}\n    segment: ${seg}\n    verse:   ${text}`);
      const words = seg.split(' ');
      if (words.length < 6 || words.length > 18) errors.push(`Word-order item ${id} has ${words.length} words (need 6-18)`);
      q = {
        id, hero: heroId, book: it.book, chapter: it.chapter, subject: it.subject,
        difficulty: DIFFICULTY.wordorder, tier: TIERS.wordorder, type: 'wordorder',
        prompt: `Rearrange into ${passage} (KJV) \u2014 tap the words in order.`,
        words, options: [], correctIndex: 0,
        passage, verseText: text, nearIndexes: [],
      };
    } else if (it.kind === 'whodid') {
      if (!Array.isArray(it.distractors) || it.distractors.length !== 3) errors.push(`whodid ${id} needs exactly 3 distractors`);
      if (it.distractors.includes(it.correct)) errors.push(`whodid ${id} has a distractor equal to the answer`);
      q = {
        id, hero: heroId, book: it.book, chapter: it.chapter, subject: it.subject,
        difficulty: DIFFICULTY.whodid, tier: TIERS.whodid, type: 'whodid',
        prompt: it.prompt,
        options: [it.correct, ...it.distractors], correctIndex: 0,
        passage, verseText: text, nearIndexes: [],
      };
    } else {
      errors.push(`Unknown kind: ${it.kind}`);
      continue;
    }

    if (seenPrompts.has(q.prompt)) errors.push(`Duplicate prompt: ${q.prompt}`);
    seenIds.add(id);
    seenPrompts.add(q.prompt);
    out.push(q);
  }
}

if (errors.length) {
  console.error(`build-heroes: ${errors.length} validation error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const dest = join(root, 'data', 'heroes.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
const counts = {};
for (const q of out) counts[`${q.hero}/${q.type}`] = (counts[`${q.hero}/${q.type}`] || 0) + 1;
console.log(`build-heroes: wrote ${out.length} questions -> data/heroes.json`);
console.log(JSON.stringify(counts, null, 2));
