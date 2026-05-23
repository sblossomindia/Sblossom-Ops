import { env } from '@/lib/env';

export default function Home() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-4 py-16">
      <h1 className="text-4xl font-bold text-primary">Sblossom Ops</h1>
      <p className="text-muted-foreground">Scaffold up. Running in {env.NODE_ENV} mode.</p>
      <p className="text-sm text-muted-foreground">
        Next stop: task 1.2 — database schema &amp; migrations.
      </p>
    </main>
  );
}
