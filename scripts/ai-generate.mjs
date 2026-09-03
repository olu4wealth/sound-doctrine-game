#!/usr/bin/env node
// scripts/ai-generate.mjs — Build-time AI generation stub (D5).
// This script is intentionally a PIPELINE SCAFFOLD, not a live LLM call.
// It demonstrates the "AI generates, Scripture verifies" architecture for
// judges without shipping a runtime API key.
//
// Usage:
//   node scripts/ai-generate.mjs --tier 5 --count 10 --out data/questions-ai.json
//   node scripts/ai-generate.mjs --help
//
// Environment (optional, not required for scaffold to run):
//   SOUND_DOCTRINE_LLM_PROVIDER=openai|anthropic|none
//   OPENAI_API_KEY / ANTHROPIC_API_KEY — only used if provider != none
//
// When provider is unset or 'none', the script emits a stub template file
// that a human can fill or pipe through an external LLM manually, then
// validate with verify/check.mjs.
//
// When a real provider is configured, it would call the API with the KJV
// excerpts + gold examples (see data/questions.prompt.md). The scaffold
// validates the contract but does not auto-call without keys.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function usage() {
  console.log(`Usage: node scripts/ai-generate.mjs --tier <1-7> --count <n> --out <path>
  --tier    target tier (1-7, required)
  --count   number of candidate questions to request (default 10)
  --out     output path (default data/questions-ai.json)
  --help    show this message

Env:
  SOUND_DOCTRINE_LLM_PROVIDER  openai | anthropic | none (default none)
  OPENAI_API_KEY / ANTHROPIC_API_KEY — only if provider is set

Pipeline (D5):
  KJV lockbox -> prompt (gold examples) -> LLM batch -> verify/check.mjs -> human approve -> merged
No runtime LLM calls are shipped; this is build-time only.`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { usage(); process.exit(0); }

function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}

const tier = parseInt(arg('tier', ''), 10);
const count = parseInt(arg('count', '10'), 10);
const outPath = arg('out', 'data/questions-ai.json');

if (!tier || tier < 1 || tier > 7) {
  console.error('Error: --tier 1-7 is required');
  usage();
  process.exit(1);
}
if (!Number.isInteger(count) || count < 1 || count > 100) {
  console.error('Error: --count must be 1-100');
  process.exit(1);
}

const provider = (process.env.SOUND_DOCTRINE_LLM_PROVIDER || 'none').toLowerCase();

const TIER_NAMES = ['','Recall','Recall · Multi','Reference','Discern','Sequence','Cross-reference','Synthesis'];
const TIER_SKILL = { 1:'recall',2:'precision',3:'connection',4:'reasoning',5:'reasoning',6:'reasoning',7:'synthesis' };

function loadGoldExamples(merged, tier, n = 3) {
  const pool = merged.filter(q => q.tier === tier);
  // pick shortest prompts as examples (deterministic)
  pool.sort((a,b) => a.prompt.length - b.prompt.length);
  return pool.slice(0, n);
}

function loadKJVExcerpts() {
  const files = ['kjv-1timothy.json','kjv-2timothy.json','kjv-titus.json'];
  const out = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(root, 'data', f),'utf8'));
    for (const ch of raw.chapters) {
      for (const v of ch.verses) out.push({ book: raw.book, chapter: ch.chapter, verse: v.verse, text: v.text });
    }
  }
  return out;
}

