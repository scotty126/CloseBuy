import { z } from "zod";

/**
 * Every secret the API needs, validated at boot rather than failing deep
 * inside a request handler the first time it's touched. Fields marked
 * optional are genuinely not needed until a later milestone (see the
 * comment on each) — see .env.example at the repo root for the full list
 * with setup instructions.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required — see docker-compose.yml"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required — see docker-compose.yml"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),

  // Termii — M0 (Auth). Get a free account at termii.com; sandbox mode
  // works without a paid sender ID for local development.
  TERMII_API_KEY: z.string().min(1),
  TERMII_SENDER_ID: z.string().min(1),

  // M1+ — not needed to run M0's auth flow, kept optional so the app boots
  // without them and fails loudly and specifically only when a checkout,
  // map, upload, or push-notification path actually runs.
  MONNIFY_API_KEY: z.string().optional(),
  MONNIFY_SECRET_KEY: z.string().optional(),
  MONNIFY_CONTRACT_CODE: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment configuration:\n");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nCopy .env.example to .env and fill in the values described there.\n");
    process.exit(1);
  }
  return parsed.data;
}
