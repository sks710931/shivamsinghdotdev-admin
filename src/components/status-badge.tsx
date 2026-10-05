export function RoleBadge({ role }: { role: "admin" | "guest" }) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent">
        Admin
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-mist">
      Guest
    </span>
  );
}

export function StatusBadge({ disabled }: { disabled: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-paper">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${disabled ? "bg-mist" : "bg-accent"}`}
      />
      {disabled ? "Disabled" : "Active"}
    </span>
  );
}
