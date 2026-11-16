/**
 * The Google sign-in shared by every page of michaelsturrup.com.
 *
 * The main page's "Sign in with Google" button (and Michael's other games) keep the session in
 * localStorage under SITE_KEY. League Night doesn't sign anyone in with Google itself: if that
 * key holds a session, friend matches and the leaderboard use that account (and its leaderboard
 * name, the shared `players` row). Otherwise the game carries on with its own anonymous guest
 * account, as before.
 *
 * Read the session fresh before each use, never keep a copy: Supabase hands out a new refresh
 * token on every refresh and the old one stops working, so whichever page refreshes writes the
 * new session straight back to the key. See docs/site-sign-in.md in the
 * sturrupmichael-web.github.io repo.
 */

export const SITE_KEY = 'michaelsturrup.auth.v1';

export interface SiteSession {
  access_token: string;
  refresh_token: string;
  /** Seconds since 1970. */
  expires_at: number;
  user: { id: string; email: string; guest: false };
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Turn a token response into a session, or null. */
export function parseSession(raw: Record<string, unknown>): SiteSession | null {
  try {
    const access = String(raw.access_token);
    const payload = JSON.parse(atob(access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string; email?: string; exp?: number };
    if (!payload.sub) return null;
    return {
      access_token: access,
      refresh_token: String(raw.refresh_token ?? ''),
      expires_at: Number(raw.expires_at) || Number(payload.exp),
      user: { id: payload.sub, email: payload.email ?? '', guest: false },
    };
  } catch {
    return null;
  }
}

export interface SiteSessionOptions {
  url: string;
  key: string;
  store?: Store | null;
  fetch?: typeof fetch;
  /** Seconds since 1970; for tests. */
  now?: () => number;
}

export class SiteAuth {
  private url: string;
  private key: string;
  private store: Store | null;
  private doFetch: typeof fetch;
  private now: () => number;
  /** One refresh at a time from this page. */
  private refreshing: Promise<string | null> | null = null;

  constructor(o: SiteSessionOptions) {
    this.url = o.url;
    this.key = o.key;
    this.store = o.store === undefined ? defaultStore() : o.store;
    this.doFetch = o.fetch ?? ((...a) => fetch(...a));
    this.now = o.now ?? (() => Date.now() / 1000);
  }

  /** The signed-in Google session, read fresh from storage, or null. */
  current(): SiteSession | null {
    try {
      const raw = this.store?.getItem(SITE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as SiteSession;
      return s && s.user?.id && s.access_token && !s.user.guest ? s : null;
    } catch {
      return null;
    }
  }

  /** The signed-in account's user id, or null for a guest. */
  userId(): string | null {
    return this.current()?.user.id ?? null;
  }

  private save(s: SiteSession | null) {
    try {
      if (s) this.store?.setItem(SITE_KEY, JSON.stringify(s));
      else this.store?.removeItem(SITE_KEY);
    } catch {
      /* storage blocked: nothing to share it with anyway */
    }
  }

  /**
   * An access token good for at least another minute, refreshing it (and writing the new session
   * back for the rest of the site) when needed. Null when nobody is signed in, the sign-in has
   * lapsed, or the refresh couldn't reach the server.
   */
  async token(): Promise<string | null> {
    const s = this.current();
    if (!s) return null;
    if (s.expires_at - 60 > this.now()) return s.access_token;
    this.refreshing ??= this.refresh(s).finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async refresh(s: SiteSession): Promise<string | null> {
    let status = 0;
    let next: SiteSession | null = null;
    try {
      const res = await this.doFetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      status = res.status;
      if (res.ok) next = parseSession((await res.json()) as Record<string, unknown>);
    } catch {
      status = 0;
    }
    if (next) {
      this.save(next);
      return next.access_token;
    }
    // Offline: keep the session for later.
    if (status === 0) return null;
    // Refused. Another page may have refreshed it a moment ago: use theirs.
    const now = this.current();
    if (now && now.refresh_token !== s.refresh_token) return now.expires_at - 60 > this.now() ? now.access_token : null;
    // The sign-in has really lapsed: signed out everywhere, as the main page would do.
    this.save(null);
    return null;
  }
}

function defaultStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
