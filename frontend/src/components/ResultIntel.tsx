import type { AnswerResponse, Evidence, SearchHit, SearchMode } from "@/lib/api";

type ResultItem = Evidence | SearchHit;

interface ResultIntelProps {
  title: string;
  query: string;
  items: ResultItem[];
  mode?: SearchMode;
  answer?: AnswerResponse;
}

function pageRange(items: ResultItem[]): string {
  const pages = new Set<number>();
  for (const item of items) {
    for (let p = item.page_start; p <= item.page_end; p += 1) {
      if (p > 0) pages.add(p);
    }
  }
  const sorted = [...pages].sort((a, b) => a - b);
  if (sorted.length === 0) return "none";
  if (sorted.length <= 6) return sorted.map((p) => String(p)).join(", ");
  return `${sorted.slice(0, 3).join(", ")} ... ${sorted.slice(-2).join(", ")}`;
}

function chunkRange(items: ResultItem[]): string {
  const ordinals = items.map((item) => item.ordinal).sort((a, b) => a - b);
  if (ordinals.length === 0) return "none";
  return `${ordinals[0]}-${ordinals[ordinals.length - 1]}`;
}

function scoreRange(items: ResultItem[]): string {
  const scores = items
    .map((item) => {
      if ("score" in item) return item.score;
      return item.score_hybrid;
    })
    .filter((score) => Number.isFinite(score));
  if (scores.length === 0) return "none";
  return `${Math.min(...scores).toFixed(3)}-${Math.max(...scores).toFixed(3)}`;
}

function uniqueSections(items: ResultItem[]): string {
  const sections = new Set(
    items
      .map((item) => item.section_title?.trim())
      .filter((title): title is string => Boolean(title)),
  );
  if (sections.size === 0) return "untitled";
  if (sections.size > 3) return `${sections.size} sections`;
  return [...sections].join(", ");
}

export function ResultIntel({
  title,
  query,
  items,
  mode,
  answer,
}: ResultIntelProps): React.JSX.Element {
  const facts = [
    { label: "results", value: String(items.length) },
    { label: "pages", value: pageRange(items) },
    { label: "chunks", value: chunkRange(items) },
    { label: "score range", value: scoreRange(items) },
  ];

  if (mode) {
    facts.push({ label: "mode", value: mode });
  }
  if (answer) {
    facts.push(
      { label: "citations", value: String(answer.citations.length) },
      { label: "confidence", value: answer.confidence.toFixed(2) },
      { label: "answer score", value: answer.answer_score.toFixed(2) },
      { label: "model", value: String(answer.retrieval_meta.model ?? "unknown") },
    );
  }

  return (
    <section className="surface-card rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {title}
        </p>
        <p className="line-clamp-2 text-sm">{query}</p>
        <p className="text-xs text-muted">Sections: {uniqueSections(items)}</p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="rounded-md border border-line px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {fact.label}
            </dt>
            <dd className="mt-1 truncate text-sm font-medium">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {answer ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          <span>top_k {answer.retrieval_meta.top_k}</span>
          <span>alpha {Number(answer.retrieval_meta.alpha ?? 0).toFixed(2)}</span>
          <span>max score {Number(answer.retrieval_meta.max_score ?? 0).toFixed(3)}</span>
          <span>score {answer.answer_score.toFixed(2)}</span>
          <span>{answer.insufficient ? "insufficient evidence" : "answer composed"}</span>
        </div>
      ) : null}
    </section>
  );
}
