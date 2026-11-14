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
    backend = new SupabaseBackend(url, key);
  } else {
    backend = new LocalBackend(localStorage, sessionStorage);
  }
  return backend;
}

/** For tests. */
export function setBackend(b: NetBackend | null) {
  backend = b;
}
