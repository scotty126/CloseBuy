import * as client from "openid-client";

/**
 * Google/Apple OAuth2 + OIDC (brief §3.1b), via `openid-client` — a
 * maintained, OpenID-certified library (chosen over `arctic`, which turned
 * out to be marked deprecated by its own maintainer at every version when
 * this was checked; ADR-0001 records the switch).
 *
 * `discovery()` is async (it fetches the provider's `.well-known` metadata
 * once), so both clients are created lazily and cached — not at module
 * load time, since that would make a network call before the app even
 * knows its own env is valid.
 */
let googleConfig: client.Configuration | null | undefined;

export async function getGoogleConfig(
  clientId: string | undefined,
  clientSecret: string | undefined,
): Promise<client.Configuration | null> {
  if (!clientId || !clientSecret) return null;
  if (googleConfig !== undefined) return googleConfig;

  googleConfig = await client.discovery(new URL("https://accounts.google.com"), clientId, clientSecret);
  return googleConfig;
}

/**
 * Apple — same shape, kept separate because Apple's "client secret" isn't
 * a static string; it's a short-lived ES256 JWT signed with the private
 * key from .env.example (APPLE_OAUTH_PRIVATE_KEY), regenerated per
 * request. Genuinely untestable without a paid Apple Developer account, so
 * this returns null (and the route 503s) until real credentials exist —
 * same pattern as every other optional integration in this codebase. The
 * discovery + PKCE flow below it is otherwise identical to Google's.
 */
let appleConfig: client.Configuration | null | undefined;

export async function getAppleConfig(
  clientId: string | undefined,
  teamId: string | undefined,
  keyId: string | undefined,
  privateKey: string | undefined,
): Promise<client.Configuration | null> {
  if (!clientId || !teamId || !keyId || !privateKey) return null;
  if (appleConfig !== undefined) return appleConfig;

  // TODO once real Apple credentials exist: build the ES256
  // PrivateKeyJwt client authentication (client.PrivateKeyJwt) from
  // teamId/keyId/privateKey and pass it as discovery()'s 4th argument.
  // Structure is otherwise identical to Google — not built further than
  // this until there's something to actually test it against.
  appleConfig = await client.discovery(new URL("https://appleid.apple.com"), clientId);
  return appleConfig;
}
