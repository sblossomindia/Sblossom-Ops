/**
 * Small display formatters used across server components. Kept here so we
 * don't end up with three slightly-different `timeAgo` implementations.
 */

/** "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'in the future';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Indian Rupee formatter. Returns "—" for null/invalid. */
export function formatINR(amount: string | number | null | undefined): string {
  if (amount == null) return '—';
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
