/**
 * Shared layout for all admin tab pages — sticky top bar with a logo home-link
 * and the global search box. Auth gating is enforced by `middleware.ts`; this
 * layout just provides chrome.
 */
import Link from 'next/link';

import { GlobalSearch } from '@/components/admin/global-search';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container max-w-5xl flex items-center gap-4 py-3">
          <Link
            href="/"
            className="shrink-0 text-sm font-bold text-primary hover:underline"
          >
            Sblossom Ops
          </Link>
          <GlobalSearch />
        </div>
      </header>
      {children}
    </>
  );
}
