import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ApiError,
  formatBytes,
  formatDate,
  listDocuments,
  type DocumentOut,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function DocumentsPage(): Promise<React.JSX.Element> {
  let docs: DocumentOut[] = [];
  let error: string | null = null;
  try {
    docs = await listDocuments();
  } catch (e) {
    if (e instanceof ApiError) {
      error = `Backend error ${e.status}: ${e.message}`;
    } else if (e instanceof Error) {
      error = e.message;
    } else {
      error = "Failed to load documents";
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
      <AppHeader subtitle="Library" />

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted">All ingested documents, newest first.</p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton />
          <Link
            href="/upload"
            className="inline-flex items-center rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-sm font-semibold text-[color:var(--accent-contrast)]"
          >
            Upload
          </Link>
        </div>
      </section>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      {docs.length === 0 && !error ? (
        <div className="surface-card rounded-xl border p-10 text-center">
          <h2 className="text-lg font-medium">No documents yet</h2>
          <p className="mt-2 text-sm text-muted">
            Upload one to get started.
          </p>
          <Link
            href="/upload"
            className="mt-5 inline-flex items-center rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-contrast)]"
          >
            Upload a PDF
          </Link>
        </div>
      ) : null}

      {docs.length > 0 ? (
        <div className="surface-card overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--background)] text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Filename</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Pages</th>
                <th className="px-4 py-3 text-left font-medium">Size</th>
                <th className="px-4 py-3 text-left font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr
                  key={d.id}
                  className="border-t border-line transition hover:bg-[color:var(--background)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/documents/${d.id}`}
                      className="font-medium hover:underline"
                    >
                      {d.filename}
                    </Link>
                    <div className="text-xs text-muted">{d.content_type}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3">
                    {d.num_pages ?? <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {formatBytes(d.size_bytes)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {formatDate(d.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
