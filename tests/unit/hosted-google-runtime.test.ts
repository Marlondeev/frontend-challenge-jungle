import { createServer } from "node:http";
import { expect, it } from "vitest";
import googleAuth from "../../api/google-auth";

it("serves the public-ID runtime adapter and rejects an unsigned credential without a network request", async () => {
  const server = createServer((req, res) => {
    void googleAuth(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/google-auth`);
    expect(response.status).toBe(200);
    const { nonce } = (await response.json()) as { nonce: string };
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const rejected = await fetch(`${origin}/api/google-auth?bypass=true`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ credential: "unsigned-id-token", nonce }),
    });
    expect(rejected.status).toBe(401);
    expect((await rejected.json()).code).toBe("INVALID_CREDENTIALS");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
