import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { createBackend, memoryStorage } from "../../src/mocks/backend";
import { createHandlers } from "../../src/mocks/handlers";

const disposals: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

describe("hosted Google route passthrough", () => {
  it("reaches the actual verifier before offline and validation mock scenarios", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.method!);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ source: "actual-verifier" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    disposals.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test server not listening");
    const origin = `http://127.0.0.1:${address.port}`;
    const backend = createBackend({
      storage: memoryStorage(),
      schedule: false,
    });
    disposals.push(() => backend.dispose());
    const handlers = createHandlers(backend, {
      latency: 0,
      hostedGoogleDemo: true,
    });
    disposals.push(handlers.dispose);
    const mocks = setupServer(...handlers.handlers);
    mocks.listen({ onUnhandledRequest: "error" });
    disposals.push(() => mocks.close());
    await backend.ready;
    for (const scenario of ["offline", "validation-error", "server-error"]) {
      await backend.request("POST", "/__control", {
        action: "scenario",
        scenario,
      });
      const response = await fetch(`${origin}/api/google-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: "opaque", nonce: "nonce" }),
      });
      expect(await response.json()).toEqual({ source: "actual-verifier" });
    }
    expect(requests).toEqual(["POST", "POST", "POST"]);
    await backend.request("POST", "/__control", {
      action: "scenario",
      scenario: "offline",
    });
    await expect(fetch(`${origin}/api/nfts`)).rejects.toThrow();
  });
});
