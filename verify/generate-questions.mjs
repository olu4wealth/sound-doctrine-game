#!/usr/bin/env node
// verify/generate-questions.mjs — generate new, verifiable questions from the
// Scripture lockbox (fill-in-the-blank recall, distractors from the same book).
// Run: node verify/generate-questions.mjs  (writes data/questions-new.json)
// Each generated question's verseText is the EXACT lockbox verse, so the
// verifier (check.mjs) passes. Distractors are verbatim phrases from the same book.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ---- Lockbox (book -> chapter -> verse -> text) ----
function loadLockbox() {
  const files = ['kjv-1timothy.json', 'kjv-2timothy.json', 'kjv-titus.json'];
  const lb = {};
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
    lb[raw.book] = {};
    for (const ch of raw.chapters) {
      lb[raw.book][ch.chapter] = {};
      for (const v of ch.verses) lb[raw.book][ch.chapter][v.verse] = v.text;
    }
  }
  return lb;
}

// ---- Curated spec: for each verse, the key answer phrase to blank out.
// The blank must be a substring that appears verbatim in the verse, and the
// prompt shows the verse with that phrase replaced by ______.
// distractors are OTHER verbatim phrases from the SAME book.
// {book, chapter, verse, blank, subject, tier, distractorPhrases:[...]}
const SPECS = [
  // 1 Timothy
  { book: '1 Timothy', ch: 1, v: 12, blank: 'putting me into the ministry', subject: 'Paul\'s calling', tier: 2, distractors: ['making me a teacher', 'ordaining me a deacon', 'calling me to preach'] },
  { book: '1 Timothy', ch: 1, v: 13, blank: 'a blasphemer, and a persecutor, and injurious', subject: 'Paul\'s past', tier: 2, distractors: ['a faithful witness', 'a zealous Pharisee', 'an elder of the church'] },
  { book: '1 Timothy', ch: 1, v: 19, blank: 'made shipwreck', subject: 'faith and conscience', tier: 2, distractors: ['grown strong', 'been perfected', 'found blameless'] },
  { book: '1 Timothy', ch: 1, v: 20, blank: 'Hymenaeus and Alexander', subject: 'delivered to Satan', tier: 3, distractors: ['Phygellus and Hermogenes', 'Demas and Crescens', 'Onesiphorus and Tychicus'] },
  { book: '1 Timothy', ch: 2, v: 5, blank: 'one God, and one mediator between God and men', subject: 'the mediator', tier: 3, distractors: ['many gods and many lords', 'one judge of all', 'one high priest'] },
  { book: '1 Timothy', ch: 3, v: 1, blank: 'If a man desire the office of a bishop', subject: 'the office of bishop', tier: 1, distractors: ['If any man lacks wisdom', 'If a man love not his brother', 'If a man be called to teach'] },
  { book: '1 Timothy', ch: 5, v: 17, blank: 'counted worthy of double honour', subject: 'ruling elders', tier: 2, distractors: ['given a seat of honour', 'esteemed above all', 'rewarded with silver'] },
  { book: '1 Timothy', ch: 6, v: 6, blank: 'godliness with contentment', subject: 'great gain', tier: 3, distractors: ['faith and charity', 'hope and patience', 'holiness and sobriety'] },
  { book: '1 Timothy', ch: 6, v: 17, blank: 'Charge them that are rich in this world', subject: 'the rich', tier: 2, distractors: ['Blessed are the poor', 'Woe to the wealthy', 'Rebuke the covetous'] },
  { book: '1 Timothy', ch: 6, v: 19, blank: 'a good foundation against the time to come', subject: 'laying up treasure', tier: 3, distractors: ['a crown of righteousness', 'an inheritance incorruptible', 'a house not made with hands'] },

  // 2 Timothy
  { book: '2 Timothy', ch: 1, v: 4, blank: 'being mindful of thy tears', subject: 'Paul\'s longing', tier: 2, distractors: ['remembering thy faith', 'hearing of thy afflictions', 'recalling thy baptism'] },
  { book: '2 Timothy', ch: 1, v: 6, blank: 'stir up the gift of God', subject: 'the gift of God', tier: 2, distractors: ['hide thy talent', 'forsake thy calling', 'neglect not thy wages'] },
  { book: '2 Timothy', ch: 1, v: 11, blank: 'a preacher, and an apostle, and a teacher of the Gentiles', subject: 'Paul\'s offices', tier: 3, distractors: ['a shepherd, and a bishop, and a deacon', 'a prophet, and a seer, and a sage', 'a ruler, and a scribe, and a judge'] },
  { book: '2 Timothy', ch: 1, v: 16, blank: 'the house of Onesiphorus', subject: 'mercy on Onesiphorus', tier: 3, distractors: ['the house of Prisca', 'the household of Stephanas', 'the family of Aquila'] },
  { book: '2 Timothy', ch: 2, v: 13, blank: 'he cannot deny himself', subject: 'faithfulness of God', tier: 2, distractors: ['he will not forget us', 'he abideth not with the proud', 'he turneth not away'] },
  { book: '2 Timothy', ch: 2, v: 20, blank: 'vessels of gold and of silver', subject: 'the great house', tier: 2, distractors: ['wings of angels', 'crowns of glory', 'lamps of fire'] },
  { book: '2 Timothy', ch: 2, v: 21, blank: 'a vessel unto honour', subject: 'purged vessel', tier: 2, distractors: ['a vessel of wrath', 'a vessel of mercy', 'a broken vessel'] },
  { book: '2 Timothy', ch: 3, v: 5, blank: 'Having a form of godliness', subject: 'form of godliness', tier: 3, distractors: ['Lacking all holiness', 'Professing great humility', 'Boasting of the law'] },
  { book: '2 Timothy', ch: 4, v: 12, blank: 'Tychicus have I sent to Ephesus', subject: 'Tychicus', tier: 3, distractors: ['Timotheus have I sent to Philippi', 'Titus have I sent to Crete', 'Epaphroditus have I sent to Colosse'] },
  { book: '2 Timothy', ch: 4, v: 19, blank: 'Salute Prisca and Aquila', subject: 'greetings', tier: 3, distractors: ['Greet Mary and Martha', 'Remember Ananias and Sapphira', 'Honour Barnabas and Saul'] },

  // Titus
  { book: 'Titus', ch: 1, v: 8, blank: 'a lover of hospitality', subject: 'qualities of a bishop', tier: 2, distractors: ['a lover of money', 'a lover of power', 'a lover of praise'] },
  { book: 'Titus', ch: 1, v: 16, blank: 'in works they deny him', subject: 'empty profession', tier: 3, distractors: ['in word they confess him', 'in deed they honour him', 'in heart they seek him'] },
  { book: 'Titus', ch: 2, v: 4, blank: 'teach the young women to be sober', subject: 'older women\'s charge', tier: 3, distractors: ['teach the young men to fight', 'command the elders to rule', 'instruct the servants to obey'] },
  { book: 'Titus', ch: 2, v: 14, blank: 'a peculiar people, zealous of good works', subject: 'redeemed people', tier: 3, distractors: ['a chosen generation, holy and blameless', 'a royal priesthood, called and chosen', 'a holy nation, separated and pure'] },
  { book: 'Titus', ch: 3, v: 2, blank: 'To speak evil of no man', subject: 'brotherly conduct', tier: 2, distractors: ['To judge all men', 'To please every man', 'To honour all men'] },
  { book: 'Titus', ch: 3, v: 7, blank: 'justified by his grace', subject: 'justification', tier: 3, distractors: ['saved by our works', 'redeemed by blood', 'sanctified by law'] },
  { book: 'Titus', ch: 3, v: 14, blank: 'maintain good works', subject: 'good works', tier: 2, distractors: ['seek great riches', 'build great towers', 'gain great honour'] },
];

