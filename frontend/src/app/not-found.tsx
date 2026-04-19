import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

export default function NotFound(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <AppHeader />
      <section className="surface-card rounded-xl border p-10 text-center">
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-muted">
          The page or document you requested does not exist.
        </p>
        <Link
          href="/documents"
          className="mt-4 inline-flex items-center rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-sm font-semibold text-[color:var(--accent-contrast)]"
        >
          Go to documents
        </Link>
      </section>
    </main>
  );
}
