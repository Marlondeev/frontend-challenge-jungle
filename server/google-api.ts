import { randomBytes } from "node:crypto";
import type {
  IncomingMessage,
  Server as HttpServer,
  ServerResponse,
} from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Http2SecureServer } from "node:http2";
import { resolve } from "node:path";
import { Server as SocketServer } from "socket.io";
import type { Plugin } from "vite";
import {
  createBackend,
  MockError,
  STORAGE_KEY,
  type RequestContext,
  type StorageAdapter,
} from "../src/mocks/backend";
import { createStorageCoordinator } from "../src/mocks/storage-coordinator";
import { createFileStorage } from "./file-storage";
import {
  createGoogleVerifier,
  sameValue,
  type GoogleVerifier,
} from "./google-token";

export interface GoogleApiOptions {
  clientId: string;
  storageDirectory?: string;
  allowedOrigins?: string[];
  /** Construction-only seams for isolated tests; never enabled by URL or environment. */
  storage?: StorageAdapter;
  verifyGoogle?: GoogleVerifier;
  now?: () => number;
  schedule?: boolean;
}

const cookieName = "kurio_google_challenge";
const challengeLifetime = 300_000;
const maximumBody = 32_768;
const defaultOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
];
const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const error = (status: number, code: string, message: string) =>
  new MockError(status, code, message);
const badChallenge = () =>
  error(
    403,
    "INVALID_GOOGLE_CHALLENGE",
    "Reabra o login com Google e tente novamente.",
  );

function header(req: IncomingMessage, key: string): string | undefined {
  const value = req.headers[key];
  return typeof value === "string" ? value : undefined;
}

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const length = Number(header(req, "content-length") ?? 0);
  if (!Number.isFinite(length) || length > maximumBody) {
    req.resume();
    throw error(
      413,
      "BODY_TOO_LARGE",
      "A solicitação excede o tamanho permitido.",
    );
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBody) {
      req.resume();
      throw error(
        413,
        "BODY_TOO_LARGE",
        "A solicitação excede o tamanho permitido.",
      );
    }
    chunks.push(bytes);
  }
  // Axios removes Content-Type for bodyless POST/DELETE. Read actual bytes first:
  // an empty mutation is valid, while any payload must still be JSON.
  if (size === 0) return {};
  if (
    header(req, "content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw error(415, "JSON_REQUIRED", "Envie os dados em JSON.");
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("object required");
    return body as Record<string, unknown>;
  } catch {
    throw error(422, "INVALID_JSON", "Envie um objeto JSON válido.");
  }
}

