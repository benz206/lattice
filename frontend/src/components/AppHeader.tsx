import Link from "next/link";
import { HealthBadge } from "./HealthBadge";

interface AppHeaderProps {
  subtitle?: string;
}

export function AppHeader({ subtitle }: AppHeaderProps): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <div className="flex flex-col">
        <Link href="/" className="text-2xl font-semibold tracking-tight hover:opacity-90">
          Lattice
        </Link>
        {subtitle ? (
          <p className="text-xs text-muted">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/documents" className="hover:underline">
            Documents
          </Link>
          <Link href="/upload" className="hover:underline">
            Upload
          </Link>
        </nav>
        <HealthBadge />
      </div>
    </header>
  );
}
