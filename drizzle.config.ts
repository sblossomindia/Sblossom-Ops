import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd());

// `drizzle-kit generate` doesn't connect; `push`/`studio` do. We pass a sentinel
// so generate works before env is filled in. Anything that connects will fail
// loudly on the URL itself, which is the error we want.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgres://invalid';

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  // schema.sql adds objects drizzle-kit doesn't track (extensions, view, functions,
  // triggers). The initial migration is hand-authored to include all of those —
  // drizzle's diff would otherwise want to drop them on subsequent generates.
  verbose: true,
  strict: true,
});
