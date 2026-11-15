/**
 * Bundles the round checker (src/net/verifyRound.ts) and everything it needs (sim, courses,
 * chasers) into one plain JS file for the leaderboard's server function, so the server
 * replays rounds with exactly the game's own code. `npm run build:verifier`.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/net/verifyRound.ts', name: 'LNVerify', formats: ['es', 'iife'], fileName: (f) => (f === 'es' ? 'verify.js' : 'verify.iife.js') },
    outDir: 'supabase/functions/ln-submit-score',
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
  },
  publicDir: false,
});
