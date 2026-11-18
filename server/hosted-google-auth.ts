import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MockError } from "../src/mocks/backend.js";
import {
  createGoogleVerifier,
  sameValue,
  type GoogleVerifier,
} from "./google-token.js";

export type HostedGoogleRequest = IncomingMessage & { body?: unknown };
export interface HostedGoogleOptions {
  clientId: string;
  /** Construction-only verification seam; no runtime authentication bypass. */
  verifyGoogle?: GoogleVerifier;
  now?: () => number;
}

const cookieName = "kurio_hosted_google_challenge";
const cookiePath = "/api/google-auth";
const maximumBody = 32_768;
const lifetime = 300_000;
const failure = (status: number, code: string, message: string) =>
  new MockError(status, code, message);
const invalidChallenge = () =>
  failure(
    403,
    "INVALID_GOOGLE_CHALLENGE",
    "Reabra o login com Google e tente novamente.",
  );
function header(req: IncomingMessage, key: string): string | undefined {
  const value = req.headers[key];
  return typeof value === "string" ? value : undefined;
}
function requestSecure(req: IncomingMessage) {
  return (
    header(req, "x-forwarded-proto")?.split(",")[0].trim().toLowerCase() ===
      "https" ||
    ("encrypted" in req.socket && req.socket.encrypted === true)
  );
}
function originAllowed(req: IncomingMessage, required: boolean) {
  const host = header(req, "host");
  const origin = header(req, "origin");
  if (!host || header(req, "sec-fetch-site") === "cross-site") return false;
  if (!origin) return !required;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === (requestSecure(req) ? "https:" : "http:") &&
      parsed.origin === origin &&
      parsed.host === host
    );
  } catch {
    return false;
  }
}
function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw failure(422, "INVALID_JSON", "Envie um objeto JSON válido.");
  return value as Record<string, unknown>;
}
async function readBody(
  req: HostedGoogleRequest,
): Promise<Record<string, unknown>> {
  const length = Number(header(req, "content-length") ?? 0);
  if (!Number.isFinite(length) || length > maximumBody) {
    req.resume();
    throw failure(
      413,
      "BODY_TOO_LARGE",
      "A solicitação excede o tamanho permitido.",
    );
  }
  if (
    header(req, "content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    req.resume();
    throw failure(415, "JSON_REQUIRED", "Envie os dados em JSON.");
  }
  let suppliedBody: unknown;
  try {
    suppliedBody = req.body;
  } catch {
    throw failure(422, "INVALID_JSON", "Envie um objeto JSON válido.");
  }
  if (
    suppliedBody !== undefined &&
    !Buffer.isBuffer(suppliedBody) &&
    typeof suppliedBody !== "string"
  ) {
    const encoded = JSON.stringify(suppliedBody);
    if (Buffer.byteLength(encoded ?? "") > maximumBody)
      throw failure(
        413,
        "BODY_TOO_LARGE",
        "A solicitação excede o tamanho permitido.",
      );
    return objectBody(suppliedBody);
  }
  let encoded: string;
  if (suppliedBody !== undefined) {
    encoded = Buffer.isBuffer(suppliedBody)
      ? suppliedBody.toString("utf8")
      : String(suppliedBody);
    if (Buffer.byteLength(encoded) > maximumBody)
      throw failure(
        413,
        "BODY_TOO_LARGE",
        "A solicitação excede o tamanho permitido.",
      );
  } else {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maximumBody) {
        req.resume();
        throw failure(
          413,
          "BODY_TOO_LARGE",
          "A solicitação excede o tamanho permitido.",
        );
      }
      chunks.push(bytes);
    }
    encoded = Buffer.concat(chunks).toString("utf8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw failure(422, "INVALID_JSON", "Envie um objeto JSON válido.");
  }
  return objectBody(parsed);
}

/** Verifies Google identity only. Marketplace data and application sessions never live here. */
export function createHostedGoogleHandler({
  clientId,
  verifyGoogle,
  now = Date.now,
}: HostedGoogleOptions) {
  const configured = clientId.trim();
  const verify =
    verifyGoogle ??
    (configured
      ? createGoogleVerifier({ clientId: configured, now })
      : undefined);
  return async (
    req: HostedGoogleRequest,
    res: ServerResponse,
  ): Promise<void> => {
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    const secure = requestSecure(req);
    const cookie = (value: string, maxAge: number) =>
      `${cookieName}=${value}; Path=${cookiePath}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
    const send = (status: number, value: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (!configured || !verify)
        throw failure(
          503,
          "GOOGLE_NOT_CONFIGURED",
          "O login com Google ainda não foi configurado neste site.",
        );
      const method = req.method ?? "GET";
      if (method !== "GET" && method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        throw failure(405, "METHOD_NOT_ALLOWED", "Método não permitido.");
      }
      if (!originAllowed(req, method === "POST"))
        throw failure(
          403,
          "INVALID_ORIGIN",
          "A origem desta solicitação não é permitida.",
        );
      if (method === "GET") {
        const nonce = `${now().toString(36)}.${randomBytes(32).toString("base64url")}`;
        res.setHeader("Set-Cookie", cookie(nonce, lifetime / 1000));
        send(200, { nonce });
        return;
      }
      const body = await readBody(req);
      controller.signal.throwIfAborted();
      if (
        typeof body.credential !== "string" ||
        !body.credential ||
        body.credential.length > 16_384 ||
        typeof body.nonce !== "string" ||
        body.nonce.length > 128
      )
        throw failure(
          422,
          "INVALID_GOOGLE_CREDENTIAL",
          "Reabra o login com Google e tente novamente.",
        );
      const nonce = body.nonce;
      const cookies =
        header(req, "cookie")
          ?.split(";")
          .map((part) => part.trim())
          .filter((part) => part.startsWith(`${cookieName}=`)) ?? [];
      const savedNonce =
        cookies.length === 1
          ? cookies[0].slice(cookieName.length + 1)
          : undefined;
      if (
        !savedNonce ||
        !sameValue(savedNonce, nonce) ||
        !/^[0-9a-z]{1,12}\.[A-Za-z0-9_-]{43}$/.test(nonce)
      )
        throw invalidChallenge();
      const issuedText = nonce.split(".")[0];
      const issuedAt = Number.parseInt(issuedText, 36);
      const age = now() - issuedAt;
      if (
        !Number.isSafeInteger(issuedAt) ||
        issuedAt.toString(36) !== issuedText ||
        age < 0 ||
        age >= lifetime
      )
        throw invalidChallenge();
      // Stateless double-submit protection: clearing the browser cookie is not a
      // durable replay store, and must not be represented as one-use server state.
      res.setHeader("Set-Cookie", cookie("", 0));
      let identity;
      try {
        identity = await verify(body.credential, nonce, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) controller.signal.throwIfAborted();
        if (error instanceof MockError) throw error;
        throw failure(
          401,
          "INVALID_CREDENTIALS",
          "Não foi possível validar sua conta Google. Tente novamente.",
        );
      }
      controller.signal.throwIfAborted();
      send(200, { identity });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof MockError) send(error.status, error.toJSON());
      else
        send(500, {
          code: "INTERNAL_ERROR",
          message: "Não foi possível concluir a solicitação.",
        });
    } finally {
      res.off("close", onClose);
    }
  };
}
