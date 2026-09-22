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

  // Termii — vendor/rider/admin OTP + guest order tracking SMS (brief
  // §3.1b). Optional: a registered Sender ID needs CAC business
  // verification docs, which can take a while to sort out — the app boots
  // and everything else works without this; only vendor/rider/admin sign-in
  // actually needs it, and fails loudly and specifically right there, not
  // at boot.
  TERMII_API_KEY: z.string().optional(),
  TERMII_SENDER_ID: z.string().optional(),

  // Explicit, opt-in escape hatch for while TERMII_SENDER_ID is still
  // pending CAC approval — never activates just because Termii is
  // unconfigured, has to be deliberately turned on. See termii.ts. Once
  // real Termii credentials exist this flag simply stops being read;
  // nothing else needs to change.
  OTP_DEV_FALLBACK: z.coerce.boolean().default(false),

  // Password hashing pepper — argon2's own salt is per-hash and stored
  // alongside it, this is an additional server-side secret so a leaked DB
  // alone still isn't enough to brute-force offline. Same bar as the JWT
  // secrets.
  PASSWORD_PEPPER: z.string().min(32),

  // Customer auth — brief §3.1b. Kept optional so the app boots and
  // email/password registration still works without them; each fails
  // loudly and specifically only when its own path is actually used
  // (verification/reset email, or that one OAuth provider's button).
  RESEND_API_KEY: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  APPLE_OAUTH_CLIENT_ID: z.string().optional(),
  APPLE_OAUTH_TEAM_ID: z.string().optional(),
  APPLE_OAUTH_KEY_ID: z.string().optional(),
  APPLE_OAUTH_PRIVATE_KEY: z.string().optional(),
  API_PUBLIC_URL: z.string().default("http://localhost:4000"), // OAuth redirect base
  CUSTOMER_APP_URL: z.string().default("http://localhost:3000"), // where verify/reset/OAuth-complete links point

  // Browser-facing origins allowed to call this API cross-origin (app.ts's
  // CORS plugin) — comma-separated, additive to the four local dev ports
  // and the current Netlify domains already baked into the default below,
  // so a fresh custom domain just needs this env var set on Railway, no
  // code change/redeploy. Doesn't affect server-to-server calls (Railway
  // SSH scripts, curl, the mobile app someday) — CORS is a browser-only
  // restriction to begin with.
  CORS_ORIGINS: z
    .string()
    .default(
      "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3100,https://closebuy1.netlify.app,https://closebuy-vendor.netlify.app,https://closebuy-rider.netlify.app,https://closebuy-admin.netlify.app",
    ),

  // M1+ — not needed to run M0's auth flow, kept optional so the app boots
  // without them and fails loudly and specifically only when a checkout,
  // map, upload, or push-notification path actually runs.
  MONNIFY_API_KEY: z.string().optional(),
  MONNIFY_SECRET_KEY: z.string().optional(),
  MONNIFY_CONTRACT_CODE: z.string().optional(),
  // Which Monnify wallet/account payouts disburse from — only the
  // payouts module's transfer() needs this; checkout/refund are unaffected.
  MONNIFY_DISBURSEMENT_SOURCE_ACCOUNT_NUMBER: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // web-push requires a contact URI on every request (RFC 8292) — a
  // mailto: is fine, it's never actually emailed. Defaulted rather than
  // required since it's meaningless without the two keys above anyway.
  VAPID_SUBJECT: z.string().default("mailto:support@closebuy.app"),
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
