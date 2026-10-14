export class AuthError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly extra?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
