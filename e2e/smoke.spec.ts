/**
 * Smoke test: the game boots to the title, a round starts, one hole is played to the end
 * with real taps and drags, the round autosaves, and Continue shows up after a reload.
 */
import { expect, type Page, test } from '@playwright/test';

type Btn = { x: number; y: number; w: number; h: number; value: () => string };

async function canvasMapper(page: Page) {
  const box = (await page.locator('#game').boundingBox())!;
  const s = box.width / 180;
  return { X: (x: number) => box.x + x * s, Y: (y: number) => box.y + y * s };
}

/** Tap the on-canvas button whose label matches. */
async function tap(page: Page, label: RegExp) {
  const b = await page.evaluate((src) => {
    const re = new RegExp(src);
    const sc = (window as any).leagueNight.scene;
    const all: Btn[] = [...(sc.doneButtons ?? []), ...(sc.buttons ?? [])];
    const btn = all.find((x) => re.test(x.value()));
    return btn ? { x: btn.x + btn.w / 2, y: btn.y + btn.h / 2 } : null;
  }, label.source);
  expect(b, `button ${label}`).not.toBeNull();
  const { X, Y } = await canvasMapper(page);
  await page.mouse.click(X(b!.x), Y(b!.y));
  await page.waitForTimeout(150);
}

async function holeInfo(page: Page) {
  return page.evaluate(() => {
    const sc = (window as any).leagueNight.scene;
    if (!sc.debug) return null;
    const d = sc.debug;
    const cam = sc.rig.cam;
    const ws = (x: number, y: number) => ({ x: cam.ax + (x - cam.x) * cam.zoom, y: cam.ay - (y - cam.y) * cam.zoom });
    const bk = sc.hole.basket;
    const cfg = (window as any).leagueNight.config;
    return {
      mode: d.mode as string,
      putt: d.puttView as boolean,
      dist: Math.hypot(bk.x - d.lie.x, bk.y - d.lie.y),
      disc: ws(d.lie.x, d.lie.y),
      basket: ws(bk.x, bk.y),
      gimme: cfg.gimmeFt as number,
      pull: cfg.maxPullPx as number,
      swipe: cfg.puttFullSwipePx as number,
      snapRef: cfg.puttSnapRef as number,
    };
  });
}

async function playHole(page: Page) {
  const { X, Y } = await canvasMapper(page);
  for (let i = 0; i < 40; i++) {
    const h = await holeInfo(page);
    if (!h || h.mode === 'done') return;
    if (h.mode === 'intro') {
      await page.mouse.click(X(90), Y(150));
    } else if (h.mode !== 'aim') {
      await page.mouse.click(X(90), Y(150)); // skip flights
      await page.waitForTimeout(400);
      continue;
    } else if (h.putt) {
      const len = Math.min(1.1, 0.09 + h.dist / 75) * h.swipe;
      await page.mouse.move(X(90), Y(250));
      await page.mouse.down();
      for (let k = 1; k <= 10; k++) {
        await page.mouse.move(X(90), Y(250 - (len * k) / 10));
        await page.waitForTimeout(len / h.snapRef * 100);
      }
      await page.mouse.up();
    } else if (h.dist <= h.gimme) {
      await page.mouse.click(X(h.disc.x), Y(h.disc.y));
    } else {
      const dx = h.basket.x - h.disc.x;
      const dy = h.basket.y - h.disc.y;
      const L = Math.hypot(dx, dy);
      const pull = Math.min(1, 0.25 + h.dist / 330) * h.pull;
      await page.mouse.move(X(h.disc.x), Y(h.disc.y));
      await page.mouse.down();
      await page.mouse.move(X(h.disc.x - (dx / L) * pull), Y(h.disc.y - (dy / L) * pull), { steps: 6 });
      await page.mouse.up();
    }
    await page.waitForTimeout(500);
  }
  throw new Error('hole did not finish');
}

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
