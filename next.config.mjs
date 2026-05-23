import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
};

// Surface Cloudflare bindings (none yet — but R2/KV in later phases) inside
// `next dev` via a Workers proxy. No-op when not invoked from `next dev`.
initOpenNextCloudflareForDev();

export default nextConfig;
