"use client";

import { useCallback, useMemo } from "react";
import type { Section } from "@/lib/api";

interface DocumentMapProps {
  sections: Section[];
}

interface CollapsedSection {
  key: string;
  label: string;
  chunk_ordinal_start: number;
  page_start: number;
  page_end: number;
  chunk_count: number;
}

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.·•:;,–—-]+$/g, "");
}

function collapseSections(sections: Section[]): CollapsedSection[] {
  const byKey = new Map<string, CollapsedSection>();
  sections.forEach((s, i) => {
    const rawLabel = s.title && s.title.trim().length > 0 ? s.title.trim() : `Section ${i + 1}`;
    const key = normalizeTitle(s.title) || `__untitled_${i}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.page_start = Math.min(existing.page_start, s.page_start);
      existing.page_end = Math.max(existing.page_end, s.page_end);
      existing.chunk_count += s.chunk_count;
      if (s.chunk_ordinal_start < existing.chunk_ordinal_start) {
        existing.chunk_ordinal_start = s.chunk_ordinal_start;
      }
    } else {
      byKey.set(key, {
        key,
        label: rawLabel,
        chunk_ordinal_start: s.chunk_ordinal_start,
        page_start: s.page_start,
        page_end: s.page_end,
        chunk_count: s.chunk_count,
      });
    }
  });
  return Array.from(byKey.values()).sort((a, b) => a.chunk_ordinal_start - b.chunk_ordinal_start);
}

export function DocumentMap({ sections }: DocumentMapProps): React.JSX.Element {
  const collapsed = useMemo(() => collapseSections(sections), [sections]);

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

  if (collapsed.length === 0) {
    return (
      <div className="text-sm text-muted">No sections detected.</div>
    );
  }

  return (
    <nav aria-label="Document map" className="flex flex-col gap-1">
      {collapsed.map((s) => {
        const pageLabel =
          s.page_start === s.page_end
            ? `p. ${s.page_start}`
            : `pp. ${s.page_start}–${s.page_end}`;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onClickSection(s.chunk_ordinal_start)}
            className="group flex flex-col rounded-md border border-transparent px-3 py-2 text-left transition hover:border-[color:var(--border)] hover:bg-[color:var(--card)]"
          >
            <span className="line-clamp-2 text-sm font-medium">{s.label}</span>
            <span className="mt-0.5 text-xs text-muted">
              {pageLabel} · {s.chunk_count} chunk{s.chunk_count === 1 ? "" : "s"}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
