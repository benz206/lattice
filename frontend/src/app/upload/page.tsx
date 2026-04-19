import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { UploadDropzone } from "@/components/UploadDropzone";

export default function UploadPage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-10">
      <AppHeader subtitle="Upload" />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Upload a document</h1>
        <p className="text-sm text-muted">
          Lattice will parse the PDF, chunk it by section, embed each chunk, and
          index it for hybrid retrieval.
        </p>
      </div>
      <UploadDropzone />
      <div className="text-xs text-muted">
        <Link href="/documents" className="hover:underline">
          Back to documents
        </Link>
      </div>
    </main>
  );
}
