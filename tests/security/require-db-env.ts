export const REQUIRED_ENVS = [
  "DB_SERVER",
  "TEST_ADMIN_ID",
  "TEST_GUEST_ID",
  "TEST_OTHER_POST_ID",
] as const;

export const missingEnvs = REQUIRED_ENVS.filter((key) => !process.env[key]);
export const shouldSkip = missingEnvs.length > 0;

if (process.env.CI && shouldSkip) {
  throw new Error(
    `CI is set but required environment variables are missing: ${missingEnvs.join(", ")}`,
  );
}
