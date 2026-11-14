/**
 * Two players in two tabs play a friend match against the local stand-in server (?fakenet):
 * host gets a code, guest joins with it, both play hole 1, chat, and the cards line up.
 */
import { expect, type Page, test } from '@playwright/test';
import { playHole, tap } from './helpers';

async function typeCode(page: Page, code: string) {
  for (const ch of code) await tap(page, new RegExp(`^${ch}$`));
}

const scene = (page: Page) => page.evaluate(() => {
  const f = (window as any).leagueNight.app.friends;
  const c = f.cur;
  return c ? { status: c.match.status, code: c.match.code, throws: c.throws.length, msgs: c.messages.length, verdicts: [...f.verdicts.values()].map((v: any) => v.ok) } : null;
});

test('two tabs play a friend match hole and check each other', async ({ context }) => {
  const errors: string[] = [];
  const host = await context.newPage();
  const guest = await context.newPage();
  for (const p of [host, guest]) p.on('pageerror', (e) => errors.push(String(e)));
  await host.goto('/?fakenet');
  await host.evaluate(() => localStorage.clear());
  await host.reload();
  await guest.goto('/?fakenet');
  await host.waitForTimeout(400);

  // Host: 3 holes, play ahead off, throw by throw.
  await tap(host, /PLAY A FRIEND/);
  await tap(host, /HOST A MATCH/);
  await tap(host, /9 HOLES/);
  await tap(host, /18 HOLES/); // -> 3
  await tap(host, /GET A CODE/);
  await host.waitForTimeout(300);
  const code = (await scene(host))!.code;
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  // Guest joins with the code.
  await tap(guest, /PLAY A FRIEND/);
  await tap(guest, /JOIN WITH A CODE/);
  await typeCode(guest, code);
  await tap(guest, /^JOIN$/);
  await guest.waitForTimeout(400);
  expect((await scene(guest))!.status).toBe('active');
  await host.waitForTimeout(400);
  expect((await scene(host))!.status).toBe('active'); // live update reached the host

  // Host plays hole 1; then can't start hole 2 (play ahead is off).
  await tap(host, /PLAY HOLE 1/);
  await playHole(host);
  await tap(host, /NEXT HOLE|SEE THE CARD/);
  await host.waitForTimeout(600);
  const disabled = await host.evaluate(() => {
    const b = (window as any).leagueNight.scene.buttons[0];
    return { on: b.enabled(), cap: b.caption() };
  });
  expect(disabled).toEqual({ on: false, cap: 'WAITING ON YOUR FRIEND' });

  // Guest sees the host's throws on their hole, plays it, and the host's card checks out.
  await guest.waitForTimeout(300);
  expect((await scene(guest))!.verdicts).toEqual([true]);
  await tap(guest, /PLAY HOLE 1/);
  const rivalThrows = await guest.evaluate(() => (window as any).leagueNight.scene.opts.rival?.hole.throws.length ?? 0);
  expect(rivalThrows).toBeGreaterThan(0);
  await playHole(guest);
  await tap(guest, /NEXT HOLE|SEE THE CARD/);
  await guest.waitForTimeout(600);

  // Quick chat from the guest.
  await tap(guest, /^CHAT$/);
  await tap(guest, /GOOD GAME/);
  await guest.waitForTimeout(300);
  await host.waitForTimeout(300);
  const h = (await scene(host))!;
  expect(h.msgs).toBe(1);
  expect(h.verdicts).toEqual([true]);
  // Host may play hole 2 now.
  await tap(host, /PLAY HOLE 2/);
  expect(await host.evaluate(() => (window as any).leagueNight.scene.opts.holeNumber)).toBe(2);
  expect(errors).toEqual([]);
});
