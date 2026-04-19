import { HealthBadge } from "@/components/HealthBadge";

export default function HomePage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Lattice</h1>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            Evidence retrieval from long documents
          </p>
        </div>
        <HealthBadge />
      </header>

      <section
        className="rounded-xl border p-6"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <h2 className="text-lg font-medium">Upload coming soon</h2>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          Drag and drop a PDF here to index it for retrieval. This is a placeholder until the
          ingestion pipeline lands.
        </p>
      </section>
    </main>
  );
}
