import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build can be dropped into any folder on a game portal.
  base: './',
  server: { host: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
