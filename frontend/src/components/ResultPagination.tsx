"use client";

interface ResultPaginationProps {
  ariaLabel?: string;
  itemLabel?: string;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function ResultPagination({
  ariaLabel = "Pagination",
  itemLabel,
  page,
  pageSize,
  total,
  onPageChange,
}: ResultPaginationProps): React.JSX.Element | null {
  if (total <= pageSize) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize + 1;
  const end = Math.min(total, current * pageSize);

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - current) <= 1,
  );

  return (
    <nav
      aria-label={ariaLabel}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
    >
      <span className="text-xs text-muted">
        Showing {start}-{end} of {total}
        {itemLabel ? ` ${itemLabel}` : ""}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={current === 1}
          onClick={() => onPageChange(current - 1)}
          className="rounded-md border border-line px-2 py-1 text-xs disabled:opacity-40"
        >
          Prev
        </button>
        {pages.map((p, i) => {
          const prev = pages[i - 1];
          const needsGap = prev !== undefined && p - prev > 1;
          return (
            <span key={p} className="inline-flex items-center gap-1">
              {needsGap ? <span className="px-1 text-xs text-muted">...</span> : null}
              <button
                type="button"
                aria-current={p === current ? "page" : undefined}
                onClick={() => onPageChange(p)}
                className={`min-w-8 rounded-md border px-2 py-1 text-xs ${
                  p === current
                    ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-contrast)]"
                    : "border-line"
                }`}
              >
                {p}
              </button>
            </span>
          );
        })}
        <button
          type="button"
          disabled={current === totalPages}
          onClick={() => onPageChange(current + 1)}
          className="rounded-md border border-line px-2 py-1 text-xs disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
