import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext config for Cloudflare. Bare config for now — we don't use Next.js
 * ISR/SSG cache features, so no KV/R2/D1 cache overrides needed. The default
 * deploys our app as a single Workers script + static asset bundle.
 *
 * If we later need ISR-with-revalidation or background revalidation, add an
 * `incrementalCache` override here (KV is the usual choice).
 */
export default defineCloudflareConfig({});
