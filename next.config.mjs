import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
};

if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform().catch(() => {
    // setupDevPlatform is best-effort in `next dev`; ignore failures so a missing
    // wrangler config doesn't block the dev server before Phase 1.5.
  });
}

export default nextConfig;
