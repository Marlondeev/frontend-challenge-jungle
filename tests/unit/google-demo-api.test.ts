import type { AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, getToken, sessionApi, setToken } from "@/lib/api";

const { bridge } = vi.hoisted(() => ({ bridge: vi.fn() }));
vi.mock("../../src/mocks/browser", () => ({ loginVerifiedGoogleDemo: bridge }));

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

let tabStorage: ReturnType<typeof storage>;

beforeEach(() => {
  vi.stubGlobal("localStorage", storage());
  tabStorage = storage();
  vi.stubGlobal("sessionStorage", tabStorage);
  bridge.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("hosted Google API boundary", () => {
  it("verifies through the hosted route before passing only identity to the browser bridge", async () => {
    vi.stubEnv("VITE_GOOGLE_LOGIN", "vercel-demo");
    const identity = {
      sub: "google-subject",
      email: "collector@example.test",
      emailVerified: true,
    };
    const paths: (string | undefined)[] = [];
    const timeouts: (number | undefined)[] = [];
    api.defaults.adapter = async (config) => {
      paths.push(config.url);
      timeouts.push(config.timeout);
      return {
        data:
          config.method === "get" ? { nonce: "server-nonce" } : { identity },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };
    const result = {
      token: "fictional-session",
      session: { user: { id: "user-google" }, expiresAt: "later" },
    };
    bridge.mockResolvedValue(result);
    const controller = new AbortController();
    await expect(sessionApi.googleChallenge()).resolves.toEqual({
      nonce: "server-nonce",
    });
    await expect(
      sessionApi.loginGoogle(
        { credential: "opaque-google-id-token", nonce: "server-nonce" },
        controller.signal,
      ),
    ).resolves.toBe(result);
    expect(paths).toEqual(["/google-auth", "/google-auth"]);
    expect(timeouts).toEqual([8000, 15_000]);
    expect(bridge).toHaveBeenCalledWith(identity, controller.signal);
    expect(JSON.stringify([...tabStorage.values])).not.toContain(
      "opaque-google-id-token",
    );
    setToken(result.token);
    expect(getToken()).toBe(result.token);
    expect(sessionStorage.getItem("kurio.session")).toBe(result.token);
    expect(localStorage.getItem("kurio.session")).toBeNull();
  });

  it("does not create a fictional session when verification is canceled", async () => {
    vi.stubEnv("VITE_GOOGLE_LOGIN", "vercel-demo");
    const controller = new AbortController();
    api.defaults.adapter = async (config) => {
      controller.abort();
      return {
        data: {
          identity: {
            sub: "late",
            email: "late@example.test",
            emailVerified: true,
          },
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };
    await expect(
      sessionApi.loginGoogle(
        { credential: "late-token", nonce: "nonce" },
        controller.signal,
      ),
    ).rejects.toBeDefined();
    expect(bridge).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("kurio.session")).toBeNull();
  });

  it("keeps the local real server endpoint and skips the browser bridge", async () => {
    vi.stubEnv("VITE_GOOGLE_LOGIN", "real");
    const paths: AxiosRequestConfig["url"][] = [];
    const result = {
      token: "local-real-session",
      session: { user: null, expiresAt: null },
    };
    api.defaults.adapter = async (config) => {
      paths.push(config.url);
      return {
        data: config.method === "get" ? { nonce: "nonce" } : result,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };
    await sessionApi.googleChallenge();
    expect(
      await sessionApi.loginGoogle({ credential: "token", nonce: "nonce" }),
    ).toBe(result);
    expect(paths).toEqual(["/session/google/challenge", "/session/google"]);
    expect(bridge).not.toHaveBeenCalled();
  });
});
