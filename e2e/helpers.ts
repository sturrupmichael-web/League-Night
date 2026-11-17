/** Shared helpers for driving the canvas game in end-to-end tests. */
import { expect, type Page } from '@playwright/test';

type Btn = { x: number; y: number; w: number; h: number; value: () => string };

export async function canvasMapper(page: Page) {
  const box = (await page.locator('#game').boundingBox())!;
  const s = box.width / 180;
  return { X: (x: number) => box.x + x * s, Y: (y: number) => box.y + y * s };
}

/** Tap the on-canvas button whose label matches. */
export async function tap(page: Page, label: RegExp) {
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

export async function holeInfo(page: Page) {
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
    };
  });
}

export async function playHole(page: Page) {
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
      // Hold to charge the meter, let go once it is near a perfect putt's power.
      await page.mouse.move(X(90), Y(250));
      await page.mouse.down();
      for (let k = 0; k < 200; k++) {
        await page.waitForTimeout(8);
        const m = await page.evaluate(() => (window as any).leagueNight.scene.debug.meter);
        if (m && Math.abs(m.power - m.ideal) < (m.high - m.low) * 0.3) break;
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
