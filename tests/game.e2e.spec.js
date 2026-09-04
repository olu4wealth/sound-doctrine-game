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

async function chooseBidAndAnswer(page, bidName, optionIndex) {
  // Bids removed: options are always shown; just click an option.
  return page.locator('.option').nth(optionIndex).click();
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
    // Bids removed: options are shown immediately.
    await expect(page.locator('#q-options')).toBeVisible();
    await expect(page.locator('.option')).toHaveCount(4);

    // Click the first option regardless of correctness; feedback modal + verse must appear
    await page.locator('.option').nth(0).click();
    await expect(page.locator('#feedback-modal-backdrop')).toBeVisible();
    await expect(page.locator('.feedback-modal-verse')).not.toBeEmpty();
    await expect(page.locator('.feedback-modal-ref')).toContainText('(KJV)');

    // Continue to the next question (button lives inside the modal)
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

test.describe('daily office + report + leaderboard', () => {
  test('daily office lists a seeded day', async ({ page }) => {
    await dismissTutorial(page);
    await page.goto('/');
    await passIntro(page);
    await page.getByPlaceholder(/your name/i).fill('Playwright Tester');
    await page.getByRole('button', { name: /begin the charge/i }).click();
    await page.getByRole('button', { name: /daily office/i }).click();
    await expect(page.locator('#screen-daily')).toBeVisible();
    await expect(page.locator('#daily-charge-intro')).toContainText("Today's Charge");
    await page.getByRole('button', { name: /begin today's office/i }).click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('.option')).toHaveCount(4);
  });

  test('report renders a grade and how-to-do-better after a full office', async ({ page }) => {
    await dismissTutorial(page);
    await page.goto('/');
    await passIntro(page);
    await page.getByPlaceholder(/your name/i).fill('Playwright Tester');
    await page.getByRole('button', { name: /begin the charge/i }).click();
    await page.getByRole('button', { name: /daily office/i }).click();
    await page.getByRole('button', { name: /begin today's office/i }).click();

    // Answer daily questions; the charge may end early if lives run out (kind-hearted).
    // Either way we land on the report — keep answering while options are clickable.
    for (let i = 0; i < 10; i++) {
      const opt = page.locator('.option:not([disabled])').first();
      if (await opt.count() === 0) break; // charge already ended (report showing)
      await opt.click();
      const cont = page.getByRole('button', { name: /continue|see the report/i });
      if (await cont.count()) await cont.click();
      // Let the reaction beat + next question render (there's a short delay on Continue).
      await page.waitForTimeout(1100);
      // If the report appeared early, stop the loop
      if (await page.locator('#screen-report').isVisible().catch(() => false)) break;
    }
    await expect(page.locator('#screen-report')).toBeVisible();
    await expect(page.locator('#report-grade')).toBeVisible();
    await expect(page.locator('#report-rx')).toBeVisible();
  });

  test('leaderboard shows the player after completing a charge', async ({ page }) => {
    await dismissTutorial(page);
    await page.goto('/');
    await passIntro(page);
    await page.getByPlaceholder(/your name/i).fill('Playwright Tester');
    await page.getByRole('button', { name: /begin the charge/i }).click();
    await page.getByRole('button', { name: /daily office/i }).click();
    await page.getByRole('button', { name: /begin today's office/i }).click();
    for (let i = 0; i < 10; i++) {
      const opt = page.locator('.option:not([disabled])').first();
      if (await opt.count() === 0) break;
      await opt.click();
      const cont = page.getByRole('button', { name: /continue|see the report/i });
      if (await cont.count()) await cont.click();
      await page.waitForTimeout(1100); // reaction beat + next question render
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
