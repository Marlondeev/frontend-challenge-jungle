import { delay, http, HttpResponse, ws, type HttpResponseResolver } from "msw";
import { toSocketIo } from "@mswjs/socket.io-binding";
import { MockError, type MockBackend } from "./backend";

/** The same handlers run in the browser worker and Node integration tests. */
export function createHandlers(
  backend: MockBackend,
  { latency = 120 }: { latency?: number } = {},
) {
  let sequence = 0;
  const cleanups = new Set<() => void>();
  const resolve: HttpResponseResolver = async ({ request }) => {
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/api/, ""),
      method = request.method;
    const scenario = backend.state().scenario,
      control = path === "/__control";
    if (!control) {
      const duration =
        scenario === "slow"
          ? 2400
          : scenario === "variable-latency"
            ? ++sequence % 2
              ? 1300
              : 150
            : latency;
      if (duration) await delay(duration);
      if (scenario === "offline") return HttpResponse.error();
      if (scenario === "server-error")
        return HttpResponse.json(
          {
            message: "Serviço temporariamente indisponível. Tente novamente.",
            code: "SERVICE_UNAVAILABLE",
          },
          { status: 503 },
        );
    }
    let body: unknown = Object.fromEntries(url.searchParams);
    if (!["GET", "HEAD"].includes(method)) {
      try {
        const text = await request.text();
        body = text.trim() ? JSON.parse(text) : {};
      } catch {
        return HttpResponse.json(
          { message: "Envie um objeto JSON válido.", code: "INVALID_JSON" },
          { status: 400 },
        );
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        return HttpResponse.json(
          { message: "Envie um objeto JSON válido.", code: "INVALID_JSON" },
          { status: 400 },
        );
    }
    try {
      const authorization = request.headers.get("Authorization");
      if (authorization && !/^Bearer\s+\S+$/i.test(authorization))
        throw new MockError(
          401,
          "INVALID_TOKEN",
          "Sessão inválida. Entre novamente.",
        );
      if (!control && scenario === "validation-error" && method !== "GET")
        throw new MockError(
          422,
          "VALIDATION_ERROR",
          "Revise os campos indicados.",
          {
            email: "Informe um e-mail válido.",
            password: "Use uma senha mais forte.",
            username: "Escolha outro nome de usuário.",
            displayName: "Informe seu nome.",
            address: "Confira o endereço da carteira.",
          },
        );
      const result = await backend.request(method, path, body, {
        token: authorization?.replace(/^Bearer\s+/i, ""),
        visitorId: request.headers.get("X-Visitor-Id") ?? undefined,
        idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined,
      });
      // The order has already been durably created. Recovery GET is intentionally not delayed.
      if (
        path === "/orders" &&
        method === "POST" &&
        scenario === "order-timeout"
      )
        await delay(10000);
      return HttpResponse.json(result, {
        status:
          method === "POST" &&
          ["/orders", "/session/register", "/wallets"].includes(path)
            ? 201
            : 200,
      });
    } catch (error) {
      if (error instanceof MockError)
        return HttpResponse.json(error.toJSON(), { status: error.status });
      console.error("[Kurio mock]", error);
      return HttpResponse.json(
        {
          message: "Não foi possível concluir a solicitação.",
          code: "INTERNAL_ERROR",
        },
        { status: 500 },
      );
    }
  };
  // MSW normalizes the default Socket.IO path to the origin when matching.
  const realtime = ws.link("wss://realtime.kurio.test");
  const socketHandler = realtime.addEventListener(
    "connection",
    (connection) => {
      const wrapped = toSocketIo(connection);
      const token =
        connection.client.url.searchParams.get("token") ?? undefined;
      if (!backend.state().connected) {
        queueMicrotask(() =>
          connection.client.close(1013, "Demonstração desconectada"),
        );
        return;
      }
      const unsubscribe = backend.subscribe((name, event, userId) => {
        // Revalidate the session on every private event, including after logout/expiry.
        if (!userId || backend.socketUser(token) === userId)
          wrapped.client.emit(name, event);
      });
      const unsubscribeConnection = backend.onConnection((connected) => {
        if (!connected)
          connection.client.close(1012, "Conexão interrompida na demonstração");
      });
      // Binding 0.2.0 implements the handshake and text frames but not the heartbeat.
      const ping = setInterval(() => connection.client.send("2"), 20000);
      const cleanup = () => {
        clearInterval(ping);
        unsubscribe();
        unsubscribeConnection();
        cleanups.delete(cleanup);
      };
      cleanups.add(cleanup);
      connection.client.addEventListener("close", cleanup);
    },
  );
  return {
    handlers: [
      // Register recovery first so a dynamic identifier cannot consume "by-key".
      http.get("*/api/orders/by-key/:key", resolve),
      http.get("*/api/orders/:id", resolve),
      http.all("*/api/*", resolve),
      socketHandler,
    ],
    dispose: () => {
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    },
  };
}
