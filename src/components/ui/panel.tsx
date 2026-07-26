import { cn } from "@/lib/utils";

export function Panel({
  className,
  bright = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { bright?: boolean }): React.JSX.Element {
  return (
    <div
      className={cn("rounded-panel", bright ? "glass-bright" : "glass", className)}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-dim">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Panel className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-ink-faint">{icon}</div> : null}
      <p className="font-medium text-ink">{title}</p>
      {detail ? <p className="max-w-sm text-sm text-ink-dim">{detail}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </Panel>
  );
}

export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <div className={cn("skeleton", className)} />;
}
