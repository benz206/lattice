import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { DeleteDocumentButton } from "@/components/DeleteDocumentButton";
import { DocumentMap } from "@/components/DocumentMap";
import { DocumentTabs } from "@/components/DocumentTabs";
import { IngestionProgress } from "@/components/IngestionProgress";
import { RefreshButton } from "@/components/RefreshButton";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ApiError,
  formatBytes,
  formatDate,
  getDocument,
  getDocumentMap,
  type DocumentDetail,
  type DocumentMapResponse,
} from "@/lib/api";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DocumentDetailPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { id } = await params;

  let detail: DocumentDetail;
  let map: DocumentMapResponse = { sections: [], num_chunks: 0, num_pages: 0 };

  try {
    const [detailResp, mapResp] = await Promise.all([
      getDocument(id),
      getDocumentMap(id).catch(() => null),
    ]);
    detail = detailResp;
    if (mapResp) {
      map = mapResp;
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notFound();
    }
    throw e;
  }

  const busy = detail.status === "pending" || detail.status === "processing";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-8">
      <AppHeader subtitle="Document" />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {detail.filename}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusBadge status={detail.status} />
              <span>·</span>
              <span>{formatBytes(detail.size_bytes)}</span>
              <span>·</span>
              <span>{detail.num_pages ?? "?"} pages</span>
              <span>·</span>
              <span>{detail.num_chunks} chunks</span>
              <span>·</span>
              <span>uploaded {formatDate(detail.created_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton />
            <Link
              href={`/documents/${detail.id}/search`}
              className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-sm hover:bg-[color:var(--card)]"
            >
              Search
            </Link>
            <Link
              href={`/documents/${detail.id}/ask`}
              className="inline-flex items-center rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-sm font-semibold text-[color:var(--accent-contrast)]"
            >
              Ask
            </Link>
            <DeleteDocumentButton
              documentId={detail.id}
              filename={detail.filename}
            />
          </div>
        </div>

        {detail.error ? (
          <pre className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {detail.error}
          </pre>
        ) : null}
      </section>

      {busy ? (
        <IngestionProgress
          documentId={detail.id}
          initialStatus={detail.status}
          initialNumPages={detail.num_pages}
          initialError={detail.error}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-3 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Document map
          </h2>
          <div className="surface-card rounded-lg border p-2">
            <DocumentMap sections={map.sections} />
          </div>
        </aside>

        <section>
          <DocumentTabs
            documentId={detail.id}
            pages={detail.pages}
            numChunks={detail.num_chunks}
          />
        </section>
      </div>
    </main>
  );
}
