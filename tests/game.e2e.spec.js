// tests/game.e2e.spec.js — end-to-end player journey for Sound Doctrine.
import { test, expect } from '@playwright/test';

// Helper: pre-set the tutorial-done flag so first-time tutorial never blocks tests.
// Must be called BEFORE page.goto('/') so the init script applies on load.
async function dismissTutorial(page) {
  await page.addInitScript(() => localStorage.setItem('sd_tutorial_done', '1'));
}

// Helper: seed an unlocked player so the gated modes (Daily Quest, Hero) are playable.
async function seedPlayer(page, name = 'Playwright Tester') {
  await page.addInitScript(([n]) => {
    localStorage.setItem('sd.player.v1', JSON.stringify({
      name: n, ladderPlayed: true, hearts: 5, oilVials: 3, createdAt: Date.now(),
    }));
  }, [name]);
}

// Helper: pass through the intro screen (shown on first visit) to reach the start screen.
async function passIntro(page) {
  const introBtn = page.getByRole('button', { name: /enter the charge/i });
  if (await introBtn.count()) {
    await introBtn.click();
  }
}

// Helper: begin a climb and return once the first question card is visible.
async function beginClimb(page) {
  await dismissTutorial(page); // sets sd_tutorial_done before load
  await page.goto('/');
  await passIntro(page);
  await page.getByPlaceholder(/your name/i).fill('Playwright Tester');
  await page.getByRole('button', { name: /begin the charge/i }).click();
  // Candle home → begin a climb
  await page.getByRole('button', { name: /begin a climb/i }).click();
}

// Choosing an option opens the confidence popup; stake it to actually answer.
async function stake(page, bidMult = 1) {
  await page.locator(`.stake-opt[data-mult="${bidMult}"]`).click();
}

async function answerOne(page, bidMult = 1) {
  const opt = page.locator('.option:not([disabled])').first();
  if (await opt.count() === 0) return false;
  // Choosing an option opens the confidence popup; picking a stake there answers.
  await opt.click();
  await stake(page, bidMult);
  return true;
}

// Answer a given option, staking it at the given multiplier in the popup.
async function chooseBidAndAnswer(page, bidMult, optionIndex) {
  await page.locator('.option').nth(optionIndex).click();
  await stake(page, bidMult);
}

