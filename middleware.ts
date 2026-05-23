/**
 * Edge middleware: enforces the auth gate defined in auth.config.authorized.
 *
 * The matcher skips static assets and the NextAuth API route (which must run
 * unprotected to issue/verify sessions). Everything else flows through the
 * `authorized` callback.
 */
import NextAuth from 'next-auth';

import { authConfig } from '@/auth.config';

export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    // Skip Next internals, static files, and infrastructure API routes:
    //   - /api/auth/*       NextAuth handlers (manage their own cookies)
    //   - /api/webhooks/*   Inbound from Shopify/Interakt (HMAC-verified, no cookies)
    //   - /api/cron/*       Cloudflare Cron Triggers (shared-secret auth, Phase 2.4)
    '/((?!api/auth|api/webhooks|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|gif)$).*)',
  ],
};
