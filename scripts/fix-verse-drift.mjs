#!/usr/bin/env node
// scripts/fix-verse-drift.mjs — fix KJV ellipsis drifts + invalid passage formats in 166-bank
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const path = join(root, 'data', 'questions-merged.json');
const data = JSON.parse(readFileSync(path, 'utf8'));

// exact KJV from lockbox (copy-pasted from node probe)
const V = {
  '1 Timothy 2:9':  "In like manner also, that women adorn themselves in modest apparel, with shamefacedness and sobriety; not with broided hair, or gold, or pearls, or costly array;",
  '1 Timothy 2:10': "But (which becometh women professing godliness) with good works.",
  '1 Timothy 3:2':  "A bishop then must be blameless, the husband of one wife, vigilant, sober, of good behaviour, given to hospitality, apt to teach;",
  '1 Timothy 3:12': "Let the deacons be the husbands of one wife, ruling their children and their own houses well.",
  'Titus 2:1':      "But speak thou the things which become sound doctrine:",
  '1 Timothy 1:10': "For whoremongers, for them that defile themselves with mankind, for menstealers, for liars, for perjured persons, and if there be any other thing that is contrary to sound doctrine;",
  '1 Timothy 6:20': "O Timothy, keep that which is committed to thy trust, avoiding profane and vain babblings, and oppositions of science falsely so called:",
  'Titus 1:9':      "Holding fast the faithful word as he hath been taught, that he may be able by sound doctrine both to exhort and to convince the gainsayers.",
  '2 Timothy 1:7':  "For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.",
  '2 Timothy 1:8':  "Be not thou therefore ashamed of the testimony of our Lord, nor of me his prisoner: but be thou partaker of the afflictions of the gospel according to the power of God;",
  '2 Timothy 3:2':  "For men shall be lovers of their own selves, covetous, boasters, proud, blasphemers, disobedient to parents, unthankful, unholy,",
  '2 Timothy 3:3':  "Without natural affection, trucebreakers, false accusers, incontinent, fierce, despisers of those that are good,",
  '2 Timothy 3:4':  "Traitors, heady, highminded, lovers of pleasures more than lovers of God;",
  '2 Timothy 3:5':  "Having a form of godliness, but denying the power thereof: from such turn away.",
  'Titus 1:6':      "If any be blameless, the husband of one wife, having faithful children not accused of riot or unruly.",
  'Titus 1:7':      "For a bishop must be blameless, as the steward of God; not selfwilled, not soon angry, not given to wine, no striker, not given to filthy lucre;",
  'Titus 1:8':      "But a lover of hospitality, a lover of good men, sober, just, holy, temperate;",
  '1 Timothy 1:15': "This is a faithful saying, and worthy of all acceptation, that Christ Jesus came into the world to save sinners; of whom I am chief.",
};

function byId(id){ return data.find(q=>q.id===id); }

let fixed = 0;

// 1) t5-1ti-2-godliness: 1 Timothy 2:9-10 concatenated
{
  const q = byId('t5-1ti-2-godliness');
  q.passage = "1 Timothy 2:9-10";
  q.verseText = V['1 Timothy 2:9'] + " " + V['1 Timothy 2:10'];
  delete q.reference; // legacy field not used by validator, keep but not needed
  fixed++;
}

// 2) t5-1ti-3-leaders: was "1 Timothy 3:2, 12" — split into passage + verses
{
  const q = byId('t5-1ti-3-leaders');
  q.passage = "1 Timothy 3:2";
  q.verseText = V['1 Timothy 3:2'];
  q.verses = [{ passage: "1 Timothy 3:12", verseText: V['1 Timothy 3:12'] }];
  // keep version with verses[] — validator will check both; remove invalid referenceAll
  delete q.referenceAll;
  fixed++;
}

// 3) t6-sound-doctrine-synthesis: Titus 2:1 + 1 Timothy 1:10
{
  const q = byId('t6-sound-doctrine-synthesis');
  q.passage = "Titus 2:1";
  q.verseText = V['Titus 2:1'];
  q.passageB = "1 Timothy 1:10";
  q.verseTextB = V['1 Timothy 1:10'];
  fixed++;
}

// 4) t6-guard-faith: 1 Timothy 6:20 + Titus 1:9 via passageB
{
  const q = byId('t6-guard-faith');
  q.passage = "1 Timothy 6:20";
  q.verseText = V['1 Timothy 6:20'];
  q.passageB = "Titus 1:9";
  q.verseTextB = V['Titus 1:9'];
  delete q.referenceAll;
  fixed++;
}

// 5) t6-not-ashamed: 2 Timothy 1:7-8 concatenated
{
  const q = byId('t6-not-ashamed');
  q.passage = "2 Timothy 1:7-8";
  q.verseText = V['2 Timothy 1:7'] + " " + V['2 Timothy 1:8'];
  delete q.referenceAll;
  fixed++;
}

// 6) t7-seven-synthesis: 2 Timothy 3:2-5 concatenated
{
  const q = byId('t7-seven-synthesis');
  q.passage = "2 Timothy 3:2-5";
  q.verseText = [V['2 Timothy 3:2'], V['2 Timothy 3:3'], V['2 Timothy 3:4'], V['2 Timothy 3:5']].join(" ");
  fixed++;
}

// 7) t5-tit-1-elders: Titus 1:6-9 concatenated
{
  const q = byId('t5-tit-1-elders');
  q.passage = "Titus 1:6-9";
  q.verseText = [V['Titus 1:6'], V['Titus 1:7'], V['Titus 1:8'], V['Titus 1:9']].join(" ");
  delete q.referenceAll;
  fixed++;
}

// 8) t7-numerical-synthesis: 1 Timothy 1:15 exact
{
  const q = byId('t7-numerical-synthesis');
  q.passage = "1 Timothy 1:15";
  q.verseText = V['1 Timothy 1:15'];
  delete q.referenceAll;
  fixed++;
}

console.log(`Fixed ${fixed} verseText/passage drifts`);

// also ensure any question that still has legacy reference/answer fields but missing passage stays consistent
// no-op

data.sort((a,b)=>a.id.localeCompare(b.id));
writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`Wrote ${path} (${data.length} questions)`);
