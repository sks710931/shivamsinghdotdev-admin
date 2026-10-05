export function SectionCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          {icon}
        </span>
        <div>
          <h2 className="font-display text-lg font-medium text-paper">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-mist">{subtitle}</p>
        </div>
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}
