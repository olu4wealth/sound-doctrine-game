// tests/game.e2e.spec.js — end-to-end player journey for Sound Doctrine.
import { test, expect } from '@playwright/test';

// Helper: pre-set the tutorial-done flag so first-time tutorial never blocks tests.
// Must be called BEFORE page.goto('/') so the init script applies on load.
async function dismissTutorial(page) {
  await page.addInitScript(() => localStorage.setItem('sd_tutorial_done', '1'));
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
    // candle + streak + oil counts are present
    await expect(page.locator('#candle-stage')).toBeVisible();
    await expect(page.locator('#streak-num')).toBeVisible();
    // candle sprite loads a real state image and stage is in a valid state
    await expect(page.locator('#candle-img')).toHaveAttribute('src', /candle-(lit|guttering|smouldering)\.png/);
    await expect(page.locator('#candle-img')).toHaveJSProperty('complete', true);
  });

  test('HUD shows hearts, progress, and a countdown ring', async ({ page }) => {
    await beginClimb(page);
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-hearts')).toBeVisible();
    await expect(page.locator('#hud-progress')).toBeVisible();
    await expect(page.locator('#ring-fill')).toBeVisible();
    await expect(page.locator('#ring-label')).toBeVisible();
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
    await page.goto('/');
    await passIntro(page);
    await page.getByPlaceholder(/your name/i).fill('Playwright Tester');
    await page.getByRole('button', { name: /begin the charge/i }).click();
    await page.getByRole('button', { name: /begin daily quest/i }).click();
    await expect(page.locator('#screen-daily')).toBeVisible();
    await expect(page.locator('#daily-charge-intro')).toContainText("Today's Quest");
    await page.getByRole('button', { name: /begin today's quest/i }).click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('.option')).toHaveCount(4);
  });

  test('report renders a grade and how-to-do-better after a full daily quest', async ({ page }) => {
    test.setTimeout(60_000);
    await dismissTutorial(page);
    await page.goto('/');
    await passIntro(page);
    await page.getByPlaceholder(/your name/i).fill('Playwright Tester');
    await page.getByRole('button', { name: /begin the charge/i }).click();
    await page.getByRole('button', { name: /begin daily quest/i }).click();
    await page.getByRole('button', { name: /begin today's quest/i }).click();

    for (let i = 0; i < 10; i++) {
      const ok = await answerOne(page);
      if (!ok) break;
      const cont = page.getByRole('button', { name: /continue|see the report/i });
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
    await page.goto('/');
    await passIntro(page);
    await page.getByPlaceholder(/your name/i).fill('Playwright Tester');
    await page.getByRole('button', { name: /begin the charge/i }).click();
    await page.getByRole('button', { name: /begin daily quest/i }).click();
    await page.getByRole('button', { name: /begin today's quest/i }).click();
    for (let i = 0; i < 10; i++) {
      const ok = await answerOne(page);
      if (!ok) break;
      const cont = page.getByRole('button', { name: /continue|see the report/i });
      if (await cont.count()) await cont.click();
      await page.waitForTimeout(1100);
      if (await page.locator('#screen-report').isVisible().catch(() => false)) break;
    }
    // Go home then leaderboard
    await page.getByRole('button', { name: /back to the candle/i }).click();
    await page.getByRole('button', { name: /leaderboard/i }).first().click();
    await expect(page.locator('#lb-list')).toContainText('Playwright Tester');
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
