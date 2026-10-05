export function DeskFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-ink text-paper">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_8%,rgba(188,243,164,0.09),transparent_30%),radial-gradient(circle_at_6%_42%,rgba(23,41,32,0.85),transparent_36%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(to_right,rgba(183,230,189,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(183,230,189,0.05)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:linear-gradient(#000,transparent_90%)]" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-12">
        {children}
      </div>
    </div>
  );
}
