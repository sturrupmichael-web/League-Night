/**
 * The shared michaelsturrup.com Google sign-in, against a stand-in Supabase (every request to it
 * is answered here). Signed in on another page of the site: friend matches and the leaderboard use
 * that account. Not signed in: the game makes its own anonymous guest, as before.
 */
import { expect, type BrowserContext, type Page, test } from '@playwright/test';
import { tap } from './helpers';

const SB = 'https://abeqdmurddrkrqbnfylb.supabase.co';
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (sub: string, exp: number) => `${b64({ alg: 'HS256' })}.${b64({ sub, email: `${sub}@example.com`, exp, role: 'authenticated' })}.sig`;

type Seen = { path: string; auth: string };
/** Whose token a request carried. */
const subOf = (auth: string) => {
  try {
    return JSON.parse(atob(auth.replace(/^Bearer /, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as string;
  } catch {
    return '';
  }
};

async function fakeSupabase(context: BrowserContext, guestId: string) {
  const seen: Seen[] = [];
  await context.route(`${SB}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    seen.push({ path: url.pathname, auth: (await req.headerValue('authorization')) ?? '' });
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.pathname === '/auth/v1/signup') {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      return json({ access_token: jwt(guestId, exp), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'guest-r', user: { id: guestId, aud: 'authenticated', role: 'authenticated', is_anonymous: true } });
    }
    if (url.pathname === '/rest/v1/players') return json(null);
    if (url.pathname.startsWith('/rest/v1/')) return json([]);
    return json({});
  });
  return seen;
}

async function signInOnMainPage(page: Page, id: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  await page.evaluate(
    ([id, token, exp]) => localStorage.setItem('michaelsturrup.auth.v1', JSON.stringify({ access_token: token, refresh_token: 'site-r', expires_at: exp, user: { id, email: `${id}@example.com`, guest: false } })),
    [id, jwt(id, exp), exp] as const,
  );
}

const friendsMeId = (page: Page) => page.evaluate(() => (window as any).leagueNight.app.friends.meId as string);

test('a Google sign-in from the main page is used for friend matches', async ({ context, page }) => {
  const seen = await fakeSupabase(context, 'guest-1');
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await signInOnMainPage(page, 'google-1');
  await page.reload();
  await page.waitForTimeout(400);
  await tap(page, /PLAY A FRIEND/);
  await expect.poll(() => friendsMeId(page)).toBe('google-1');
  await expect.poll(() => seen.some((s) => s.path === '/rest/v1/ln_matches')).toBe(true);
  const rest = seen.filter((s) => s.path.startsWith('/rest/v1/'));
  expect(rest.map((s) => subOf(s.auth))).toEqual(rest.map(() => 'google-1'));
  expect(seen.some((s) => s.path === '/auth/v1/signup')).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('leaguenight.auth'))).toBeNull();
  await page.screenshot({ path: 'test-results/site-sign-in/friends-signed-in.png' });
});

test('without a sign-in it plays as a guest, and follows a sign-in made in another tab', async ({ context, page }) => {
  const seen = await fakeSupabase(context, 'guest-2');
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(400);
  await tap(page, /PLAY A FRIEND/);
  await expect.poll(() => friendsMeId(page)).toBe('guest-2');
  expect(seen.some((s) => s.path === '/auth/v1/signup')).toBe(true);
  await page.screenshot({ path: 'test-results/site-sign-in/friends-guest.png' });

  // Sign in on the main page in another tab: this tab switches to that account.
  const main = await context.newPage();
  await main.goto('/');
  await signInOnMainPage(main, 'google-2');
  await expect.poll(() => friendsMeId(page)).toBe('google-2');

  // Sign out there: back to the same guest, no new one.
  await main.evaluate(() => localStorage.removeItem('michaelsturrup.auth.v1'));
  await expect.poll(() => friendsMeId(page)).toBe('guest-2');
  expect(seen.filter((s) => s.path === '/auth/v1/signup')).toHaveLength(1);
});