/** Same-origin REST and realtime boundary shared by Vite dev, preview, and isolated tests. */
export function createGoogleApi(options: GoogleApiOptions) {
  if (!options.clientId.trim())
    throw new Error("Configure o Google OAuth Client ID antes de iniciar.");
  const now = options.now ?? Date.now;
  const origins = new Set(
    (options.allowedOrigins ?? defaultOrigins).map(
      (origin) => new URL(origin).origin,
    ),
  );
  const persistent = options.storage
    ? undefined
    : createFileStorage(options.storageDirectory);
  const privateDirectory = (
    persistent?.directory ??
    resolve(options.storageDirectory ?? "tmp/google-auth")
  )
    .replaceAll("\\", "/")
    .toLowerCase();
  const storage = options.storage ?? persistent!.storage;
  // The reusable demo engine repairs absent local state; a real server must fail closed
  // instead of silently overwriting an existing, damaged private database.
  function validateStoredState() {
    const encoded = storage.getItem(STORAGE_KEY);
    if (encoded === null) return;
    const value: unknown = JSON.parse(encoded);
    if (
      !value ||
      typeof value !== "object" ||
      !("schema" in value) ||
      value.schema !== 1 ||
      !("nfts" in value) ||
      !Array.isArray(value.nfts) ||
      !("users" in value) ||
      !Array.isArray(value.users) ||
      [
        "passwords",
        "sessions",
        "carts",
        "favorites",
        "wallets",
        "quotes",
        "orders",
      ].some((key) => {
        const field: unknown = (value as Record<string, unknown>)[key];
        return !field || typeof field !== "object" || Array.isArray(field);
      })
    )
      throw new Error(
        "O arquivo privado de dados é inválido. Restaure uma cópia válida antes de iniciar.",
      );
  }
  try {
    validateStoredState();
  } catch (cause) {
    persistent?.dispose();
    throw cause;
  }
  const coordinate = createStorageCoordinator(storage, STORAGE_KEY);
  const backend = createBackend({
    storage,
    now,
    schedule: options.schedule,
    coordinate: (operation) =>
      coordinate(() => {
        validateStoredState();
        return operation();
      }),
  });
  const verifyGoogle =
    options.verifyGoogle ??
    createGoogleVerifier({ clientId: options.clientId, now });
  const challenges = new Map<string, { nonce: string; expiresAt: number }>();
  const requests = new Set<AbortController>();
  let io: SocketServer | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined;

  function sameOrigin(req: IncomingMessage, requireOrigin: boolean) {
    const supplied = header(req, "origin");
    const host = header(req, "host");
    if (header(req, "sec-fetch-site") === "cross-site") return false;
    if (!host) return false;
    if (supplied) {
      try {
        const origin = new URL(supplied);
        return (
          origin.origin === supplied &&
          origins.has(supplied) &&
          origin.host === host
        );
      } catch {
        return false;
      }
    }
    if (requireOrigin) return false;
    return [...origins].some((origin) => new URL(origin).host === host);
  }
  function send(res: ServerResponse, status: number, value: unknown) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
  }
  function privatePath(path: string) {
    const normalized = path.replaceAll("\\", "/").toLowerCase();
    const segments = normalized.split("/");
    return (
      normalized.startsWith("/@fs/") ||
      normalized.startsWith("/server/") ||
      segments.some(
        (segment) =>
          segment === "tmp" || segment === ".git" || segment.startsWith(".env"),
      ) ||
      normalized.includes(privateDirectory)
    );
  }
  function clearChallenge(res: ServerResponse, secure: boolean) {
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=; Path=/api/session/google; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`,
    );
  }
  function pruneChallenges() {
    for (const [id, challenge] of challenges)
      if (challenge.expiresAt <= now()) challenges.delete(id);
    while (challenges.size >= 1000)
      challenges.delete(challenges.keys().next().value!);
  }
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) {
    let path: string;
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://api.local");
      path = decodeURIComponent(url.pathname);
      // Decode repeated escapes as well: private files must never reach Vite's static handler.
      for (let i = 0; i < 2 && /%[a-f0-9]{2}/i.test(path); i++)
        path = decodeURIComponent(path);
    } catch {
      send(res, 400, { code: "INVALID_URL", message: "Endereço inválido." });
      return;
    }
    if (privatePath(path)) {
      send(res, 404, { code: "NOT_FOUND", message: "Recurso não encontrado." });
      return;
    }
    if (!path.startsWith("/api/")) {
      next();
      return;
    }
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    requests.add(controller);
    try {
      if (disposed)
        throw error(503, "SERVER_STOPPING", "O servidor está reiniciando.");
      const method = req.method ?? "GET";
      const route = path.slice(4);
      if (
        route === "/__control" ||
        route.startsWith("/__control/") ||
        route === "/session/social-demo"
      )
        throw error(404, "NOT_FOUND", "Recurso não encontrado.");
      if (!["GET", ...mutating].includes(method))
        throw error(405, "METHOD_NOT_ALLOWED", "Método não permitido.");
      if (!sameOrigin(req, mutating.has(method)))
        throw error(
          403,
          "INVALID_ORIGIN",
          "A origem desta solicitação não é permitida.",
        );
      const secure = header(req, "origin")?.startsWith("https:") ?? false;
      await backend.ready;
      controller.signal.throwIfAborted();
      pruneChallenges();
      if (route === "/session/google/challenge") {
        if (method !== "GET")
          throw error(405, "METHOD_NOT_ALLOWED", "Método não permitido.");
        const id = randomBytes(32).toString("base64url");
        const nonce = randomBytes(32).toString("base64url");
        const previous = header(req, "cookie")
          ?.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1);
        if (previous) challenges.delete(previous);
        challenges.set(id, { nonce, expiresAt: now() + challengeLifetime });
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${id}; Path=/api/session/google; Max-Age=300; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`,
        );
        send(res, 200, { nonce });
        return;
      }
      const body = mutating.has(method)
        ? await readBody(req)
        : Object.fromEntries(url.searchParams);
      controller.signal.throwIfAborted();
      const authorization = header(req, "authorization");
      const context: RequestContext = {
        token: authorization?.startsWith("Bearer ")
          ? authorization.slice(7, 4096)
          : undefined,
        visitorId: header(req, "x-visitor-id")?.slice(0, 255),
        idempotencyKey: header(req, "idempotency-key")?.slice(0, 255),
        signal: controller.signal,
      };
      if (route === "/session/google") {
        if (method !== "POST")
          throw error(405, "METHOD_NOT_ALLOWED", "Método não permitido.");
        if (
          typeof body.credential !== "string" ||
          !body.credential ||
          body.credential.length > 16_384 ||
          typeof body.nonce !== "string" ||
          !body.nonce ||
          body.nonce.length > 128
        )
          throw error(
            422,
            "INVALID_GOOGLE_CREDENTIAL",
            "Reabra o login com Google e tente novamente.",
          );
        const id = header(req, "cookie")
          ?.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1);
        const challenge = id ? challenges.get(id) : undefined;
        if (
          !challenge ||
          challenge.expiresAt <= now() ||
          !sameValue(challenge.nonce, body.nonce)
        )
          throw badChallenge();
        challenges.delete(id!);
        clearChallenge(res, secure);
        let identity;
        try {
          identity = await verifyGoogle(
            body.credential,
            challenge.nonce,
            controller.signal,
          );
        } catch (failure) {
          if (controller.signal.aborted) controller.signal.throwIfAborted();
          if (failure instanceof MockError) throw failure;
          throw error(
            401,
            "INVALID_CREDENTIALS",
            "Não foi possível validar sua conta Google. Tente novamente.",
          );
        }
        controller.signal.throwIfAborted();
        send(res, 200, await backend.loginGoogle(identity, context));
        return;
      }
      const value = await backend.request(method, route, body, context);
      if (
        method === "POST" &&
        route === "/session/logout" &&
        context.token &&
        io
      ) {
        for (const socket of io.sockets.sockets.values())
          if (socket.data.token === context.token) socket.disconnect(true);
      }
      send(
        res,
        method === "POST" &&
          ["/orders", "/wallets", "/session/register"].includes(route)
          ? 201
          : 200,
        value,
      );
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof MockError)
        send(res, failure.status, failure.toJSON());
      else
        send(res, 500, {
          code: "INTERNAL_ERROR",
          message: "Não foi possível concluir a solicitação.",
        });
    } finally {
      requests.delete(controller);
      res.off("close", onClose);
    }
  }
  function attachRealtime(
    server: HttpServer | HttpsServer | Http2SecureServer,
  ) {
    if (io || disposed) throw new Error("Realtime já iniciado ou encerrado.");
    io = new SocketServer(server, {
      transports: ["websocket"],
      destroyUpgrade: false,
      allowRequest: (req, done) =>
        done(null, !disposed && sameOrigin(req, true)),
      maxHttpBufferSize: maximumBody,
    });
    io.use((socket, next) => {
      const supplied =
        socket.handshake.auth.token ?? socket.handshake.query.token;
      const token =
        typeof supplied === "string" && supplied.length <= 4096
          ? supplied
          : undefined;
      const guest =
        supplied === undefined || supplied === null || supplied === "";
      if (!guest && (!token || !backend.socketUser(token))) {
        next(new Error("Sessão inválida."));
        return;
      }
      socket.data.token = guest ? undefined : token;
      next();
    });
    unsubscribe = backend.subscribe((name, event, userId) => {
      if (!io || disposed) return;
      if (!userId) {
        io.emit(name, event);
        return;
      }
      // Rooms alone are insufficient: an existing token may have expired or logged out.
      for (const socket of io.sockets.sockets.values()) {
        const token: unknown = socket.data.token;
        if (typeof token === "string" && backend.socketUser(token) === userId)
          socket.emit(name, event);
      }
    });
  }
  async function dispose() {
    if (disposal) return disposal;
    disposed = true;
    requests.forEach((controller) => controller.abort());
    challenges.clear();
    unsubscribe?.();
    backend.dispose();
    disposal = (async () => {
      await backend.ready.catch(() => undefined);
      if (io) await new Promise<void>((resolve) => io!.close(() => resolve()));
      persistent?.dispose();
    })();
    return disposal;
  }
  return {
    backend,
    ready: backend.ready,
    middleware: (
      req: IncomingMessage,
      res: ServerResponse,
      next: () => void,
    ) => {
      void handle(req, res, next);
    },
    attachRealtime,
    dispose,
  };
}

/** No state/lock is opened during a build; only a running local server owns it. */
export function googleApiPlugin(options: GoogleApiOptions): Plugin {
  let api: ReturnType<typeof createGoogleApi> | undefined;
  return {
    name: "kurio-google-api",
    configureServer(server) {
      api = createGoogleApi(options);
      server.middlewares.use(api.middleware);
      if (server.httpServer) {
        api.attachRealtime(server.httpServer);
        server.httpServer.once("close", () => {
          void api?.dispose();
        });
      }
    },
    configurePreviewServer(server) {
      api = createGoogleApi(options);
      server.middlewares.use(api.middleware);
      api.attachRealtime(server.httpServer);
      server.httpServer.once("close", () => {
        void api?.dispose();
      });
    },
    async closeBundle() {
      await api?.dispose();
    },
    async closePreviewServer() {
      await api?.dispose();
    },
  };
}
