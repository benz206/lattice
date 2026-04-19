"use client";

import { useCallback } from "react";
import type { Section } from "@/lib/api";

interface DocumentMapProps {
  sections: Section[];
}

export function DocumentMap({ sections }: DocumentMapProps): React.JSX.Element {
  const onClickSection = useCallback((ordinal: number) => {
    const target = document.getElementById(`chunk-${ordinal}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("ring-2", "ring-[color:var(--accent)]");
      window.setTimeout(() => {
        target.classList.remove("ring-2", "ring-[color:var(--accent)]");
      }, 1500);
    }
  }, []);

  if (sections.length === 0) {
    return (
      <div className="text-sm text-muted">No sections detected.</div>
    );
  }

  return (
    <nav aria-label="Document map" className="flex flex-col gap-1">
      {sections.map((s, i) => {
        const label = s.title && s.title.trim().length > 0 ? s.title : `Section ${i + 1}`;
        const pageLabel =
          s.page_start === s.page_end
            ? `p. ${s.page_start}`
            : `pp. ${s.page_start}–${s.page_end}`;
        return (
          <button
            key={`${s.chunk_ordinal_start}-${i}`}
            type="button"
            onClick={() => onClickSection(s.chunk_ordinal_start)}
            className="group flex flex-col rounded-md border border-transparent px-3 py-2 text-left transition hover:border-[color:var(--border)] hover:bg-[color:var(--card)]"
          >
            <span className="line-clamp-2 text-sm font-medium">{label}</span>
            <span className="mt-0.5 text-xs text-muted">
              {pageLabel} · {s.chunk_count} chunk{s.chunk_count === 1 ? "" : "s"}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
