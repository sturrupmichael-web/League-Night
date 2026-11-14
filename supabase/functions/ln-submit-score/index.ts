// League Night leaderboard: checks a finished round and puts it on the board.
//
// The game sends the round it saved (seed, settings, card with every throw's inputs). This
// replays every throw with the game's own code (verify.js, built from src/net/verifyRound.ts
// by `npm run build:verifier`) and only stores the score the replay agrees with. The table
// takes no inserts from players; this function writes through ln_record_score with the
// service key. Deploy: supabase functions deploy ln-submit-score (verify_jwt on).
import { verifyRound } from './verify.js';

const URL = Deno.env.get('SUPABASE_URL')!;
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
  const who = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
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

  let v;
  try {
    v = verifyRound(body.round);
  } catch {
    return reply(400, { error: 'Bad round.' });
  }
  if (!v.ok) return reply(422, { error: "The replay doesn't match this card.", issues: v.issues.slice(0, 5) });

  const r = await fetch(`${URL}/rest/v1/rpc/ln_record_score`, {
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
