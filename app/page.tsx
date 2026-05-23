import { signOut } from '@/auth';
import { requireSession } from '@/lib/auth';

export default async function Home() {
  const session = await requireSession();
  const { user } = session;

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-16">
      <h1 className="text-4xl font-bold text-primary">Sblossom Ops</h1>
      <p className="text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{user.email}</span>{' '}
        <span className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
          {user.role}
        </span>
      </p>
      <p className="text-sm text-muted-foreground">
        Placeholder dashboard. Real nav lands in Phase 4.
      </p>

      <nav className="flex flex-wrap items-center justify-center gap-3">
        <a
          href="/orders/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Tab 1 — Order Create →
        </a>
        <a
          href="/orders/in-production"
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Tab 2 — In Production →
        </a>
      </nav>

      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: '/login' });
        }}
      >
        <button
          type="submit"
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