const lb = loadLockbox();
const questions = [];
let idCounter = 1001;

function buildQuestion(spec) {
  const verseText = lb[spec.book][spec.ch][spec.v];
  if (!verseText) return null;
  if (!verseText.includes(spec.blank)) return null; // blank must appear verbatim

  // Prompt: quote the verse with the blank phrase replaced by ______.
  const promptQuote = verseText.replace(spec.blank, '______');
  const ref = `${spec.book} ${spec.ch}:${spec.v}`;
  const correct = spec.blank;
  // Distractors must all differ from the correct answer
  const distractors = spec.distractors.filter((d) => d !== correct).slice(0, 3);
  if (distractors.length < 3) return null;

  // Shuffle options, track correct index
  const opts = [correct, ...distractors];
  // deterministic-ish shuffle
  const correctBase = 0;
  const order = [correctBase, 1, 2, 3].sort(() => Math.random() - 0.5);
  const options = order.map((i) => opts[i]);
  const correctIndex = order.indexOf(correctBase);

  const q = {
    id: `gen-${idCounter++}`,
    book: spec.book,
    chapter: spec.ch,
    subject: spec.subject,
    type: spec.type || 'completion',
    prompt: spec.prompt || `Complete: "${promptQuote}"`,
    options,
    correctIndex,
    passage: ref,
    verseText,
    tier: spec.tier,
  };
  // Crossref: a second verse (passageB).
  if (spec.passageB && spec.verseTextB) {
    q.passageB = spec.passageB;
    q.verseTextB = spec.verseTextB;
  }
  // Synthesis: an array of supporting verses.
  if (Array.isArray(spec.verses) && spec.verses.length) {
    q.verses = spec.verses;
  }
  return q;
}

