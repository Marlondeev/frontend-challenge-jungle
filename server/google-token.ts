import { timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { GoogleIdentity } from "../src/domain/types";
import { MockError } from "../src/mocks/backend.js";

export type GoogleVerifier = (
  credential: string,
  nonce: string,
  signal?: AbortSignal,
) => Promise<GoogleIdentity>;

export function sameValue(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const invalid = () =>
  new MockError(
    401,
    "INVALID_CREDENTIALS",
    "Não foi possível validar sua conta Google. Tente novamente.",
  );
const issuers = new Set(["accounts.google.com", "https://accounts.google.com"]);
const networkCodes = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ERR_NETWORK",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Construction-only client injection keeps tests on the official cryptographic verifier. */
export function createGoogleVerifier({
  clientId,
  client,
  now = Date.now,
}: {
  clientId: string;
  client?: OAuth2Client;
  now?: () => number;
}): GoogleVerifier {
  const verifier =
    client ??
    new OAuth2Client({
      clientId,
      transporterOptions: { timeout: 10_000, retry: false },
    });
  return async (credential, nonce, signal) => {
    signal?.throwIfAborted();
    try {
      if (typeof credential !== "string" || credential.length > 16_384)
        throw invalid();
      const segments = credential.split(".");
      if (
        segments.length !== 3 ||
        segments.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
      )
        throw invalid();
      const header: unknown = JSON.parse(
        Buffer.from(segments[0], "base64url").toString(),
      );
      if (
        !header ||
        typeof header !== "object" ||
        !("alg" in header) ||
        header.alg !== "RS256" ||
        !("kid" in header) ||
        typeof header.kid !== "string" ||
        !header.kid
      )
        throw invalid();
      const ticket = await verifier.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      signal?.throwIfAborted();
      const claims = ticket.getPayload();
      const seconds = now() / 1000;
      if (
        !claims ||
        claims.aud !== clientId ||
        !issuers.has(claims.iss) ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= seconds ||
        !Number.isFinite(claims.iat) ||
        claims.iat > seconds + 60 ||
        claims.email_verified !== true ||
        typeof claims.sub !== "string" ||
        !claims.sub.trim() ||
        claims.sub.length > 255 ||
        typeof claims.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) ||
        typeof claims.nonce !== "string" ||
        !sameValue(claims.nonce, nonce)
      )
        throw invalid();
      const identity: GoogleIdentity = {
        sub: claims.sub,
        email: claims.email,
        emailVerified: true,
      };
      if (typeof claims.name === "string" && claims.name.trim())
        identity.name = claims.name.slice(0, 200);
      if (typeof claims.picture === "string") {
        try {
          const picture = new URL(claims.picture);
          if (
            picture.protocol === "https:" &&
            !picture.username &&
            !picture.password
          )
            identity.picture = picture.href;
        } catch {
          /* A profile photo is optional. */
        }
      }
      return identity;
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      if (error instanceof MockError) throw error;
      // Never propagate Google's verification text: it can contain the raw credential.
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      if (typeof code === "string" && networkCodes.has(code)) {
        throw new MockError(
          503,
          "GOOGLE_UNAVAILABLE",
          "O Google está indisponível no momento. Tente novamente.",
        );
      }
      throw invalid();
    }
  };
}
