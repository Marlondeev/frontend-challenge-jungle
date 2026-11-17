import { AxiosError, AxiosHeaders, type AxiosAdapter } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, getToken, setToken } from "../../src/lib/api";
import {
  createBackend,
  memoryStorage,
  MockError,
} from "../../src/mocks/backend";

let backend: ReturnType<typeof createBackend>;
let expiredEvents: number;
let clockNow: number;

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const events = new EventTarget();
  expiredEvents = 0;
  events.addEventListener("kurio:session-expired", () => expiredEvents++);
  vi.stubGlobal("window", events);
  clockNow = Date.UTC(2026, 10, 17);
  backend = createBackend({
    storage: memoryStorage(),
    schedule: false,
    now: () => clockNow,
  });
});

afterEach(() => {
  backend.dispose();
  vi.unstubAllGlobals();
});

// Replace only the HTTP transport: requests still run through the real API
// interceptors and the backend that defines the response status and error body.
const backendAdapter: AxiosAdapter = async (config) => {
  const response = {
    data: undefined as unknown,
    status: 200,
    statusText: "",
    headers: new AxiosHeaders(),
    config,
  };
  try {
    response.data = await backend.request(
      config.method!.toUpperCase(),
      config.url!,
      typeof config.data === "string" ? JSON.parse(config.data) : config.data,
      {
        token: config.headers.get("Authorization")?.toString().slice(7),
        visitorId: config.headers.get("X-Visitor-Id")?.toString(),
      },
    );
    return response;
  } catch (error) {
    if (!(error instanceof MockError)) throw error;
    response.status = error.status;
    response.data = error.toJSON();
    throw new AxiosError(
      error.message,
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      response,
    );
  }
};

async function login() {
  const { data } = await api.request({
    method: "POST",
    url: "/session/login",
    data: { email: "colecionador@kurio.test", password: "Kurio123!" },
    adapter: backendAdapter,
  });
  setToken(data.token);
  return data.token as string;
}

describe("API session invalidation", () => {
  it("keeps the current authenticated session after rejected login credentials", async () => {
    const token = await login();

    await expect(
      api.request({
        method: "POST",
        url: "/session/login",
        data: { email: "colecionador@kurio.test", password: "incorrect" },
        adapter: backendAdapter,
      }),
    ).rejects.toMatchObject({
      response: { status: 401, data: { code: "INVALID_CREDENTIALS" } },
    });

    expect(getToken()).toBe(token);
    expect(expiredEvents).toBe(0);
    const profile = await api.request({
      url: "/profile",
      adapter: backendAdapter,
    });
    expect(profile.data.email).toBe("colecionador@kurio.test");
  });

  it("keeps the current session when the password form rejects the current password", async () => {
    const token = await login();

    await expect(
      api.request({
        method: "PATCH",
        url: "/profile/password",
        data: { currentPassword: "incorrect", newPassword: "Different123!" },
        adapter: backendAdapter,
      }),
    ).rejects.toMatchObject({
      response: { status: 422, data: { code: "INVALID_PASSWORD" } },
    });

    expect(getToken()).toBe(token);
    expect(expiredEvents).toBe(0);
    const profile = await api.request({
      url: "/profile",
      adapter: backendAdapter,
    });
    expect(profile.data.email).toBe("colecionador@kurio.test");
  });

  it("clears an expired session and emits expiration only once for concurrent failures", async () => {
    await login();
    const session = await api.request({
      url: "/session",
      adapter: backendAdapter,
    });
    clockNow = Date.parse(session.data.expiresAt);

    const failures = await Promise.allSettled([
      api.request({ url: "/profile", adapter: backendAdapter }),
      api.request({ url: "/wallets", adapter: backendAdapter }),
    ]);

    expect(failures).toMatchObject([
      {
        status: "rejected",
        reason: {
          response: { status: 401, data: { code: "SESSION_EXPIRED" } },
        },
      },
      {
        status: "rejected",
        reason: {
          response: { status: 401, data: { code: "SESSION_EXPIRED" } },
        },
      },
    ]);
    expect(getToken()).toBeNull();
    expect(expiredEvents).toBe(1);
  });

  it.each(["UNAUTHORIZED", "INVALID_TOKEN"])(
    "clears the matching current token for %s responses",
    async (code) => {
      await login();
      const adapter: AxiosAdapter = async (config) => {
        throw new AxiosError(
          "Session rejected",
          AxiosError.ERR_BAD_REQUEST,
          config,
          undefined,
          {
            data: { code, message: "Session rejected" },
            status: 401,
            statusText: "Unauthorized",
            headers: new AxiosHeaders(),
            config,
          },
        );
      };

      await expect(
        api.request({ url: "/profile", adapter }),
      ).rejects.toMatchObject({ response: { status: 401, data: { code } } });

      expect(getToken()).toBeNull();
      expect(expiredEvents).toBe(1);
    },
  );

  it("keeps a newer session when an older request later receives a 401", async () => {
    const oldToken = await login();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const sent = new Promise<void>((resolve) => (started = resolve));
    const adapter: AxiosAdapter = async (config) => {
      started();
      await held;
      return backendAdapter(config);
    };
    const pending = api.request({ url: "/profile", adapter });
    await sent;
    await backend.request("POST", "/session/logout", {}, { token: oldToken });
    const newerToken = await login();
    release();

    await expect(pending).rejects.toMatchObject({
      response: { status: 401, data: { code: "SESSION_EXPIRED" } },
    });
    expect(newerToken).not.toBe(oldToken);
    expect(getToken()).toBe(newerToken);
    expect(expiredEvents).toBe(0);
    const profile = await api.request({
      url: "/profile",
      adapter: backendAdapter,
    });
    expect(profile.data.email).toBe("colecionador@kurio.test");
  });
});
