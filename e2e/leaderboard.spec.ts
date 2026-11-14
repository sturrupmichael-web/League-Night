/**
 * Leaderboard on the local test server: play a whole 9, post it, pick a name on the way,
 * and find it on the board. The real server replays the same card with the same code.
 */
import { expect, test } from '@playwright/test';
import { playHole, tap } from './helpers';

test('posts a finished 9 to the leaderboard', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?fakenet');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(400);

  await tap(page, /NEW ROUND/);
  await tap(page, /^SKIP$/);
  // The length button cycles 3 / 9 / 18.
  for (let i = 0; i < 3; i++) {
    const has9 = await page.evaluate(() => (window as any).leagueNight.scene.buttons.some((b: any) => b.value() === '< 9 HOLES >'));
    if (has9) break;
    await tap(page, /HOLES >/);
  }
  await tap(page, /TEE OFF/);
  for (let h = 0; h < 9; h++) {
    await playHole(page);
    await tap(page, /NEXT HOLE|SEE THE CARD|FINISH|DONE/);
    if (h === 8) await tap(page, /^SKIP$/); // the turn minigame offer
  }
  await tap(page, /^POST$/);
  await page.waitForTimeout(300);
  await page.keyboard.type('Tester');
  await tap(page, /^SAVE$/);
  await page.waitForTimeout(800);
  const posted = await page.evaluate(() => (window as any).leagueNight.scene.posted);
  expect(posted).toBe('#1');

  await tap(page, /^TITLE$/);
  await tap(page, /^LEADERBOARD$/);
  await tap(page, /^9$/);
  await page.waitForTimeout(400);
  const rows = await page.evaluate(() => (window as any).leagueNight.scene.rows);
  expect(rows.map((r: { name: string }) => r.name)).toEqual(['TESTER']);
  expect(errors).toEqual([]);
});
