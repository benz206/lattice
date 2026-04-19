"use client";

import { useEffect, useState } from "react";
import { getHealth } from "@/lib/api";

type Status = "loading" | "ok" | "unreachable";

export function HealthBadge(): React.JSX.Element {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getHealth();
        if (!cancelled) {
          setStatus(data.status === "ok" ? "ok" : "unreachable");
        }
      } catch {
        if (!cancelled) {
          setStatus("unreachable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const label: string =
    status === "loading"
      ? "backend: checking..."
      : status === "ok"
        ? "backend: ok"
        : "backend: unreachable";

  const color: string =
    status === "ok"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : status === "unreachable"
        ? "bg-red-500/15 text-red-400 border-red-500/30"
        : "bg-neutral-500/15 text-neutral-400 border-neutral-500/30";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}
