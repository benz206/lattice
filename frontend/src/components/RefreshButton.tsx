"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "./Spinner";

interface RefreshButtonProps {
  label?: string;
  className?: string;
}

export function RefreshButton({
  label = "Refresh",
  className,
}: RefreshButtonProps): React.JSX.Element {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className={`inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-[color:var(--card)] disabled:opacity-50 ${
        className ?? ""
      }`}
    >
      {pending ? <Spinner size={14} /> : null}
      {label}
    </button>
  );
}
