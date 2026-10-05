export type UserRole = "admin" | "guest";

export type DirectoryUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
};

export type PendingInvite = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  expiresAt: string;
  createdAt: string;
};
