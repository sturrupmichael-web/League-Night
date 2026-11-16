import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_KEY, SiteAuth, type SiteSession } from './siteSession';
import { SupabaseBackend } from './supabase';

const URL_ = 'https://example.supabase.co';
const KEY = 'sb_publishable_test';

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (sub: string, exp: number) => `${b64({ alg: 'HS256' })}.${b64({ sub, email: `${sub}@example.com`, exp })}.sig`;

const store = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

const session = (id: string, expiresAt: number, refresh = 'r1'): SiteSession => ({
  access_token: jwt(id, expiresAt),
  refresh_token: refresh,
  expires_at: expiresAt,
  user: { id, email: `${id}@example.com`, guest: false },
});

const NOW = 1_800_000_000;

describe('shared michaelsturrup.com sign-in', () => {
  it('has no account when the key is empty, a guest or junk', () => {
    const s = store();
    const auth = new SiteAuth({ url: URL_, key: KEY, store: s, now: () => NOW });
    expect(auth.userId()).toBeNull();
    s.setItem(SITE_KEY, JSON.stringify({ ...session('u1', NOW + 3600), user: { id: 'u1', guest: true } }));
    expect(auth.userId()).toBeNull();
    s.setItem(SITE_KEY, '{not json');
    expect(auth.userId()).toBeNull();
  });

  it('reads the key fresh every time', async () => {
    const s = store();
    const auth = new SiteAuth({ url: URL_, key: KEY, store: s, now: () => NOW });
    s.setItem(SITE_KEY, JSON.stringify(session('u1', NOW + 3600)));
    expect(auth.userId()).toBe('u1');
    expect(await auth.token()).toBe(session('u1', NOW + 3600).access_token);
    s.removeItem(SITE_KEY);
    expect(auth.userId()).toBeNull();
    expect(await auth.token()).toBeNull();
  });

  it('refreshes a session about to expire and writes it back for the rest of the site', async () => {
    const s = store();
    s.setItem(SITE_KEY, JSON.stringify(session('u1', NOW + 30)));
    const fresh = jwt('u1', NOW + 3600);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: fresh, refresh_token: 'r2', expires_at: NOW + 3600 }), { status: 200 }));
    const auth = new SiteAuth({ url: URL_, key: KEY, store: s, fetch, now: () => NOW });
    const [a, b] = await Promise.all([auth.token(), auth.token()]);
    expect(a).toBe(fresh);
    expect(b).toBe(fresh);
    expect(fetch).toHaveBeenCalledTimes(1); // one refresh, shared
    const stored = JSON.parse(s.m.get(SITE_KEY)!) as SiteSession;
    expect(stored.refresh_token).toBe('r2');
    expect(stored.user).toEqual({ id: 'u1', email: 'u1@example.com', guest: false });
  });

  it('uses the session another page refreshed first when its own refresh is refused', async () => {
    const s = store();
    s.setItem(SITE_KEY, JSON.stringify(session('u1', NOW + 30, 'old')));
    const theirs = session('u1', NOW + 3600, 'theirs');
    const fetch = vi.fn(async () => {
      s.setItem(SITE_KEY, JSON.stringify(theirs)); // the main page got there first
      return new Response('{"error":"invalid_grant"}', { status: 400 });
    });
    const auth = new SiteAuth({ url: URL_, key: KEY, store: s, fetch, now: () => NOW });
    expect(await auth.token()).toBe(theirs.access_token);
    expect(auth.userId()).toBe('u1');
  });

  it('signs out everywhere when the sign-in has really lapsed, but not when offline', async () => {
    const s = store();
    s.setItem(SITE_KEY, JSON.stringify(session('u1', NOW + 30)));
    const offline = new SiteAuth({ url: URL_, key: KEY, store: s, fetch: async () => Promise.reject(new Error('offline')), now: () => NOW });
    expect(await offline.token()).toBeNull();
    expect(offline.userId()).toBe('u1');
    const refused = new SiteAuth({ url: URL_, key: KEY, store: s, fetch: async () => new Response('{}', { status: 400 }), now: () => NOW });
    expect(await refused.token()).toBeNull();
    expect(s.m.has(SITE_KEY)).toBe(false);
  });
});

describe('League Night online backend with the shared sign-in', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('plays as the Google account and sends its token, without making a guest', async () => {
    const s = store();
    const sess = session('google-user', NOW + 3600);
    s.setItem(SITE_KEY, JSON.stringify(sess));
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
      calls.push({ url, auth: headers.get('Authorization') });
      return new Response(JSON.stringify({ name: 'MICHAEL' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const net = new SupabaseBackend(URL_, KEY, new SiteAuth({ url: URL_, key: KEY, store: s, now: () => NOW }));
    expect(await net.me()).toBe('google-user');
    expect(net.signedIn()).toBe(true);
    expect(await net.myName()).toBe('MICHAEL');
    const rest = calls.filter((c) => c.url.includes('/rest/v1/players'));
    expect(rest).toHaveLength(1);
    expect(rest[0].auth).toBe(`Bearer ${sess.access_token}`);
    expect(calls.some((c) => c.url.includes('/auth/v1/signup'))).toBe(false);
  });
});
