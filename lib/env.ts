import { z } from 'zod';

/**
 * Single source of truth for environment variables. Validated at module load —
 * an invalid env throws *before* any code that depends on it runs.
 *
 * Phase rules:
 *  - Vars marked `.optional()` are not yet wired in code. They will be tightened to
 *    `.min(1)` once their feature ships (e.g. Shopify webhook handler in 1.6).
 *  - Adding a new var? Put it here first, then in `.env.example`, then use it.
 *
 * NEVER read `process.env.X` directly elsewhere. Import `env` from this file.
 */

const bool = z
  .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false'), z.undefined()])
  .transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Auth — required from 1.1 so NextAuth can initialize.
  NEXTAUTH_SECRET: z.string().min(32, 'NEXTAUTH_SECRET must be at least 32 chars'),
  NEXTAUTH_URL: z.string().url().default('http://localhost:3000'),
  CUSTOMER_JWT_SECRET: z.string().min(32, 'CUSTOMER_JWT_SECRET must be at least 32 chars'),

  // Database — required from 1.2.
  DATABASE_URL: z.string().url().optional(),
  DIRECT_URL: z.string().url().optional(),

  // Cloudflare — required from 1.5.
  CF_ACCOUNT_ID: z.string().optional(),
  CF_API_TOKEN: z.string().optional(),

  // Shopify — required from 1.6.
  SHOPIFY_STORE_DOMAIN: z.string().min(1, 'SHOPIFY_STORE_DOMAIN is required (e.g. sblossom.myshopify.com)'),
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().min(1, 'SHOPIFY_ADMIN_ACCESS_TOKEN is required'),
  SHOPIFY_WEBHOOK_SECRET: z.string().min(1, 'SHOPIFY_WEBHOOK_SECRET is required'),

  // R2 — required from 1.7.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_MOCKUPS_BUCKET: z.string().default('sblossom-mockups'),
  R2_QC_PHOTOS_BUCKET: z.string().default('sblossom-qc-photos'),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  // Interakt — required from 1.8 unless MOCK_INTERAKT=1.
  INTERAKT_API_KEY: z.string().optional(),
  INTERAKT_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  MOCK_INTERAKT: bool,

  // Shipmozo — Phase 2.9.
  SHIPMOZO_API_KEY: z.string().optional(),
  SHIPMOZO_API_SECRET: z.string().optional(),
  SHIPMOZO_BASE_URL: z.string().url().optional(),
  MOCK_SHIPMOZO: bool,

  // Notifications — Phase 4.3.
  TEAM_ALERT_WEBHOOK: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;
export type Env = z.infer<typeof schema>;
