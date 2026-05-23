/**
 * NextAuth v5 route handlers. The `handlers` object is exported from auth.ts.
 * Runs on the Node runtime (default for App Router route handlers); needs Node
 * APIs for bcrypt + postgres-js used inside Credentials.authorize().
 */
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
