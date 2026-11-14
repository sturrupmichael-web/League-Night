/**
 * Smoke test: the game boots to the title, a round starts, one hole is played to the end
 * with real taps and drags, the round autosaves, and Continue shows up after a reload.
 */
import { expect, test } from '@playwright/test';
import { playHole, tap } from './helpers';

test('boots, plays a hole, autosaves and offers Continue', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(400);

  await tap(page, /NEW ROUND/);
  await tap(page, /^SKIP$/); // first-timer practice offer
  // Setup: 9 -> 18 -> 3 holes.
  await tap(page, /9 HOLES/);
  await tap(page, /18 HOLES/);
  await tap(page, /TEE OFF/);

  await playHole(page);
  const holeOver = await page.evaluate(() => (window as any).leagueNight.scene.debug.state);
  expect(holeOver.holed || holeOver.pickedUp).toBe(true);

  await tap(page, /NEXT HOLE/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('leaguenight.save')!));
  expect(saved.round.card).toHaveLength(1);
  expect(saved.round.order).toHaveLength(3);

  await page.reload();
  await page.waitForTimeout(400);
  await tap(page, /CONTINUE/);
  const holeNo = await page.evaluate(() => (window as any).leagueNight.scene.opts.holeNumber);
  expect(holeNo).toBe(2);
  expect(errors).toEqual([]);
});

for (const mode of ['cup', 'skins'] as const) {
  test(`plays a hole of ${mode === 'cup' ? 'the Lantern Cup' : 'skins (throw by throw)'} with AI rivals`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(400);
    await tap(page, mode === 'cup' ? /THE LANTERN CUP/ : /^SKINS$/);
    await tap(page, /9 HOLES/);
    await tap(page, /18 HOLES/); // -> 3 holes
    await tap(page, /TEE OFF/);

    await playHole(page);
    if (mode === 'skins') {
      // Throw by throw: every rival throw was shown on this hole.
      const r = await page.evaluate(() => {
        const sc = (window as any).leagueNight.scene;
        return { shown: sc.rivalNext, total: sc.opts.rival.hole.throws.length };
      });
      expect(r.shown).toBe(r.total);
    }
    await tap(page, /NEXT HOLE/);
    // The leaderboard / skins board, then on to hole 2.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('leaguenight.save')!));
    expect(saved.round.settings.mode).toBe(mode);
    expect(saved.round.mulligansLeft).toBe(0);
    expect(saved.round.rivals).toHaveLength(mode === 'cup' ? 8 : 1);
    for (const r of saved.round.rivals) expect(r.scores).toHaveLength(1);
    await tap(page, /NEXT HOLE/);
    const holeNo = await page.evaluate(() => (window as any).leagueNight.scene.opts.holeNumber);
    expect(holeNo).toBe(2);
    expect(errors).toEqual([]);
  });
}
