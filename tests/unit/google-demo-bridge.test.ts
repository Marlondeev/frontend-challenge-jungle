import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../../src/mocks/backend";

const { workerStart } = vi.hoisted(() => ({
  workerStart: vi.fn(async (): Promise<void> => {}),
}));
vi.mock("msw/browser", () => ({ setupWorker: () => ({ start: workerStart }) }));

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
let persistent: ReturnType<typeof storage>;
let tab: ReturnType<typeof storage>;
const identity = {
  sub: "verified-google-subject",
  email: "verified@example.test",
  name: "Verified Collector",
  emailVerified: true,
};

beforeEach(() => {
  vi.resetModules();
  workerStart.mockClear();
  persistent = storage();
  tab = storage();
  vi.stubGlobal("localStorage", persistent);
  vi.stubGlobal("sessionStorage", tab);
  vi.stubEnv("VITE_GOOGLE_LOGIN", "vercel-demo");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("verified hosted Google browser bridge", () => {
  it("initializes once and keeps a returning identity in tab storage across a reload", async () => {
    const browser = await import("../../src/mocks/browser");
    await Promise.all([browser.startMocks(), browser.startMocks()]);
    const first = await browser.loginVerifiedGoogleDemo(identity);
    expect(first.session.user).toMatchObject({
      email: identity.email,
      authProvider: "google",
    });
    expect(workerStart).toHaveBeenCalledOnce();
    expect(tab.values.get(STORAGE_KEY)).toContain(identity.email);
    expect(tab.values.get("kurio.visitor")).toBeTruthy();
    expect([...persistent.values]).toEqual([]);
    vi.resetModules();
    const reloaded = await import("../../src/mocks/browser");
    const second = await reloaded.loginVerifiedGoogleDemo(identity);
    expect(second.session.user?.id).toBe(first.session.user?.id);
    expect(JSON.parse(tab.values.get(STORAGE_KEY)!).users).toHaveLength(3);
    expect([...persistent.values]).toEqual([]);
  });

  it("rejects an already aborted attempt before starting or persisting any mock session", async () => {
    const browser = await import("../../src/mocks/browser");
    const controller = new AbortController();
    controller.abort();
    await expect(
      browser.loginVerifiedGoogleDemo(identity, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(workerStart).not.toHaveBeenCalled();
    expect([...tab.values]).toEqual([]);
    expect([...persistent.values]).toEqual([]);
  });

  it("does not create a Google profile when canceled while the mock worker starts", async () => {
    let finishStart!: () => void;
    workerStart.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        }),
    );
    const browser = await import("../../src/mocks/browser");
    const controller = new AbortController();
    const login = browser.loginVerifiedGoogleDemo(identity, controller.signal);
    await vi.waitFor(() => expect(workerStart).toHaveBeenCalledOnce());
    controller.abort();
    const rejected = expect(login).rejects.toMatchObject({
      name: "AbortError",
    });
    finishStart();
    await rejected;
    expect(tab.values.get(STORAGE_KEY)).not.toContain(identity.email);
    expect(JSON.parse(tab.values.get(STORAGE_KEY)!).users).toHaveLength(2);
  });

  it("rejects calls outside the hosted mode without starting a mock backend", async () => {
    vi.stubEnv("VITE_GOOGLE_LOGIN", "real");
    const browser = await import("../../src/mocks/browser");
    await expect(browser.loginVerifiedGoogleDemo(identity)).rejects.toThrow(
      "não está ativo",
    );
    expect(workerStart).not.toHaveBeenCalled();
    expect([...tab.values]).toEqual([]);
    expect([...persistent.values]).toEqual([]);
  });
});
