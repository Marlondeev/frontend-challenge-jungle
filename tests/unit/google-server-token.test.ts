import { generateKeyPairSync, sign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";
import { createGoogleVerifier } from "../../server/google-token";

const clientId = "test.apps.googleusercontent.com";
const nonce = "browser-bound-nonce";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function token(
  overrides: Record<string, unknown> = {},
  header = { alg: "RS256", kid: "fixture" },
) {
  const time = Math.floor(Date.now() / 1000);
  const unsigned = `${encode(header)}.${encode({
    iss: "https://accounts.google.com",
    aud: clientId,
    sub: "google-subject",
    email: "google@example.com",
    email_verified: true,
    name: "Google Collector",
    picture: "https://example.com/avatar.png",
    iat: time - 10,
    exp: time + 3600,
    nonce,
    ...overrides,
  })}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), keys.privateKey).toString("base64url")}`;
}
function verifier() {
  const client = new OAuth2Client();
  // Only Google's certificate transport is replaced; verification remains the official library.
  vi.spyOn(client, "getFederatedSignonCertsAsync").mockResolvedValue({
    certs: { fixture: publicKey },
    format: "PEM",
  } as Awaited<ReturnType<typeof client.getFederatedSignonCertsAsync>>);
  return createGoogleVerifier({ clientId, client });
}
describe("Google's signed ID-token boundary", () => {
  it("accepts a signed, verified Google identity for this audience and nonce", async () => {
    await expect(verifier()(token(), nonce)).resolves.toEqual({
      sub: "google-subject",
      email: "google@example.com",
      emailVerified: true,
      name: "Google Collector",
      picture: "https://example.com/avatar.png",
    });
  });
  it.each([
    { aud: "another.apps.googleusercontent.com" },
    { iss: "https://attacker.example" },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { nonce: "another-browser" },
    { email_verified: false },
    { sub: "" },
    { email: "malformed" },
    { iat: Math.floor(Date.now() / 1000) + 120 },
  ])("rejects signed but invalid claims: %j", async (claims) => {
    await expect(verifier()(token(claims), nonce)).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
  });
  it("rejects signature tampering, unsigned tokens, and raw profiles without echoing credentials", async () => {
    const valid = token();
    const changed = `${valid.slice(0, -10)}AAAAAAAAAA`;
    for (const credential of [
      changed,
      token({}, { alg: "none", kid: "fixture" }),
      '{"sub":"claimed"}',
    ]) {
      const error = await verifier()(credential, nonce).catch(
        (error: unknown) => error,
      );
      expect(error).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
      expect(String(error)).not.toContain(credential);
    }
  });
  it("turns certificate transport failures into a retryable error without token details", async () => {
    const client = new OAuth2Client();
    vi.spyOn(client, "getFederatedSignonCertsAsync").mockRejectedValue(
      Object.assign(new Error("private network details"), {
        code: "ENOTFOUND",
      }),
    );
    await expect(
      createGoogleVerifier({ clientId, client })(token(), nonce),
    ).rejects.toMatchObject({ status: 503, code: "GOOGLE_UNAVAILABLE" });
  });
});
