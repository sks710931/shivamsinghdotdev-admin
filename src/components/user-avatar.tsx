export function UserAvatar({ name, email }: { name?: string | null; email: string }) {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._+-]+/).filter(Boolean);
  const letters = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || source.slice(0, 2).toUpperCase();

  return (
    <span
      aria-hidden="true"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold tracking-wide text-accent"
    >
      {letters}
    </span>
  );
}