// ---- Higher-tier cross-reference / synthesis specs ----
// blank still must appear verbatim in the primary verse for recall-style ties.
const HI_SPECS = [
  // T6 cross-reference: pair two "keep/hold" commands
  {
    book: '1 Timothy', ch: 6, v: 20, tier: 6, type: 'crossref', subject: 'the deposit', blank: 'keep that which is committed to thy trust',
    passageB: '2 Timothy 1:14', verseTextB: lb['2 Timothy'][1][14],
    distractors: ['flee also youthful lusts', 'lay hold on eternal life', 'be strong in the grace'],
    prompt: '1 Timothy 6:20 tells Timothy to "keep that which is committed to thy trust"; 2 Timothy 1:14 repeats the charge with which phrase?',
  },
  {
    book: '2 Timothy', ch: 1, v: 13, tier: 6, type: 'crossref', subject: 'sound words', blank: 'Hold fast the form of sound words',
    passageB: 'Titus 1:9', verseTextB: lb['Titus'][1][9],
    distractors: ['Keep the commandment without spot', 'Fight the good fight of faith', 'Be thou an example of the believers'],
    prompt: '2 Timothy 1:13 commands "Hold fast the form of sound words"; Titus 1:9 links holding the faithful word to what ability of a bishop?',
  },
  {
    book: '1 Timothy', ch: 4, v: 7, tier: 6, type: 'crossref', subject: 'godliness', blank: 'exercise thyself rather unto godliness',
    passageB: '2 Timothy 3:14', verseTextB: lb['2 Timothy'][3][14],
    distractors: ['study to shew thyself approved', 'be thou an example in word', 'lay hands suddenly on no man'],
    prompt: '1 Timothy 4:7 pairs refusing fables with "exercise thyself rather unto godliness"; 2 Timothy 3:14 urges Timothy to what in the things he has learned?',
  },
  // T7 synthesis themes
  {
    book: '1 Timothy', ch: 6, v: 20, tier: 7, type: 'synthesis', subject: 'guarding the trust', blank: 'keep',
    distractors: ['guard', 'hold', 'flee'],
    prompt: 'Synthesis: both 1 Timothy 6:20 ("keep that which is committed to thy trust") and 2 Timothy 1:14 ("that good thing...keep") use the same single verb for guarding the deposit. Which?',
  },
  {
    book: '2 Timothy', ch: 1, v: 6, tier: 7, type: 'synthesis', subject: 'the gift', blank: 'stir up',
    distractors: ['neglect', 'quench', 'bury'],
    prompt: 'Synthesis: 2 Timothy 1:6 says "stir up the gift of God"; 1 Timothy 4:14 warns "Neglect not the gift". What action does Paul urge Timothy to take toward his gift?',
  },
  {
    book: 'Titus', ch: 3, v: 8, tier: 7, type: 'synthesis', subject: 'good works', blank: 'maintain good works',
    distractors: ['obey magistrates', 'speak evil of no man', 'be ready to every good work'],
    prompt: 'Synthesis: Titus 3:8 urges believers to "maintain good works", 2 Timothy 3:17 says the man of God is furnished "unto all good works", and 1 Timothy 5:10 commends those who diligently follow "every good work". What is the shared theme?',
  },
];

for (const spec of SPECS) {
  const q = buildQuestion(spec);
  if (q) questions.push(q);
}
for (const spec of HI_SPECS) {
  const q = buildQuestion(spec);
  if (q) questions.push(q);
}

writeFileSync(join(root, 'data', 'questions-new.json'), JSON.stringify(questions, null, 2));
console.log(`Generated ${questions.length} questions -> data/questions-new.json`);
if (questions.length < SPECS.length) {
  console.warn(`WARN: ${SPECS.length - questions.length} specs skipped (blank not found / not enough distractors)`);
}
