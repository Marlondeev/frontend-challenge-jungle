import { createServer, request as httpRequest, type Server } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import {
  createGoogleApi,
  type GoogleApiOptions,
} from "../../server/google-api";
import { memoryStorage, STORAGE_KEY } from "../../src/mocks/backend";
import type { AuthResult } from "../../src/domain/types";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
async function setup(overrides: Partial<GoogleApiOptions> = {}) {
  let time = Date.now();
  const server: Server = createServer((req, res) =>
    api.middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server");
  const origin = `http://127.0.0.1:${address.port}`;
  const verifyGoogle = vi.fn(
    async (credential: string, _nonce: string, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (credential !== "signed-test-identity")
        throw new Error("Invalid token");
      return {
        sub: "google-test-sub",
        email: "google@test.example",
        emailVerified: true,
        name: "Google Collector",
      };
    },
  );
  const storage = overrides.storageDirectory ? undefined : memoryStorage();
  const api = createGoogleApi({
    clientId: "test.apps.googleusercontent.com",
    storage,
    verifyGoogle,
    allowedOrigins: [origin],
    now: () => time,
    schedule: false,
    ...overrides,
  });
  await api.ready;
  api.attachRealtime(server);
  cleanup.push(async () => {
    await api.dispose();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const request = (path: string, body?: unknown, extra: RequestInit = {}) =>
    fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      ...extra,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Visitor-Id": "http-visitor",
        ...extra.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const challenge = async () => {
    const result = await request("/api/session/google/challenge");
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("set-cookie")).toMatch(
      /HttpOnly.*SameSite=Strict/,
    );
    return {
      nonce: (await result.json()).nonce as string,
      cookie: result.headers.get("set-cookie")!.split(";")[0],
    };
  };
  const googleLogin = async () => {
    const { nonce, cookie } = await challenge();
    const response = await request(
      "/api/session/google",
      { credential: "signed-test-identity", nonce },
      { headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as AuthResult;
  };
  const socket = async (token?: string) => {
    const client: Socket = connect(origin, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
      auth: { token: token ?? null, visitorId: "http-visitor" },
      query: { token: token ?? "", visitorId: "http-visitor" },
      extraHeaders: { Origin: origin },
    });
    cleanup.unshift(async () => {
      client.disconnect();
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    return client;
  };
  return {
    api,
    storage,
    origin,
    request,
    challenge,
    googleLogin,
    verifyGoogle,
    socket,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
function privateDirectory() {
  mkdirSync(resolve("tmp"), { recursive: true });
  return mkdtempSync(resolve("tmp/google-server-http-"));
}
function cleanDirectory(path: string) {
  if (!resolve(path).startsWith(`${resolve("tmp")}${sep}`))
    throw new Error("Unsafe test cleanup");
  rmSync(path, { recursive: true, force: true });
}
describe("same-origin Google API", () => {
  it("accepts bodyless favorites mutations and logout without Content-Type, and revokes the session", async () => {
    const { request, origin, googleLogin, api } = await setup();
    const { token } = await googleLogin();
    const headers = {
      Origin: origin,
      Authorization: `Bearer ${token}`,
      "X-Visitor-Id": "http-visitor",
    };
    const added = await fetch(`${origin}/api/favorites/emerald-ape-042`, {
      method: "POST",
      headers,
    });
    expect(added.status).toBe(200);
    expect(await added.json()).toContain("emerald-ape-042");
    const saved = await request("/api/favorites", undefined, { headers });
    expect(await saved.json()).toContain("emerald-ape-042");
    const removed = await fetch(`${origin}/api/favorites/emerald-ape-042`, {
      method: "DELETE",
      headers,
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).not.toContain("emerald-ape-042");
    const logout = await fetch(`${origin}/api/session/logout`, {
      method: "POST",
      headers,
    });
    expect(logout.status).toBe(200);
    expect(api.backend.socketUser(token)).toBeUndefined();
    expect((await request("/api/session", undefined, { headers })).status).toBe(
      401,
    );
  });
  it("still requires JSON for nonempty bodies and rejects arrays or malformed JSON", async () => {
    const { origin } = await setup();
    const post = (body: string, type?: string) =>
      fetch(`${origin}/api/session/login`, {
        method: "POST",
        headers: { Origin: origin, ...(type ? { "Content-Type": type } : {}) },
        body,
      });
    expect((await post("{}", "text/plain")).status).toBe(415);
    expect((await post("[]", "application/json")).status).toBe(422);
    expect((await post("{", "application/json")).status).toBe(422);
    expect((await post(" ", "application/json")).status).toBe(422);
  });
  it("creates a genuine domain session and preserves the guest cart on token acceptance", async () => {
    const { request, googleLogin } = await setup();
    expect(
      (
        await request("/api/cart/items", {
          nftId: "emerald-ape-042",
          editionId: "ten",
          quantity: 2,
        })
      ).status,
    ).toBe(200);
    const result = await googleLogin();
    expect(result.session.user).toMatchObject({
      id: "google:google-test-sub",
      authProvider: "google",
    });
    const session = await request("/api/session", undefined, {
      headers: { Authorization: `Bearer ${result.token}` },
    });
    expect(session.status).toBe(200);
    const cart = await request("/api/cart", undefined, {
      headers: { Authorization: `Bearer ${result.token}` },
    });
    expect((await cart.json()).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ quantity: 2 })]),
    );
  });
  it("requires the cookie, fresh nonce, correct origin, and one-time challenge", async () => {
    const { request, challenge, verifyGoogle, advance } = await setup();
    const first = await challenge();
    const body = { credential: "signed-test-identity", nonce: first.nonce };
    expect((await request("/api/session/google", body)).status).toBe(403);
    expect(
      (
        await request("/api/session/google", body, {
          headers: { Cookie: first.cookie, Origin: "https://attacker.example" },
        })
      ).status,
    ).toBe(403);
    expect(verifyGoogle).not.toHaveBeenCalled();
    expect(
      (
        await request("/api/session/google", body, {
          headers: { Cookie: first.cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/api/session/google", body, {
          headers: { Cookie: first.cookie },
        })
      ).status,
    ).toBe(403);
    const expired = await challenge();
    advance(300_001);
    expect(
      (
        await request(
          "/api/session/google",
          { ...body, nonce: expired.nonce },
          { headers: { Cookie: expired.cookie } },
        )
      ).status,
    ).toBe(403);
    expect(verifyGoogle).toHaveBeenCalledTimes(1);
  });
  it("consumes a rejected credential, rejects claimed identity, and bounds body size", async () => {
    const { request, challenge } = await setup();
    const { nonce, cookie } = await challenge();
    const invalid = await request(
      "/api/session/google",
      { credential: "bad", nonce },
      { headers: { Cookie: cookie } },
    );
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).code).toBe("INVALID_CREDENTIALS");
    expect(
      (
        await request(
          "/api/session/google",
          { credential: "signed-test-identity", nonce },
          { headers: { Cookie: cookie } },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/session/google", {
          sub: "claimed",
          email: "claim@test.example",
        })
      ).status,
    ).toBe(422);
    expect(
      (await request("/api/session/login", { padding: "a".repeat(40_000) }))
        .status,
    ).toBe(413);
  });
  it("keeps demo controls and private server files inaccessible", async () => {
    const { request } = await setup();
    for (const path of [
      "/api/__control",
      "/api/session/social-demo",
      "/tmp/google-auth/state.json",
      "/@fs/C:/private/state.json",
      "/server/file-storage.ts",
      "/.env.google.local",
    ]) {
      expect((await request(path, {})).status, path).toBe(404);
    }
    expect(
      (await request("/api/cart/items", {}, { headers: { Origin: "" } }))
        .status,
    ).toBe(403);
  });
  it("returns a bounded JSON error for oversized chunked bodies", async () => {
    const { origin } = await setup();
    const response = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          `${origin}/api/session/login`,
          {
            method: "POST",
            headers: {
              Origin: origin,
              "Content-Type": "application/json",
              "Transfer-Encoding": "chunked",
            },
          },
          (res) => {
            let body = "";
            res.on("data", (part: Buffer) => {
              body += part.toString();
            });
            res.on("end", () => resolve({ status: res.statusCode!, body }));
          },
        );
        req.on("error", reject);
        req.write('{"padding":"');
        req.write("x".repeat(40_000));
        req.end('"}');
      },
    );
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body).code).toBe("BODY_TOO_LARGE");
  });
  it("persists Google sessions, profile changes, and carts through a server restart", async () => {
    const directory = privateDirectory();
    const first = await setup({ storageDirectory: directory });
    const result = await first.googleLogin();
    const headers = { Authorization: `Bearer ${result.token}` };
    expect(
      (
        await first.request(
          "/api/profile",
          { displayName: "Saved Collector" },
          { method: "PATCH", headers },
        )
      ).status,
    ).toBe(200);
    await first.request(
      "/api/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 2 },
      { headers },
    );
    await first.api.dispose();
    const second = await setup({ storageDirectory: directory });
    cleanup.push(async () => cleanDirectory(directory));
    const session = await second.request("/api/session", undefined, {
      headers,
    });
    expect(session.status).toBe(200);
    expect((await session.json()).user.displayName).toBe("Saved Collector");
    const cart = await second.request("/api/cart", undefined, { headers });
    expect((await cart.json()).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ quantity: 2 })]),
    );
  });
  it("does not replace corrupt domain data with fixture accounts", () => {
    const directory = privateDirectory();
    const path = resolve(directory, "state.json");
    const corrupted = JSON.stringify({ [STORAGE_KEY]: "invalid domain JSON" });
    writeFileSync(path, corrupted);
    try {
      expect(() =>
        createGoogleApi({ clientId: "test", storageDirectory: directory }),
      ).toThrow();
      expect(readFileSync(path, "utf8")).toBe(corrupted);
    } finally {
      cleanDirectory(directory);
    }
  });
  it("aborts an unfinished Google verification without committing a new account", async () => {
    let verificationSignal: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    const { request, challenge, storage } = await setup({
      verifyGoogle: async (_credential, _nonce, signal) => {
        verificationSignal = signal;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          sub: "aborted-google-user",
          email: "aborted@test.example",
          emailVerified: true,
        };
      },
    });
    const { nonce, cookie } = await challenge();
    const controller = new AbortController();
    const pending = request(
      "/api/session/google",
      { credential: "signed-test-identity", nonce },
      { headers: { Cookie: cookie }, signal: controller.signal },
    );
    await vi.waitFor(() => expect(verificationSignal).toBeDefined());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(verificationSignal!.aborted).toBe(true));
    finish!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const state = JSON.parse(storage!.getItem(STORAGE_KEY)!);
    expect(
      state.users.some(
        (user: { email: string }) => user.email === "aborted@test.example",
      ),
    ).toBe(false);
  });
  it("does not revoke a valid existing session when Google rejects another credential", async () => {
    const { request, challenge } = await setup();
    const loggedIn = await request("/api/session/login", {
      email: "colecionador@kurio.test",
      password: "Kurio123!",
    });
    const { token } = (await loggedIn.json()) as AuthResult;
    const { nonce, cookie } = await challenge();
    expect(
      (
        await request(
          "/api/session/google",
          { credential: "invalid-token", nonce },
          { headers: { Cookie: cookie, Authorization: `Bearer ${token}` } },
        )
      ).status,
    ).toBe(401);
    const session = await request("/api/session", undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(session.status).toBe(200);
    expect((await session.json()).user.id).toBe("user-collector");
  });
  it("broadcasts NFT updates while revalidating private orders after logout", async () => {
    const { api, request, socket, advance } = await setup();
    const response = await request("/api/session/login", {
      email: "colecionador@kurio.test",
      password: "Kurio123!",
    });
    const result = (await response.json()) as AuthResult;
    const context = { token: result.token, visitorId: "http-visitor" };
    const owner = await socket(result.token),
      guest = await socket();
    const ownerOrders: unknown[] = [],
      guestOrders: unknown[] = [],
      publicNfts: unknown[] = [];
    owner.on("order.updated", (event) => ownerOrders.push(event));
    guest.on("order.updated", (event) => guestOrders.push(event));
    guest.on("nft.updated", (event) => publicNfts.push(event));
    const makeOrder = async (key: string) => {
      await api.backend.request(
        "POST",
        "/cart/items",
        { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 },
        context,
      );
      const quote = await api.backend.request("POST", "/quote", {}, context);
      const wallet = (
        await api.backend.request("GET", "/wallets", {}, context)
      )[0];
      return api.backend.request(
        "POST",
        "/orders",
        { quoteId: quote.id, walletId: wallet.id, idempotencyKey: key },
        context,
      );
    };
    await makeOrder("socket-first");
    advance(1600);
    await api.backend.request("GET", "/nfts");
    await vi.waitFor(() => expect(ownerOrders.length).toBeGreaterThan(0));
    expect(guestOrders).toEqual([]);
    expect(publicNfts.length).toBeGreaterThan(0);
    await makeOrder("socket-after-logout");
    await request(
      "/api/session/logout",
      {},
      { headers: { Authorization: `Bearer ${result.token}` } },
    );
    const before = ownerOrders.length;
    advance(1600);
    await api.backend.request("GET", "/nfts");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ownerOrders).toHaveLength(before);
    expect(guestOrders).toEqual([]);
  });
});
