import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vitest sets NODE_ENV=test before loading this config, which makes
// @next/env's loader skip .env.local (Next convention: in test mode it only
// reads .env.test*). We don't keep a .env.test, so temporarily restore the
// NODE_ENV to force .env.local loading, then revert. The type cast is
// needed because Node's typings mark NODE_ENV as a read-only union.
const env = process.env as Record<string, string | undefined>;
const savedNodeEnv = env.NODE_ENV;
env.NODE_ENV = 'development';
const { combinedEnv } = loadEnvConfig(__dirname);
env.NODE_ENV = savedNodeEnv;

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', '.open-next', '.vercel', '.wrangler'],
    setupFiles: ['./vitest.setup.ts'],
    env: combinedEnv,
    // DB-touching tests hit Supabase pooler; latency adds up with multiple
    // round-trips per test. 5s default isn't enough for the full-happy-path
    // case (5 transitions = 5 transactions).
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