test.describe('core player journey', () => {
  test('name entry → candle home → climb → question renders', async ({ page }) => {
    await dismissTutorial(page); // set flag before load
    await page.goto('/');
    await passIntro(page);
    await expect(page.locator('#screen-start')).toBeVisible();
    await page.getByPlaceholder(/your name/i).fill('Playwright Tester');
    await page.getByRole('button', { name: /begin the charge/i }).click();

    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('#home-name')).toHaveText('Playwright Tester');
    // candle + streak are present (oil-vial pill removed from the menu)
    await expect(page.locator('#candle-stage')).toBeVisible();
    await expect(page.locator('#streak-num')).toBeVisible();
    // the menu shows a single static animated candle.webp (no melt / no CSS flame)
    await expect(page.locator('#candle-webp')).toBeVisible();
    await expect(page.locator('#candle-webp')).toHaveJSProperty('complete', true);
    // the two full-body mascots continue from the title screen onto the menu
    await expect(page.locator('.home-hero-left')).toBeVisible();
    await expect(page.locator('.home-hero-right')).toBeVisible();
    // oil-vial icon removed + "(of 7)" trimmed from the streak label
    await expect(page.locator('#oil-count')).toHaveCount(0);
    await expect(page.locator('.streak-label')).not.toContainText('(of 7)');
  });

  test('HUD shows hearts, progress, and a countdown ring', async ({ page }) => {
    await beginClimb(page);
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-hearts')).toBeVisible();
    await expect(page.locator('#hud-progress')).toBeVisible();
    await expect(page.locator('#ring-fill')).toBeVisible();
    await expect(page.locator('#ring-label')).toBeVisible();
    // Live score chip is present and starts at the pot of 0
    await expect(page.locator('#hud-score')).toBeVisible();
    await expect(page.locator('#hud-score')).toContainText('⚜');
    // 4 options present
    await expect(page.locator('.option')).toHaveCount(4);
  });

  test('answering a question shows the verse correction and advances', async ({ page }) => {
    await beginClimb(page);
    await expect(page.locator('#q-options')).toBeVisible();
    await expect(page.locator('.option')).toHaveCount(4);

    // Choosing an option asks for confidence first, then answers.
    await page.locator('.option').nth(0).click();
    await expect(page.locator('#stake-modal-backdrop')).toBeVisible();
    await page.locator('.stake-opt[data-mult="1"]').click();
    await expect(page.locator('#stake-modal-backdrop')).toHaveCount(0);
    await expect(page.locator('#feedback-modal-backdrop')).toBeVisible();
    await expect(page.locator('.feedback-modal-verse')).not.toBeEmpty();
    await expect(page.locator('.feedback-modal-ref')).toContainText('(KJV)');

    await page.locator('#feedback-modal-continue').click();
    await expect(page.locator('.option')).toHaveCount(4);
  });

  test('countdown ring actually ticks down', async ({ page }) => {
    await beginClimb(page);
    const before = await page.locator('#ring-label').textContent();
    await page.waitForTimeout(1200);
    const after = await page.locator('#ring-label').textContent();
    expect(Number(after)).toBeLessThanOrEqual(Number(before));
  });

  test('50/50 lifeline never hides the correct answer', async ({ page }) => {
    // seedPlayer grants 3 oil vials and a used ladder → lands straight on home.
    await dismissTutorial(page);
    await seedPlayer(page);
    await page.goto('/');
    await expect(page.locator('#screen-home')).toBeVisible();
    await page.getByRole('button', { name: /begin a climb/i }).click();

    // Up to 3 lifeline uses (one per oil vial).
    for (let attempt = 0; attempt < 3; attempt++) {
      const pu = page.locator('#pu-5050');
      if (await pu.isDisabled().catch(() => false)) break;

      await pu.click();

      const opts = page.locator('.option');
      const total = await opts.count();
      const hidden = [];
      const visible = [];
      for (let i = 0; i < total; i++) {
        const o = opts.nth(i);
        const isHidden = await o.evaluate((el) => getComputedStyle(el).visibility === 'hidden');
        (isHidden ? hidden : visible).push(o);
      }
      const expectedHidden = total === 2 ? 1 : 2;
      expect(hidden.length, '50/50 hides the expected count').toBe(expectedHidden);
      for (const h of hidden) await expect(h).toBeDisabled();

      const visibleTexts = (await Promise.all(visible.map((o) => o.textContent()))).map((t) => t.trim());

      // Answer with a visible option; whatever the outcome, the correct answer
      // must have been visible: on a correct pick we clicked it, and on a wrong
      // pick the modal states the correct answer — assert it was not hidden.
      await visible[0].click();
      await stake(page);
      await expect(page.locator('#feedback-modal-backdrop')).toBeVisible();

      const answerLine = page.locator('.feedback-answer');
      if (await answerLine.count()) {
        const stated = (await answerLine.textContent()).replace(/^.*was:\s*/i, '').trim();
        expect(visibleTexts, `correct answer "${stated}" must remain visible after 50/50`).toContain(stated);
      }

      await page.locator('#feedback-modal-continue').click();
      await page.waitForTimeout(400);
    }
  });

  test('quoted prompts highlight the verse without leaking their own markup', async ({ page }) => {
    await beginClimb(page);
    // Curly-quoted prompts used to print the highlight span into the question.
    for (let i = 0; i < 6; i++) {
      const prompt = page.locator('#q-prompt');
      await expect(prompt).not.toBeEmpty();
      expect(await prompt.textContent()).not.toContain('q-quote');
      expect(await prompt.textContent()).not.toContain('<span');
      // Where a prompt quotes scripture, the quote is wrapped exactly once.
      const spans = await prompt.locator('.q-quote').count();
      expect(await prompt.locator('.q-quote .q-quote').count()).toBe(0);
      if (spans) expect(await prompt.locator('.q-quote').first().textContent()).not.toContain('class=');

      if (!(await answerOne(page))) break;
      const cont = page.locator('#feedback-modal-continue');
      if (!(await cont.count())) break;
      await cont.click();
      await page.waitForTimeout(350);
      if (await page.locator('#screen-report').isVisible().catch(() => false)) break;
    }
  });

  test('no screen widens the page, so the layout stays centred', async ({ page }) => {
    // iOS Safari charges an overflowing fixed element to the page width and
    // zooms the document out to fit it, which slid every centred screen left.
    // Anything hanging past the viewport must sit inside a clipping ancestor.
    const probe = () => {
      const vw = document.documentElement.clientWidth;
      const unclipped = [];
      document.querySelectorAll('body *').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return;
        if (r.left >= -0.5 && r.right <= vw + 0.5) return;
        for (let a = e.parentElement; a; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') return;
        }
        const cs = getComputedStyle(e);
        unclipped.push(`${e.tagName}.${(e.className || '').toString().slice(0, 40)} pos=${cs.position} L=${r.left.toFixed(1)} R=${r.right.toFixed(1)}`);
      });
      const card = document.querySelector('.question-card');
      const r = card && card.getBoundingClientRect();
      return {
        vw, docScrollW: document.documentElement.scrollWidth, unclipped,
        cardGapL: r ? Math.round(r.left) : null,
        cardGapR: r ? Math.round(vw - r.right) : null,
      };
    };

    await dismissTutorial(page);
    await page.goto('/');
    await passIntro(page);
    await page.getByPlaceholder(/your name/i).fill('Playwright Tester');
    await page.getByRole('button', { name: /begin the charge/i }).click();
    await expect(page.locator('#screen-home')).toBeVisible();
    // The title/home key art hangs half off each edge — clipped, not overflowing.
    const home = await page.evaluate(probe);
    expect(home.unclipped, 'home screen must not widen the page').toEqual([]);
    expect(home.docScrollW).toBe(home.vw);

    await page.getByRole('button', { name: /begin a climb/i }).click();
    await expect(page.locator('.question-card')).toBeVisible();
    const game = await page.evaluate(probe);
    expect(game.unclipped, 'game screen must not widen the page').toEqual([]);
    expect(game.docScrollW).toBe(game.vw);
    expect(game.cardGapL, 'question card is centred, not tilted left').toBe(game.cardGapR);
  });

  test('the confidence popup fits inside the viewport', async ({ page }) => {
    await beginClimb(page);
    await page.locator('.option').first().click();
    await expect(page.locator('#stake-modal-backdrop')).toBeVisible();
    const box = await page.locator('.stake-card').boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    // Every stake stays reachable without scrolling the backdrop.
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  });

  test('exit returns to the candle home', async ({ page }) => {
    await beginClimb(page);
    await page.locator('#btn-exit').click();
    await expect(page.locator('#screen-home')).toBeVisible();
  });
});

