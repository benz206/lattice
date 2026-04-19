"use client";

import Link from "next/link";
import { useState } from "react";
import type { PageOut } from "@/lib/api";
import { ChunksPanel } from "./ChunksPanel";

interface DocumentTabsProps {
  documentId: string;
  pages: PageOut[];
  numChunks: number;
}

type TabKey = "pages" | "chunks";

export function DocumentTabs({
  documentId,
  pages,
  numChunks,
}: DocumentTabsProps): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>("pages");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex border-b border-line">
        <TabButton
          active={tab === "pages"}
          onClick={() => setTab("pages")}
          label={`Pages (${pages.length})`}
        />
        <TabButton
          active={tab === "chunks"}
          onClick={() => setTab("chunks")}
          label={`Chunks (${numChunks})`}
        />
      </div>

      {tab === "pages" ? (
        <div className="flex flex-col gap-3">
          {pages.length === 0 ? (
            <p className="text-sm text-muted">No pages yet.</p>
          ) : null}
          {pages.map((p) => (
            <article
              key={p.page_number}
              className="surface-card rounded-lg border p-4"
            >
              <header className="flex items-center justify-between text-xs">
                <span className="font-medium">Page {p.page_number}</span>
                <span className="font-mono text-[10px] text-muted">
                  {p.char_count} chars
                </span>
              </header>
              <p className="mt-2 line-clamp-6 whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-muted">
                {p.preview}
              </p>
              <footer className="mt-3 text-xs">
                <Link
                  href={`/documents/${documentId}/pages/${p.page_number}`}
                  className="text-[color:var(--accent)] hover:underline"
                >
                  Read full page
                </Link>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <ChunksPanel documentId={documentId} totalChunks={numChunks} />
      )}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function TabButton({ active, onClick, label }: TabButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
        active
          ? "border-[color:var(--accent)] text-[color:var(--foreground)]"
          : "border-transparent text-muted hover:text-[color:var(--foreground)]"
      }`}
    >
      {label}
    </button>
  );
}