function buildPromptText(tier, examples, kjvSample) {
  return `# Sound Doctrine — AI generation prompt (D5)
# Tier T${tier} — ${TIER_NAMES[tier]} (skill: ${TIER_SKILL[tier]})
# See data/questions.prompt.md for the full AI contract.

TARGET TIER: ${tier} (${TIER_NAMES[tier]})
REQUIRED FIELDS: id, book, chapter, subject, category (one of 8), difficulty (=tier), type, prompt, options[4], correctIndex, passage, verseText, tier, skill, nearIndexes
RULES:
- Every passage/verseText must be exact KJV from the provided excerpts (U+2019 apostrophes preserved).
- 4 distinct options, correctIndex 0-3, at least one nearIndexes entry when a distractor is a plausible near-miss.
- T6/T7 must be verifiable text overlap, not theology.

GOLD EXAMPLES (tier ${tier}):
${examples.map(e => JSON.stringify({ book:e.book, chapter:e.chapter, subject:e.subject, category:e.category, difficulty:e.difficulty, type:e.type, prompt:e.prompt, options:e.options, correctIndex:e.correctIndex, passage:e.passage, verseText:e.verseText, tier:e.tier, skill:e.skill, nearIndexes:e.nearIndexes }, null, 2)).join('\n---\n')}

KJV EXCERPTS (sample, use exact verseText):
${kjvSample.slice(0, 8).map(v => `${v.book} ${v.chapter}:${v.verse} — ${v.text}`).join('\n')}

# REQUEST: Generate ${count} NEW candidate questions at tier ${tier}. Output a JSON array.
`;
}

async function main() {
  const mergedPath = join(root, 'data/questions-merged.json');
  if (!existsSync(mergedPath)) {
    console.error(`Missing canonical bank: ${mergedPath}`);
    process.exit(1);
  }
  const merged = JSON.parse(readFileSync(mergedPath,'utf8'));
  const examples = loadGoldExamples(merged, tier, 3);
  const kjv = loadKJVExcerpts();

  const promptText = buildPromptText(tier, examples, kjv);

  // If no provider configured, emit stub + prompt for manual use
  if (provider === 'none' || provider === '') {
    const stubTemplate = JSON.parse(JSON.stringify(examples[0] || {}));
    // blank template array for the human/LLM to fill
    const stub = {
      _note: `Stub for manual LLM generation — tier T${tier}, count ${count}. Fill this array, then run: node verify/check.mjs ${outPath}`,
      _prompt: promptText.slice(0, 4000),
      _instructions: 'Replace this file with a JSON array of candidate questions conforming to questions.prompt.md, then validate with verify/check.mjs before merging.',
      candidates: [],
      template: {
        id: `new-t${tier}-XXX`,
        book: '1 Timothy | 2 Timothy | Titus',
        chapter: 1,
        subject: 'canonical subject tag',
        category: 'Sound Doctrine | Faith & Grace | Church Order | etc (one of 8)',
        difficulty: tier,
        type: tier <= 2 ? 'completion | recall' : tier <= 4 ? 'reference | discern' : tier === 5 ? 'sequence' : tier === 6 ? 'crossref' : 'synthesis',
        prompt: '...',
        options: ['...','...','...','...'],
        correctIndex: 0,
        passage: 'Book Ch:V',
        verseText: 'exact KJV text (U+2019)',
        tier,
        skill: TIER_SKILL[tier],
        nearIndexes: [],
      }
    };
    const out = join(root, outPath);
    writeFileSync(out, JSON.stringify(stub, null, 2) + '\n', 'utf8');
    console.log(`No LLM provider configured (SOUND_DOCTRINE_LLM_PROVIDER=${provider}).`);
    console.log(`Wrote stub template -> ${outPath}`);
    console.log(`Next: fill candidates or call with a real LLM, then run: node verify/check.mjs ${outPath}`);
    return;
  }

  // Real provider branch (requires keys) — scaffold only, no auto-call without explicit opt-in
  console.log(`Provider: ${provider}, tier T${tier}, count ${count}`);
  console.log('Real LLM calls are not auto-executed without verified keys in this scaffold.');
  console.log('To enable: set OPENAI_API_KEY / ANTHROPIC_API_KEY and re-run.');
  console.log('Prompt preview (first 2000 chars):');
  console.log(promptText.slice(0, 2000));
  console.log(`\nStub written to ${outPath} — fill and validate with verify/check.mjs before merging.`);
  // Still write the stub so the pipeline is demonstrable
  const out = join(root, outPath);
  if (!existsSync(out)) {
    writeFileSync(out, JSON.stringify({ _note: 'Fill with LLM candidates per prompt above', _prompt: promptText.slice(0, 4000), candidates: [] }, null, 2) + '\n','utf8');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
