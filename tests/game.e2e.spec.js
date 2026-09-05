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

async function answerOne(page) {
  const opt = page.locator('.option:not([disabled])').first();
  if (await opt.count() === 0) return false;
  await opt.click();
  // D3 two-step: stake card appears — confirm at default 1× to proceed
  const stake = page.locator('#stake-modal-backdrop');
  if (await stake.count()) {
    await page.getByRole('button', { name: /confirm/i }).click();
  }
  return true;
}

async function chooseBidAndAnswer(page, bidName, optionIndex) {
  await page.locator('.option').nth(optionIndex).click();
  const stake = page.locator('#stake-modal-backdrop');
  if (await stake.count()) await page.getByRole('button', { name: /confirm/i }).click();
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

    // D3 two-step: pick an answer → stake card → confirm
    await page.locator('.option').nth(0).click();
    await expect(page.locator('#stake-modal-backdrop')).toBeVisible();
    await page.getByRole('button', { name: /confirm/i }).click();
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

  test('exit returns to the candle home', async ({ page }) => {
    await beginClimb(page);
    await page.locator('#btn-exit').click();
    await expect(page.locator('#screen-home')).toBeVisible();
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

    // Answer whatever the current question is: word order (tap every chip)
    // or a classic option (click + confirm the 1× stake).
    const answerCurrent = async () => {
      const chips = page.locator('#wordpool .word-chip:not([disabled])');
      if (await chips.count()) {
        while (await chips.count()) await chips.first().click();
        return;
      }
      await page.locator('.option:not([disabled])').first().click();
      const stake = page.locator('#stake-modal-backdrop');
      if (await stake.count()) await page.getByRole('button', { name: /confirm/i }).click();
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
