'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

import type { SearchResult } from '@/app/api/search/route';

const DEBOUNCE_MS = 200;
const MIN_LEN = 2;

const STATE_LABEL: Record<SearchResult['state'], string> = {
  approval_pending: 'Approval Pending',
  in_production: 'In Production',
  qc_passed: 'QC Passed',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced fetch.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_LEN) {
      setResults([]);
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctl.signal,
        });
        if (!res.ok) {
          setResults([]);
        } else {
          setResults((await res.json()) as SearchResult[]);
        }
      } catch {
        // aborted or network — silently drop
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function pick(url: string) {
    setQuery('');
    setOpen(false);
    setResults([]);
    router.push(url as Parameters<typeof router.push>[0]);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
    }
    if (e.key === 'Enter' && results[0]) {
      e.preventDefault();
      pick(results[0].detailUrl);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= MIN_LEN && setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search order #, name, phone, email…"
          className="pl-8"
          aria-label="Global search"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-auto rounded-md border bg-popover shadow-lg">
          {loading && results.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No matches.</div>
          ) : (
            <ul className="divide-y">
              {results.map((r) => (
                <li key={r.id}>
                  <Link
                    href={r.detailUrl as Parameters<typeof Link>[0]['href']}
                    onClick={(e) => {
                      e.preventDefault();
                      pick(r.detailUrl);
                    }}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.shopifyOrderName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.customerName}
                        {' · '}
                        <span className="font-mono">{r.customerPhone}</span>
                        {r.customerEmail && (
                          <>
                            {' · '}
                            {r.customerEmail}
                          </>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {STATE_LABEL[r.state]}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
