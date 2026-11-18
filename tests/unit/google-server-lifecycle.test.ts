import { createServer as createHttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, preview } from "vite";
import { io as connect } from "socket.io-client";
import { googleApiPlugin } from "../../server/google-api";
import { memoryStorage } from "../../src/mocks/backend";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function availablePort() {
  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} did not finish within 2 seconds`)),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
describe("Google Vite lifecycle", () => {
  it.each(["dev", "preview"] as const)(
    "closes %s with active HTTP and Socket.IO clients",
    async (mode) => {
      const port = await availablePort();
      const origin = `http://127.0.0.1:${port}`;
      const config = {
        configFile: false as const,
        logLevel: "silent" as const,
        appType: "custom" as const,
        plugins: [
          googleApiPlugin({
            clientId: "test.apps.googleusercontent.com",
            storage: memoryStorage(),
            allowedOrigins: [origin],
            schedule: false,
          }),
        ],
        server: {
          host: "127.0.0.1",
          port,
          strictPort: true,
          watch: null,
          preTransformRequests: false,
        },
        preview: { host: "127.0.0.1", port, strictPort: true },
      };
      const server =
        mode === "dev" ? await createServer(config) : await preview(config);
      if (mode === "dev" && "listen" in server) await server.listen();
      cleanup.push(async () => {
        await bounded(server.close(), "cleanup");
      });
      const response = await fetch(`${origin}/api/nfts`, {
        headers: { Origin: origin },
      });
      expect(response.status).toBe(200);
      await response.json();
      const socket = connect(origin, {
        forceNew: true,
        reconnection: false,
        transports: ["websocket"],
        auth: { token: null },
        query: { token: "" },
        extraHeaders: { Origin: origin },
      });
      cleanup.unshift(async () => {
        socket.disconnect();
      });
      await bounded(
        new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("connect_error", reject);
        }),
        "socket connect",
      );
      expect(socket.connected).toBe(true);
      await bounded(server.close(), `${mode} close`);
      expect(server.httpServer?.listening).toBe(false);
    },
  );
});
