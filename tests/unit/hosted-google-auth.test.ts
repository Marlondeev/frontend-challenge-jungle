import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostedGoogleHandler } from "../../server/hosted-google-auth";
import { MockError } from "../../src/mocks/backend";
import type { GoogleVerifier } from "../../server/google-token";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup(
  options: {
    clientId?: string;
    parsedBody?: unknown;
    bodyGetter?: () => unknown;
    verifyGoogle?: GoogleVerifier;
  } = {},
) {
  let time = Date.now();
  const verifyGoogle =
    options.verifyGoogle ??
    vi.fn(async (_credential: string, _nonce: string) => ({
      sub: "real-subject",
      email: "real@google.test",
      emailVerified: true,
      name: "Real Collector",
    }));
  const server = createServer((req, res) => {
    if (options.bodyGetter)
      Object.defineProperty(req, "body", { get: options.bodyGetter });
    if ("parsedBody" in options)
      (req as IncomingMessage & { body?: unknown }).body = options.parsedBody;
    // Deliberately instantiate for every request to exercise the stateless function contract.
    const handle = createHostedGoogleHandler({
      clientId: options.clientId ?? "test.apps.googleusercontent.com",
      verifyGoogle,
      now: () => time,
    });
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server");
  const origin = `http://127.0.0.1:${address.port}`;
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const get = () => fetch(`${origin}/api/google-auth`);
  const challenge = async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toMatch(
      /HttpOnly.*SameSite=Strict/,
    );
    return {
      nonce: (await response.json()).nonce as string,
      cookie: response.headers.get("set-cookie")!.split(";")[0],
    };
  };
  const post = (body: unknown, cookie?: string, overrides: RequestInit = {}) =>
    fetch(`${origin}/api/google-auth`, {
      method: "POST",
      ...overrides,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...overrides.headers,
      },
      body: JSON.stringify(body),
    });
  return {
    origin,
    get,
    challenge,
    post,
    verifyGoogle,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("stateless hosted Google verifier", () => {
  it("returns only the verified identity across independent function instances", async () => {
    const { challenge, post, verifyGoogle } = await setup();
    const { nonce, cookie } = await challenge();
    const response = await post(
      {
        credential: "google-id-token",
        nonce,
        identity: { email: "attacker@example.com" },
      },
      cookie,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await response.json()).toEqual({
      identity: {
        sub: "real-subject",
        email: "real@google.test",
        emailVerified: true,
        name: "Real Collector",
      },
    });
    expect(verifyGoogle).toHaveBeenCalledWith(
      "google-id-token",
      nonce,
      expect.any(AbortSignal),
    );
  });
  it("requires matching cookie, fresh nonce, and the same Origin/Host", async () => {
    const { challenge, post, verifyGoogle, advance } = await setup();
    const { nonce, cookie } = await challenge();
    const body = { credential: "google-id-token", nonce };
    expect((await post(body)).status).toBe(403);
    expect(
      (await post({ ...body, nonce: `${nonce}-different` }, cookie)).status,
    ).toBe(403);
    expect(
      (
        await post(body, cookie, {
          headers: { Origin: "https://attacker.example" },
        })
      ).status,
    ).toBe(403);
    expect((await post(body, cookie, { headers: { Origin: "" } })).status).toBe(
      403,
    );
    expect(
      (await post(body, cookie, { headers: { "X-Forwarded-Proto": "https" } }))
        .status,
    ).toBe(403);
    expect(
      (
        await post(body, cookie, {
          headers: { Origin: "", "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    advance(300_001);
    expect((await post(body, cookie)).status).toBe(403);
    expect(verifyGoogle).not.toHaveBeenCalled();
  });
  it("rejects future timestamps and arbitrary cookie/nonce values", async () => {
    const { challenge, post, advance } = await setup();
    const { nonce, cookie } = await challenge();
    advance(-60_000);
    expect(
      (await post({ credential: "google-id-token", nonce }, cookie)).status,
    ).toBe(403);
    const name = cookie.split("=")[0];
    expect(
      (
        await post(
          { credential: "google-id-token", nonce: "arbitrary" },
          `${name}=arbitrary`,
        )
      ).status,
    ).toBe(403);
  });
  it("clears the challenge and emits a generic error when verification rejects", async () => {
    const { challenge, post } = await setup({
      verifyGoogle: async () => {
        throw new Error("raw secret credential must not escape");
      },
    });
    const { nonce, cookie } = await challenge();
    const response = await post(
      { credential: "secret-id-token", nonce },
      cookie,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const body = await response.json();
    expect(body.code).toBe("INVALID_CREDENTIALS");
    expect(JSON.stringify(body)).not.toMatch(/secret|raw|credential/);
  });
  it("preserves retryable Google verification errors", async () => {
    const { challenge, post } = await setup({
      verifyGoogle: async () => {
        throw new MockError(503, "GOOGLE_UNAVAILABLE", "Tente novamente.");
      },
    });
    const { nonce, cookie } = await challenge();
    const response = await post(
      { credential: "google-id-token", nonce },
      cookie,
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("GOOGLE_UNAVAILABLE");
  });
  it("bounds JSON bodies and rejects invalid credential shape", async () => {
    const { challenge, post } = await setup();
    const { nonce, cookie } = await challenge();
    expect(
      (await post({ credential: "x".repeat(40_000), nonce }, cookie)).status,
    ).toBe(413);
    expect(
      (await post({ identity: { sub: "claimed" }, nonce }, cookie)).status,
    ).toBe(422);
    expect((await post([], cookie)).status).toBe(422);
    expect(
      (
        await post({ credential: "token", nonce }, cookie, {
          headers: { "Content-Type": "text/plain" },
        })
      ).status,
    ).toBe(415);
  });
  it("accepts Vercel's already-parsed JSON body without depending on a readable stream", async () => {
    const state = { credential: "google-id-token", nonce: "" };
    const { challenge, post } = await setup({ parsedBody: state });
    const { nonce, cookie } = await challenge();
    state.nonce = nonce;
    expect((await post({}, cookie)).status).toBe(200);
  });
  it("also bounds already-parsed Vercel payloads", async () => {
    const { challenge, post } = await setup({
      parsedBody: { credential: "x".repeat(40_000), nonce: "unused" },
    });
    const { cookie } = await challenge();
    expect((await post({}, cookie)).status).toBe(413);
  });
  it("returns a safe validation error when Vercel's parsed-body getter throws", async () => {
    const { challenge, post } = await setup({
      bodyGetter: () => {
        throw new SyntaxError("malformed private payload details");
      },
    });
    const { nonce, cookie } = await challenge();
    const response = await post({ credential: "token", nonce }, cookie);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("INVALID_JSON");
    expect(JSON.stringify(body)).not.toContain("private payload");
  });
  it("fails clearly when the deployment's public Client ID is absent", async () => {
    const { get } = await setup({ clientId: "" });
    const response = await get();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("GOOGLE_NOT_CONFIGURED");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("marks challenge cookies Secure behind HTTPS and rejects unsupported methods", async () => {
    const { origin } = await setup();
    const response = await fetch(`${origin}/api/google-auth`, {
      headers: { "X-Forwarded-Proto": "https" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("; Secure");
    const unsupported = await fetch(`${origin}/api/google-auth`, {
      method: "DELETE",
      headers: { Origin: origin },
    });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, POST");
  });
});
