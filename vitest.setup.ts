/**
 * Vitest global setup. Loads `.env.local` so DB-touching tests have the
 * Supabase URL + auth secrets available before `lib/env.ts` validates them.
 */
import { loadEnvConfig } from '@next/env';
import { vi } from 'vitest';

loadEnvConfig(process.cwd());

// Silence the [interakt:mock] console.warn calls during tests. They're useful
// when running real code interactively, just noise when running suites.
vi.spyOn(console, 'warn').mockImplementation(() => {});