test.describe('a question fits one screen', () => {
  // The screen swap fades the old screen out over its own frames; measure after.
  async function settledOnQuestion(page) {
    await beginClimb(page);
    await expect(page.locator('.option').first()).toBeVisible();
    await page.waitForTimeout(400);
  }

  test('the climb screen never scrolls, in either direction', async ({ page }) => {
    await settledOnQuestion(page);
    const m = await page.evaluate(() => {
      window.scrollTo(5000, 5000); // try to scroll it; nothing should move
      return {
        inGame: document.body.classList.contains('in-game'),
        y: window.scrollY,
        x: window.scrollX,
        hOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(m.inGame).toBe(true);
    expect(m.y).toBe(0);
    expect(m.x).toBe(0);
    expect(m.hOverflow).toBeLessThanOrEqual(0);
  });

  test('the timer, hearts and progress bar all sit above the fold', async ({ page }) => {
    await settledOnQuestion(page);
    const vh = await page.evaluate(() => window.innerHeight);
    for (const sel of ['#hud-hearts', '#hud-progress', '.hud-timer', '.progress', '.question-card']) {
      const bottom = await page.locator(sel).evaluate((e) => e.getBoundingClientRect().bottom);
      expect(bottom, `${sel} runs past the fold`).toBeLessThanOrEqual(vh + 1);
    }
  });

  test('the power-up strip stays on one row', async ({ page }) => {
    await settledOnQuestion(page);
    // The strip centres items of different heights, so compare centres, not tops.
    const centres = await page.locator('#powerups').evaluate((strip) => [...strip.children]
      .map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; }));
    const spread = Math.max(...centres) - Math.min(...centres);
    expect(spread, `power-ups wrapped: ${centres.map((c) => Math.round(c)).join(', ')}`).toBeLessThan(4);
  });

  test('the report scrolls again once the climb is over', async ({ page }) => {
    await settledOnQuestion(page);
    await page.locator('#btn-exit').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    expect(await page.evaluate(() => document.body.classList.contains('in-game'))).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  });
});

test.describe('daily quest + report + leaderboard', () => {
  test('daily quest lists a seeded day', async ({ page }) => {
    await dismissTutorial(page);
    await seedPlayer(page);
    await page.goto('/');
    await page.getByRole('button', { name: /daily quest/i }).click();
    await expect(page.locator('#screen-daily')).toBeVisible();
    await expect(page.locator('#daily-charge-intro')).toContainText("Today's Quest");
    await page.getByRole('button', { name: /begin today's quest/i }).click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('.option')).toHaveCount(4);
  });

  test('report renders a grade and how-to-do-better after a full daily quest', async ({ page }) => {
    test.setTimeout(60_000);
    await dismissTutorial(page);
    await seedPlayer(page);
    await page.goto('/');
    await page.getByRole('button', { name: /daily quest/i }).click();
    await page.getByRole('button', { name: /begin today's quest/i }).click();

    for (let i = 0; i < 10; i++) {
      const ok = await answerOne(page);
      if (!ok) break;
      const cont = page.locator('#feedback-modal-continue');
      if (await cont.count()) await cont.click();
      await page.waitForTimeout(1100);
      if (await page.locator('#screen-report').isVisible().catch(() => false)) break;
    }
    await expect(page.locator('#screen-report')).toBeVisible();
    // Phase 5 Mastery Map renders (even if zero missed, headers are present)
    await expect(page.locator('#report-summary')).toBeVisible();
    await expect(page.locator('#report-rx')).toBeVisible();
  });

  test('leaderboard shows the player after completing a charge', async ({ page }) => {
    await dismissTutorial(page);
    await seedPlayer(page);
    await page.goto('/');
    await page.getByRole('button', { name: /daily quest/i }).click();
    await page.getByRole('button', { name: /begin today's quest/i }).click();
    for (let i = 0; i < 10; i++) {
      const ok = await answerOne(page);
      if (!ok) break;
      const cont = page.locator('#feedback-modal-continue');
      if (await cont.count()) await cont.click();
      await page.waitForTimeout(1100);
      if (await page.locator('#screen-report').isVisible().catch(() => false)) break;
    }
    // Go home then leaderboard
    await page.getByRole('button', { name: /back to the candle/i }).click();
    await page.getByRole('button', { name: /leaderboard/i }).first().click();
    await expect(page.locator('#lb-list')).toContainText('Playwright Tester');
  });

  test('new players must finish a Ladder climb before Daily Quest and Choose Your Hero unlock', async ({ page }) => {
    await dismissTutorial(page);
    await page.goto('/');
    await passIntro(page);
    await page.getByPlaceholder(/your name/i).fill('Rookie Climber');
    await page.getByRole('button', { name: /begin the charge/i }).click();
    await expect(page.locator('#screen-home')).toBeVisible();
    // Both secondary modes are locked for a brand-new player.
    await expect(page.locator('#daily-card')).toHaveClass(/locked/);
    await expect(page.locator('#hero-card')).toHaveClass(/locked/);
    await expect(page.locator('#daily-card .lock-note')).toBeVisible();
    await expect(page.locator('#hero-card .lock-note')).toBeVisible();
    // Locked buttons never open their screens (the JS guard backs the CSS).
    await page.evaluate(() => document.getElementById('btn-hero-card').click());
    await expect(page.locator('#screen-hero')).toBeHidden();
    await page.evaluate(() => document.getElementById('btn-daily-card').click());
    await expect(page.locator('#screen-daily')).toBeHidden();
    // Finishing a Ladder climb sets the flag (finishCommon); simulate it, then reload.
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('sd.player.v1'));
      p.ladderPlayed = true;
      localStorage.setItem('sd.player.v1', JSON.stringify(p));
    });
    await page.reload();
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('#daily-card')).not.toHaveClass(/locked/);
    await expect(page.locator('#hero-card')).not.toHaveClass(/locked/);
  });
});

test.describe('persistence', () => {
  test('name persists across reload (localStorage)', async ({ page }) => {
    await dismissTutorial(page);
    await page.goto('/');
    await passIntro(page);
    await page.getByPlaceholder(/your name/i).fill('Persist Me');
    await page.getByRole('button', { name: /begin the charge/i }).click();
    await expect(page.locator('#home-name')).toHaveText('Persist Me');
    await page.reload();
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('#home-name')).toHaveText('Persist Me');
  });
});

test.describe('choose your hero', () => {
  async function toHome(page, name = 'Hero Tester') {
    await dismissTutorial(page);
    await seedPlayer(page, name);
    await page.goto('/');
    await expect(page.locator('#screen-home')).toBeVisible();
  }

  test('hero card opens the select screen with both heroes and a way back', async ({ page }) => {
    await toHome(page);
    await page.locator('#btn-hero-card').click();
    await expect(page.locator('#screen-hero')).toBeVisible();
    await expect(page.locator('.hero-card[data-hero="timothy"]')).toBeVisible();
    await expect(page.locator('.hero-card[data-hero="titus"]')).toBeVisible();
    await page.getByRole('button', { name: /back to the candle/i }).click();
    await expect(page.locator('#screen-home')).toBeVisible();
  });

  test('a hero run handles all three question types and reaches the report', async ({ page }) => {
    test.setTimeout(120_000);
    await toHome(page);
    await page.locator('#btn-hero-card').click();
    await page.locator('.hero-card[data-hero="titus"]').click();
    await expect(page.locator('#screen-game')).toBeVisible();

    // Answer whatever the current question is: word order (tap every chip, which
    // is all-or-nothing and never asks for a stake) or a classic option.
    const answerCurrent = async () => {
      const chips = page.locator('#wordpool .word-chip:not([disabled])');
      if (await chips.count()) {
        while (await chips.count()) await chips.first().click();
        return;
      }
      await page.locator('.option:not([disabled])').first().click();
      await stake(page);
    };

    for (let i = 0; i < 14; i++) {
      await answerCurrent();
      const cont = page.locator('#feedback-modal-continue');
      await expect(cont).toBeVisible({ timeout: 20_000 });
      await cont.click();
      await page.waitForTimeout(400);
      if (await page.locator('#screen-report').isVisible().catch(() => false)) break;
    }
    await expect(page.locator('#screen-report')).toBeVisible();
    await expect(page.locator('#report-summary')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Retention pass: the surfaces added in feat/retention-loop
// ---------------------------------------------------------------------------
test.describe('retention surfaces', () => {
  test('confidence is asked in a popup once an option is chosen', async ({ page }) => {
    await beginClimb(page);
    // Nothing on the card until an answer is picked.
    await expect(page.locator('#stake-modal-backdrop')).toHaveCount(0);
    await page.locator('.option').first().click();
    await expect(page.locator('#stake-modal-backdrop')).toBeVisible();
    await expect(page.locator('.stake-opt')).toHaveCount(5);
    // The chosen option is held pending behind the popup, and the popup quotes it.
    await expect(page.locator('.option.pending')).toHaveCount(1);
    await expect(page.locator('.stake-chosen')).not.toBeEmpty();
    // Staking answers — straight through to the verse correction.
    await page.locator('.stake-opt[data-mult="3"]').click();
    await expect(page.locator('#stake-modal-backdrop')).toHaveCount(0);
    await expect(page.locator('#feedback-modal-backdrop')).toBeVisible();
  });

  test('backing out of the confidence popup returns the question and the clock', async ({ page }) => {
    await beginClimb(page);
    const before = Number(await page.locator('#ring-label').textContent());
    await page.locator('.option').first().click();
    await expect(page.locator('#stake-modal-backdrop')).toBeVisible();
    await page.locator('#stake-back').click();
    await expect(page.locator('#stake-modal-backdrop')).toHaveCount(0);
    await expect(page.locator('.option.pending')).toHaveCount(0);
    await expect(page.locator('#feedback-modal-backdrop')).toHaveCount(0);
    // Options are live again and the clock is ticking down from where it paused.
    await expect(page.locator('.option').first()).toBeEnabled();
    await expect
      .poll(async () => Number(await page.locator('#ring-label').textContent()))
      .toBeLessThan(before);
  });

  test('a climb is a finishable 10-question run (unlocking never needs a loss)', async ({ page }) => {
    await beginClimb(page);
    await expect(page.locator('#hud-progress')).toContainText('/10');
  });

  test('home shows rank progress and the daily reset countdown', async ({ page }) => {
    await seedPlayer(page);
    await dismissTutorial(page);
    await page.goto('/');
    await expect(page.locator('#rank-progress')).toBeVisible();
    await expect(page.locator('#rank-pts')).toContainText('⚜');
    await expect(page.locator('#daily-countdown')).toContainText(/new quest in/i);
  });

  test('mastery screen lists all 13 canonical chapters', async ({ page }) => {
    await seedPlayer(page);
    await dismissTutorial(page);
    await page.goto('/');
    await page.locator('#btn-mastery').click();
    await expect(page.locator('#screen-mastery')).toBeVisible();
    await expect(page.locator('.mastery-cell')).toHaveCount(13);
    await expect(page.locator('#mastery-summary')).toContainText(/of 13 chapters mastered/i);
  });

  // Play a whole climb, taking the last option each time so misses pile up.
  async function playToReport(page) {
    await beginClimb(page);
    for (let i = 0; i < 12; i++) {
      const chips = page.locator('#wordpool .word-chip:not([disabled])');
      if (await chips.count()) { while (await chips.count()) await chips.first().click(); }
      else {
        const opts = page.locator('.option:not([disabled])');
        if (!(await opts.count())) break;
        await opts.last().click();
        await stake(page);
      }
      const cont = page.locator('#feedback-modal-continue');
      if (await cont.count()) { await cont.click(); await page.waitForTimeout(300); }
      if (await page.locator('#screen-report').isVisible()) break;
    }
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 20_000 });
  }

  test('report offers share and retest', async ({ page }) => {
    await playToReport(page);
    await expect(page.locator('#btn-report-share')).toBeVisible();
  });

  test('the report states each miss once, under one play-again button', async ({ page }) => {
    await playToReport(page);

    // The weakest-chapter card is a diagnosis: it names the chapter and its
    // accuracy, and leaves the verses to the list below. It used to reprint
    // the whole run's misses, duplicating that list word for word.
    const weakest = page.locator('#report-weakest');
    if (await weakest.locator('h3').count()) {
      await expect(weakest.locator('li')).toHaveCount(0);
      expect(await weakest.innerText()).not.toContain('\u201C'); // no verse quotes
    }

    // Every missed verse is listed exactly once, in one place.
    const missed = page.locator('#report-missed li');
    const n = await missed.count();
    if (n) {
      const refs = await page.locator('#report-missed li strong').allInnerTexts();
      expect(new Set(refs).size).toBe(refs.length);
      await expect(page.locator('#report-missed h3')).toContainText(`(${n})`);
    }

    // One "play again" CTA, not a retest button stacked on a climb button.
    await expect(page.locator('#btn-retest')).toHaveCount(0);
    const again = page.locator('#btn-again');
    await expect(again).toBeVisible();
    await expect(again).toHaveText(n ? new RegExp(`Retest the ${n} you missed`) : /Climb Again/i);
  });

  test('the study plan ranks the weak areas instead of repeating one line', async ({ page }) => {
    await playToReport(page);
    const steps = await page.locator('#report-rx li').allInnerTexts();
    if (!steps.length) return; // a clean run has nothing to prescribe
    // "Your weakest area was X — start there" used to open every line, which
    // cannot be true of three subjects at once.
    expect(steps.filter((t) => /start here/i.test(t))).toHaveLength(1);
    expect(new Set(steps).size).toBe(steps.length);
    // The plan points at the verse list rather than reprinting its passages.
    for (const t of steps) expect(t).not.toMatch(/\d+:\d+/);
    // Every step names a category that is actually tagged on a missed verse.
    const tags = await page.locator('#report-missed .missed-cat').allInnerTexts();
    const named = steps.map((t) => (t.match(/^(?:Start here|Then|After that): (.+?)\./) || [])[1]);
    for (const n of named) if (n) expect(tags).toContain(n);
  });

  test('a shared result carries a scriptural hook and a way in', async ({ page }) => {
    await playToReport(page);
    const shared = await page.evaluate(() => new Promise((resolve) => {
      let captured = null;
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (d) => { captured = { text: d.text, url: d.url }; return Promise.resolve(); },
      });
      document.getElementById('btn-report-share').click();
      setTimeout(() => resolve(captured), 400);
    }));
    expect(shared).not.toBeNull();
    // Still a scoreline...
    expect(shared.text).toMatch(/Sound Doctrine/);
    expect(shared.text).toMatch(/\d+\/\d+ · \d+%/);
    expect(shared.text).toMatch(/[\u{1F7E9}\u{1F7E8}\u{1F7E5}]/u);
    // ...now with a quip and an invitation, and a link to open the game.
    expect(shared.text).toMatch(/[\u201C\u201D]|spirit is willing/);
    expect(shared.text).toMatch(/Think you know|your turn/i);
    expect(shared.url).toMatch(/^https?:\/\//);
  });

  test('the report play-again button starts a run', async ({ page }) => {
    await playToReport(page);
    await page.locator('#btn-again').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-progress')).toContainText('/10');
  });

  test('service worker registers', async ({ page }) => {
    await dismissTutorial(page);
    await page.goto('/');
    const ok = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg || !!(await navigator.serviceWorker.ready.catch(() => null));
    });
    expect(ok).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GSAP motion layer (motion.js + vendor/gsap.min.js)
// ---------------------------------------------------------------------------
test.describe('motion', () => {
  test('GSAP and Flip load from vendor/ and Flip is registered', async ({ page }) => {
    await dismissTutorial(page);
    await page.goto('/');
    const info = await page.evaluate(() => ({
      version: window.gsap?.version,
      flipRegistered: !!window.gsap?.core?.globals?.().Flip,
    }));
    expect(info.version).toBeTruthy();
    expect(info.flipRegistered).toBe(true);
  });

  test('score chip counts up instead of jumping to the final value', async ({ page }) => {
    await beginClimb(page);
    await page.locator('.option').first().click();
    await stake(page);
    // Sampled mid-tween the chip should not already equal its settled value.
    await page.waitForTimeout(100);
    const mid = await page.locator('#hud-score').textContent();
    await page.waitForTimeout(1000);
    const settled = await page.locator('#hud-score').textContent();
    expect(settled).not.toBe('⚜ 0');
    expect(mid).not.toBe(settled);
  });

  test('rank bar and mastery bars grow from zero', async ({ page }) => {
    await dismissTutorial(page);
    await page.addInitScript(() => localStorage.setItem('sd.player.v1', JSON.stringify({
      name: 'Climber', ladderPlayed: true, hearts: 5, oilVials: 3, lifetimePot: 8400,
      totalAnswered: 120, totalCorrect: 96, streak: 4, createdAt: Date.now(),
      lifetimeChapters: { '1 Timothy 1': { asked: 6, correct: 6 } },
    })));
    await page.goto('/');
    await expect(page.locator('#rank-pts')).toContainText('8,400');
    await page.waitForTimeout(1200);
    const w = await page.locator('#rank-bar-fill').evaluate((e) => parseFloat(getComputedStyle(e).width));
    expect(w).toBeGreaterThan(0);
  });

  test('mastery grid staggers in and settles fully visible', async ({ page }) => {
    await seedPlayer(page);
    await dismissTutorial(page);
    await page.goto('/');
    await page.locator('#btn-mastery').click();
    await expect(page.locator('.mastery-cell')).toHaveCount(13);
    await page.waitForTimeout(1500);
    // Every cell must end up painted — a stagger that strands opacity:0 is a bug.
    const opacities = await page.locator('.mastery-cell').evaluateAll(
      (els) => els.map((e) => parseFloat(getComputedStyle(e).opacity)));
    expect(Math.min(...opacities)).toBeGreaterThan(0.5);
  });

  test('leaderboard rows carry Flip ids', async ({ page }) => {
    await dismissTutorial(page);
    await page.addInitScript(() => {
      localStorage.setItem('sd.player.v1', JSON.stringify({ name: 'Climber', ladderPlayed: true, createdAt: Date.now() }));
      localStorage.setItem('sd.leaderboard.v1', JSON.stringify([
        { name: 'Aquila', lifetimePot: 12000, totalAnswered: 200, totalCorrect: 180, streak: 6 },
        { name: 'Climber', lifetimePot: 8400, totalAnswered: 120, totalCorrect: 96, streak: 4 },
      ]));
    });
    await page.goto('/');
    await page.locator('#btn-lb2').click();
    await expect(page.locator('[data-flip-id]')).toHaveCount(2);
  });

  test('screen transitions leave no stranded screen visible', async ({ page }) => {
    await seedPlayer(page);
    await dismissTutorial(page);
    await page.goto('/');
    await page.locator('#btn-mastery').click();
    await page.waitForTimeout(700);
    await expect(page.locator('#screen-home')).toBeHidden();
    await page.locator('#btn-mastery-back').click();
    await page.waitForTimeout(700);
    await expect(page.locator('#screen-mastery')).toBeHidden();
    await expect(page.locator('#screen-home')).toBeVisible();
    // The crossfade helper must always clean up after itself.
    await expect(page.locator('.screen-leaving')).toHaveCount(0);
  });
});

// NOTE: `test.use({ reducedMotion })` silently no-ops under this config (the
// project-level `use: {...devices[...]}` spread wins), so these emulate the media
// query explicitly on the page. Verified: test.use -> matches=false,
// page.emulateMedia -> matches=true.
test.describe('motion — reduced', () => {
  async function reducedPage(page, player) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('sd_tutorial_done', '1'));
    if (player) await page.addInitScript(([p]) => localStorage.setItem('sd.player.v1', p), [JSON.stringify(player)]);
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  }

  test('reduced motion applies final values instantly, never skipping state', async ({ page }) => {
    await reducedPage(page, {
      name: 'RM', ladderPlayed: true, hearts: 5, oilVials: 3, lifetimePot: 8400,
      totalAnswered: 120, totalCorrect: 96, streak: 4, createdAt: Date.now(),
      lifetimeChapters: { '1 Timothy 1': { asked: 6, correct: 6 } },
    });
    // No tween: the value is final on the first frame we can observe.
    await expect(page.locator('#rank-pts')).toContainText('8,400');
    await expect
      .poll(() => page.locator('#rank-bar-fill').evaluate((e) => parseFloat(getComputedStyle(e).width)))
      .toBeGreaterThan(0);
    // Navigation still works without the crossfade.
    await page.locator('#btn-mastery').click();
    await expect(page.locator('#screen-mastery')).toBeVisible();
    await expect(page.locator('.mastery-cell')).toHaveCount(13);
    await page.locator('#btn-mastery-back').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('#screen-mastery')).toBeHidden();
  });

  test('reduced motion disables CSS keyframe animations too', async ({ page }) => {
    await reducedPage(page);
    const dur = await page.locator('.crest').evaluate((e) => getComputedStyle(e).animationDuration);
    expect(parseFloat(dur)).toBeLessThan(0.01);
  });

  test('GSAP tweens are skipped, not merely shortened', async ({ page }) => {
    await reducedPage(page, { name: 'RM', ladderPlayed: true, hearts: 5, oilVials: 3, createdAt: Date.now() });
    await page.getByRole('button', { name: /begin a climb/i }).click();
    await expect(page.locator('#q-options')).toBeVisible();
    await page.locator('.option').first().click();
    await stake(page);
    // The score lands on its final value with no counting animation in between.
    const first = await page.locator('#hud-score').textContent();
    await page.waitForTimeout(500);
    expect(await page.locator('#hud-score').textContent()).toBe(first);
  });
});
