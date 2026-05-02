import { Spinner } from "./Spinner";

export type ActivityState = "done" | "active" | "waiting" | "error";

export interface ActivityStep {
  label: string;
  detail: string;
  state: ActivityState;
  metric?: string;
}

interface ActivityRailProps {
  title: string;
  steps: ActivityStep[];
}

const STATE_STYLE: Record<ActivityState, string> = {
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  active: "border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--foreground)]",
  waiting: "border-line bg-transparent text-muted",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
};

function StateGlyph({ state }: { state: ActivityState }): React.JSX.Element {
  if (state === "active") {
    return <Spinner size={12} />;
  }
  if (state === "done") {
    return <span className="text-[10px] font-semibold">ok</span>;
  }
  if (state === "error") {
    return <span className="text-[11px]">!</span>;
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />;
}

export function ActivityRail({
  title,
  steps,
}: ActivityRailProps): React.JSX.Element {
  return (
    <section className="surface-card rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        {steps.map((step) => (
          <div
            key={step.label}
            className={`rounded-md border px-3 py-2 ${STATE_STYLE[step.state]}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-semibold">
                <StateGlyph state={step.state} />
                {step.label}
              </span>
              {step.metric ? (
                <span className="font-mono text-[10px] text-muted">{step.metric}</span>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{step.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
