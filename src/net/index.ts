/**
 * Picks the friend-match backend: Supabase when it is configured, otherwise (or with ?fakenet)
 * the local stand-in that lets two tabs of one browser play each other.
 */
import { LocalBackend } from './local';
import { SupabaseBackend } from './supabase';
import type { NetBackend } from './types';

let backend: NetBackend | null = null;

export async function getBackend(): Promise<NetBackend> {
  if (backend) return backend;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  const fake = /[?&#]fakenet\b/.test(location.search + location.hash);
  if (url && key && !fake) {
    const sb = new SupabaseBackend(url, key);
    try {
      await Promise.race([sb.me(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))]);
      return (backend = sb);
    } catch {
      // The server can't be reached from here (offline, or a sandboxed preview page that
      // blocks outside connections). Fall back to the local test server so the screens
      // still work between two tabs, and say so on the menu.
      const local = new LocalBackend(localStorage, sessionStorage);
      Object.defineProperty(local, 'label', { value: 'CAN\'T REACH ONLINE · LOCAL TEST SERVER' });
      return (backend = local);
    }
  }
  backend = new LocalBackend(localStorage, sessionStorage);
  return backend;
}

/** For tests. */
export function setBackend(b: NetBackend | null) {
  backend = b;
}
