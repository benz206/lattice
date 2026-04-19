import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import {
  ApiError,
  getDocument,
  getPage,
  type DocumentDetail,
  type PageFull,
} from "@/lib/api";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string; pageNumber: string }>;
}

export default async function PageViewPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { id, pageNumber } = await params;
  const n = Number.parseInt(pageNumber, 10);
  if (!Number.isFinite(n) || n < 1) {
    notFound();
  }

  let detail: DocumentDetail;
  let page: PageFull;
  try {
    const [detailResp, pageResp] = await Promise.all([getDocument(id), getPage(id, n)]);
    detail = detailResp;
    page = pageResp;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notFound();
    }
    throw e;
  }

  const totalPages = detail.num_pages ?? detail.pages.length;
  const hasPrev = n > 1;
  const hasNext = n < totalPages;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-8">
      <AppHeader subtitle={`Page ${n} of ${detail.filename}`} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/documents/${id}`}
            className="text-sm text-[color:var(--accent)] hover:underline"
          >
            Back to {detail.filename}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Page {page.page_number}
          </h1>
          <p className="text-xs text-muted">
            {page.char_count} characters · page {n} of {totalPages}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasPrev ? (
            <Link
              href={`/documents/${id}/pages/${n - 1}`}
              className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-sm hover:bg-[color:var(--card)]"
            >
              Previous
            </Link>
          ) : (
            <span className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-sm text-muted opacity-50">
              Previous
            </span>
          )}
          {hasNext ? (
            <Link
              href={`/documents/${id}/pages/${n + 1}`}
              className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-sm hover:bg-[color:var(--card)]"
            >
              Next
            </Link>
          ) : (
            <span className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-sm text-muted opacity-50">
              Next
            </span>
          )}
        </div>
      </div>

      <article className="surface-card rounded-xl border p-6">
        <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">
          {page.text}
        </pre>
      </article>
    </main>
  );
}
