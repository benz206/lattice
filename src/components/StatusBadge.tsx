import type { Status } from "@/lib/api";

interface StatusBadgeProps {
  status: Status | string;
  className?: string;
}

const STYLES: Record<string, string> = {
  pending: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
  processing: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  ready: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

export function StatusBadge({ status, className }: StatusBadgeProps): React.JSX.Element {
  const cls = STYLES[status] ?? STYLES.pending;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${cls} ${
        className ?? ""
      }`}
    >
      {status}
    </span>
  );
}
