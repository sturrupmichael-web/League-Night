// League Night leaderboard: checks a finished round and puts it on the board.
//
// The game sends the round it saved (seed, settings, card with every throw's inputs). This
// replays every throw with the game's own code and only stores the score the replay agrees
// with. The table takes no inserts from players; this function writes through
// ln_record_score with the service key.
//
// The replay code is verify.iife.js (built from src/net/verifyRound.ts by
// `npm run build:verifier`). It is too big to paste into a deploy, so the function loads it
// from this public repository at a pinned commit and checks its SHA-256 before running it.
// After changing the physics or courses: rebuild it, commit, then update VERIFIER_COMMIT and
// VERIFIER_SHA256 below and redeploy this file (verify_jwt on).
const VERIFIER_COMMIT = '43c3f805bf2cbec4a054f4f9ae66eb1ded1f3fd5';
const VERIFIER_SHA256 = 'efa91606cf8a74b240a88257e926c70231c33dd362c11cac104840cd26ffa406';
const VERIFIER_URL = `https://raw.githubusercontent.com/sturrupmichael-web/League-Night/${VERIFIER_COMMIT}/supabase/functions/ln-submit-score/verify.iife.js`;

type Verdict = { ok: boolean; issues: string[]; courseId: string; holes: number; strokes: number; par: number; mulligans: number; mode: string; chaserId: string };
let verifier: Promise<(round: unknown) => Verdict> | null = null;

async function loadVerifier(): Promise<(round: unknown) => Verdict> {
  const res = await fetch(VERIFIER_URL);
  if (!res.ok) throw new Error(`verifier download failed: ${res.status}`);
  const code = await res.text();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== VERIFIER_SHA256) throw new Error('verifier checksum mismatch');
  const mod = new Function(`${code};return LNVerify;`)() as { verifyRound: (round: unknown) => Verdict };
  return mod.verifyRound;
}

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_BODY = 600_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  // Who is posting: the player's own session token.
  const auth = req.headers.get('Authorization') ?? '';
  const who = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!who.ok) return reply(401, { error: 'Sign in again and retry.' });
  const user = (await who.json()) as { id?: string };
  if (!user.id) return reply(401, { error: 'Sign in again and retry.' });

  const text = await req.text();
  if (text.length > MAX_BODY) return reply(413, { error: 'Round is too big.' });
  let body: { round?: unknown; version?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: 'Bad round.' });
  }

  let verifyRound: (round: unknown) => Verdict;
  try {
    verifyRound = await (verifier ??= loadVerifier());
  } catch (e) {
    verifier = null;
    console.error(String(e));
    return reply(503, { error: "The score checker isn't available. Try again later." });
  }
  let v: Verdict;
  try {
    v = verifyRound(body.round);
  } catch {
    return reply(400, { error: 'Bad round.' });
  }
  if (!v.ok) return reply(422, { error: "The replay doesn't match this card.", issues: v.issues.slice(0, 5) });

  const r = await fetch(`${SB_URL}/rest/v1/rpc/ln_record_score`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_user: user.id,
      p_course: v.courseId,
      p_holes: v.holes,
      p_strokes: v.strokes,
      p_par: v.par,
      p_mode: v.mode,
      p_chaser: String(v.chaserId).slice(0, 20),
      p_mulligans: v.mulligans,
      p_seed: (body.round as { seed: number }).seed,
      p_version: String(body.version ?? '').slice(0, 20),
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return reply(409, { error: String(out?.message ?? 'Could not save the score.').slice(0, 160) });
  return reply(200, out);
});
