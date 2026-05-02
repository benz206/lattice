import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

export default function HomePage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-10">
      <AppHeader />

      <section className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">
          Evidence retrieval from long documents
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          Upload a PDF, and Lattice will chunk, embed, and index it. Ask questions
          and get answers grounded in citable passages from the source text.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link
          href="/upload"
          className="surface-card group flex flex-col justify-between rounded-xl border p-6 transition hover:border-[color:var(--accent)]"
        >
          <div>
            <h2 className="text-lg font-semibold">Upload a document</h2>
            <p className="mt-2 text-sm text-muted">
              Drag and drop a PDF. Lattice ingests, chunks, and embeds it for
              retrieval.
            </p>
          </div>
          <span className="mt-6 inline-flex items-center gap-1 text-sm text-[color:var(--accent)] group-hover:underline">
            Start uploading
            <span aria-hidden="true">-&gt;</span>
          </span>
        </Link>

        <Link
          href="/documents"
          className="surface-card group flex flex-col justify-between rounded-xl border p-6 transition hover:border-[color:var(--accent)]"
        >
          <div>
            <h2 className="text-lg font-semibold">Browse documents</h2>
            <p className="mt-2 text-sm text-muted">
              See indexed documents, inspect their structure, and ask questions
              against the corpus.
            </p>
          </div>
          <span className="mt-6 inline-flex items-center gap-1 text-sm text-[color:var(--accent)] group-hover:underline">
            Open library
            <span aria-hidden="true">-&gt;</span>
          </span>
        </Link>
      </section>
    </main>
  );
}
