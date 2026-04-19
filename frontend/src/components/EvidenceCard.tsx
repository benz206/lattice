import Link from "next/link";
import type { Evidence, SearchHit } from "@/lib/api";

type EvidenceLike = Evidence | SearchHit;

function hasScoreField<T extends string>(
  obj: EvidenceLike,
  key: T,
): obj is EvidenceLike & Record<T, number | null> {
  return key in obj;
}

interface EvidenceCardProps {
  item: EvidenceLike;
  documentId?: string;
  idAttr?: string;
  label?: string;
}

export function EvidenceCard({
  item,
  documentId,
  idAttr,
  label,
}: EvidenceCardProps): React.JSX.Element {
  const pageLabel =
    item.page_start === item.page_end
      ? `p. ${item.page_start}`
      : `pp. ${item.page_start}–${item.page_end}`;

  const docId = documentId ?? item.document_id;

  const scores: { name: string; value: number }[] = [];
  if ("score" in item && typeof item.score === "number") {
    scores.push({ name: "score", value: item.score });
  }
  if (hasScoreField(item, "score_hybrid") && typeof item.score_hybrid === "number") {
    scores.push({ name: "hybrid", value: item.score_hybrid });
  }
  if (hasScoreField(item, "score_vector") && typeof item.score_vector === "number") {
    scores.push({ name: "vector", value: item.score_vector });
  }
  if (hasScoreField(item, "score_lexical") && typeof item.score_lexical === "number") {
    scores.push({ name: "lexical", value: item.score_lexical });
  }

  return (
    <article
      id={idAttr}
      className="scroll-target surface-card rounded-lg border p-4"
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        {label ? (
          <span className="rounded-sm bg-[color:var(--accent)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[color:var(--accent-contrast)]">
            {label}
          </span>
        ) : null}
        {item.section_title ? (
          <span className="font-medium">{item.section_title}</span>
        ) : (
          <span className="text-muted">Untitled section</span>
        )}
        <span className="text-muted">· {pageLabel}</span>
        <span className="text-muted">· chunk {item.ordinal}</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {scores.map((s) => (
            <span
              key={s.name}
              className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted"
            >
              {s.name} {s.value.toFixed(3)}
            </span>
          ))}
        </div>
      </header>
      <p className="mt-3 whitespace-pre-wrap font-mono text-[13px] leading-relaxed">
        {item.text}
      </p>
      <footer className="mt-3 flex items-center gap-3 text-xs">
        <Link
          href={`/documents/${docId}/pages/${item.page_start}`}
          className="text-[color:var(--accent)] hover:underline"
        >
          View page {item.page_start}
        </Link>
      </footer>
    </article>
  );
}
